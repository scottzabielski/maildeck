import type { Criterion, Email, Column, SweepEmail, SweepRule } from '../types/index.ts';
import { useStore } from '../store/index.ts';

/**
 * Check whether an email matches a set of column filter criteria.
 *
 * Criteria fields map to email properties:
 *   - "from"    → email.sender (display name) or email.senderEmail
 *   - "to"      → email.recipients (if available)
 *   - "subject" → email.subject
 *   - "label"   → email.labels (if available)
 *   - "snippet" → email.snippet
 *   - "bulk"    → email.isBulk ("true"/"false"; an unknown flag matches neither)
 *   - "stream"  → evaluates referenced column's criteria recursively
 *   - "sweep"   → whether a sweep rule applies ("has rule"/"no rule"), or a
 *                 Claude check is holding its sweep ("needs review"/"check failed")
 *
 * Operations:
 *   - "contains" → case-insensitive substring match
 *   - "equals"   → case-insensitive exact match
 *   - "startsWith" → case-insensitive prefix match
 *   - "endsWith" → case-insensitive suffix match
 */

// Matching reads the store directly. What it derives from store data (lowercased
// fields, the sweep queue by id, each email's sweep rule and streams) is cached and
// rebuilt only when that data changes, compared by identity. Every column shares the
// work, and a refresh that changes one email only re-matches that email.

const sweepsByList = new WeakMap<SweepEmail[], Map<string, SweepEmail>>();

/** The sweep queue by email id. */
export function sweepsById(list: SweepEmail[]): Map<string, SweepEmail> {
  let map = sweepsByList.get(list);
  if (!map) {
    map = new Map(list.map(e => [e.id, e]));
    sweepsByList.set(list, map);
  }
  return map;
}

type Lowered = {
  sender: string;
  senderEmail: string;
  toEmail: string;
  accountId: string;
  subject: string;
  snippet: string;
  labels: string[];
};
const loweredByEmail = new WeakMap<Email, Lowered>();

function lowered(email: Email): Lowered {
  let l = loweredByEmail.get(email);
  if (!l) {
    l = {
      sender: (email.sender || '').toLowerCase(),
      senderEmail: (email.senderEmail || '').toLowerCase(),
      toEmail: (email.toEmail || '').toLowerCase(),
      accountId: (email.accountId || '').toLowerCase(),
      subject: (email.subject || '').toLowerCase(),
      snippet: (email.snippet || '').toLowerCase(),
      labels: email.labels ? email.labels.map(x => x.toLowerCase()) : [],
    };
    loweredByEmail.set(email, l);
  }
  return l;
}

/** Whether the sender, address, subject or preview contains `query` (lowercase). */
export function emailMatchesSearch(email: Email, query: string): boolean {
  const l = lowered(email);
  return l.sender.includes(query) || l.senderEmail.includes(query) || l.subject.includes(query) || l.snippet.includes(query);
}

const needles = new WeakMap<Criterion, { value: string; needle: string }>();

/** A criterion's value, lowercased, without surrounding quotes ("quoted phrase" → quoted phrase). */
function needleOf(criterion: Criterion): string {
  const hit = needles.get(criterion);
  if (hit && hit.value === criterion.value) return hit.needle;
  const needle = criterion.value.replace(/^["']+|["']+$/g, '').toLowerCase();
  needles.set(criterion, { value: criterion.value, needle });
  return needle;
}

function findStream(columns: Column[], criterion: Criterion): Column | undefined {
  const name = needleOf(criterion);
  return columns.find(c => c.id === criterion.value || c.name.toLowerCase() === name);
}

/** Whether matching these criteria reads the sweep queue: a "sweep" criterion, directly or in a stream they name. */
function readsSweepQueue(criteria: Criterion[], columns: Column[], seen: Set<string>): boolean {
  for (const c of criteria) {
    if (c.field === 'sweep') return true;
    if (c.field === 'stream') {
      const target = findStream(columns, c);
      if (target && !seen.has(target.id)) {
        seen.add(target.id);
        if (readsSweepQueue(target.criteria, columns, seen)) return true;
      }
    }
  }
  return false;
}

/** The sweep rule that would act on an email: the soonest of the enabled rules it matches. */
export type RuleMatch = { action: string; delayHours: number; claude: boolean };

type RuleIndex = {
  rules: SweepRule[];
  columns: Column[];
  /** Set only when a rule reads the sweep queue. */
  sweeps: SweepEmail[] | null;
  exempted: Set<string> | null;
  enabled: SweepRule[];
  byEmail: WeakMap<Email, RuleMatch | null>;
};
let ruleIndex: RuleIndex | null = null;
// One object per distinct result, so an email whose rule didn't change keeps the same value.
const ruleMatches = new Map<string, RuleMatch>();

function currentRuleIndex(): RuleIndex {
  const s = useStore.getState();
  const idx = ruleIndex;
  if (idx && idx.rules === s.sweepRules && idx.columns === s.columns
    && (idx.sweeps === null || (idx.sweeps === s.sweepEmails && idx.exempted === s.exemptedEmailIds))) {
    return idx;
  }
  const enabled = s.sweepRules.filter(r => r.enabled);
  const readsQueue = enabled.some(r => readsSweepQueue(r.criteria, s.columns, new Set()));
  ruleIndex = {
    rules: s.sweepRules,
    columns: s.columns,
    sweeps: readsQueue ? s.sweepEmails : null,
    exempted: readsQueue ? s.exemptedEmailIds : null,
    enabled,
    byEmail: new WeakMap(),
  };
  return ruleIndex;
}

/** The enabled sweep rule that would sweep this email soonest, or null. */
export function sweepRuleMatch(email: Email): RuleMatch | null {
  const idx = currentRuleIndex();
  const cached = idx.byEmail.get(email);
  if (cached !== undefined) return cached;
  // Marks the email in progress: a rule asking whether a rule applies to this same
  // email (a "sweep" criterion) gets "no rule" instead of recursing forever.
  idx.byEmail.set(email, null);
  let best: SweepRule | null = null;
  for (const rule of idx.enabled) {
    if ((!best || rule.delayHours < best.delayHours) && emailMatchesCriteria(email, rule.criteria, rule.criteriaLogic)) {
      best = rule;
    }
  }
  let match: RuleMatch | null = null;
  if (best) {
    const claude = !!best.aiCheck?.enabled;
    const key = `${best.action}\n${best.delayHours}\n${claude}`;
    match = ruleMatches.get(key) ?? null;
    if (!match) {
      match = { action: best.action, delayHours: best.delayHours, claude };
      ruleMatches.set(key, match);
    }
  }
  idx.byEmail.set(email, match);
  return match;
}

type Membership = {
  criteria: Criterion[];
  logic: 'and' | 'or';
  columns: Column[];
  /** Set only when the stream reads the sweep queue (its matches then also depend on the rules). */
  sweeps: SweepEmail[] | null;
  exempted: Set<string> | null;
  rules: SweepRule[] | null;
  byEmail: WeakMap<Email, boolean>;
};
const memberships = new Map<string, Membership>();

/**
 * Whether an email is in a stream. Cached per stream until its criteria or what they
 * read change, so redrawing a column or switching views doesn't re-run them, and a
 * sweep queue change only re-checks the streams that look at the queue.
 */
export function inStream(email: Email, stream: Column): boolean {
  const s = useStore.getState();
  let m = memberships.get(stream.id);
  if (!m || m.criteria !== stream.criteria || m.logic !== stream.criteriaLogic || m.columns !== s.columns
    || (m.sweeps !== null && (m.sweeps !== s.sweepEmails || m.exempted !== s.exemptedEmailIds || m.rules !== s.sweepRules))) {
    const readsQueue = readsSweepQueue(stream.criteria, s.columns, new Set([stream.id]));
    m = {
      criteria: stream.criteria,
      logic: stream.criteriaLogic,
      columns: s.columns,
      sweeps: readsQueue ? s.sweepEmails : null,
      exempted: readsQueue ? s.exemptedEmailIds : null,
      rules: readsQueue ? s.sweepRules : null,
      byEmail: new WeakMap(),
    };
    memberships.set(stream.id, m);
  }
  let member = m.byEmail.get(email);
  if (member === undefined) {
    member = emailMatchesCriteria(email, stream.criteria, stream.criteriaLogic);
    m.byEmail.set(email, member);
  }
  return member;
}

/** A stream an email appears in, for the colored dots on inbox cards. */
export type StreamTag = { id: string; accent: string };

// The enabled streams, and one tag list per distinct set of them (so an email whose
// streams didn't change keeps the same value), for the current columns.
let tagsFor: { columns: Column[]; streams: Column[]; lists: Map<string, StreamTag[]> } | null = null;

/** The enabled streams an email appears in, or undefined if none. */
export function streamTags(email: Email): StreamTag[] | undefined {
  const columns = useStore.getState().columns;
  if (tagsFor?.columns !== columns) {
    tagsFor = { columns, streams: columns.filter(c => c.enabled !== false && c.criteria.length > 0), lists: new Map() };
  }
  const matched = tagsFor.streams.filter(c => inStream(email, c));
  if (matched.length === 0) return undefined;
  const key = matched.map(c => c.id).join('\n');
  let tags = tagsFor.lists.get(key);
  if (!tags) {
    tags = matched.map(c => ({ id: c.id, accent: c.accent }));
    tagsFor.lists.set(key, tags);
  }
  return tags;
}

export function emailMatchesCriteria(
  email: Email,
  criteria: Criterion[],
  logic: 'and' | 'or',
): boolean {
  return emailMatchesCriteriaInternal(email, criteria, logic, undefined);
}

function emailMatchesCriteriaInternal(
  email: Email,
  criteria: Criterion[],
  logic: 'and' | 'or',
  visitedStreams: Set<string> | undefined,
): boolean {
  if (criteria.length === 0) return false;

  if (logic === 'and') {
    for (const c of criteria) {
      if (!matchSingleCriterion(email, c, visitedStreams)) return false;
    }
    return true;
  }
  for (const c of criteria) {
    if (matchSingleCriterion(email, c, visitedStreams)) return true;
  }
  return false;
}

function matchSingleCriterion(
  email: Email,
  criterion: Criterion,
  visitedStreams: Set<string> | undefined,
): boolean {
  const { field, op } = criterion;
  const v = needleOf(criterion);

  switch (field) {
    case 'from': {
      const l = lowered(email);
      return matchOp(l.sender, op, v) || matchOp(l.senderEmail, op, v);
    }
    case 'to': {
      const l = lowered(email);
      return matchOp(l.toEmail, op, v) || matchOp(l.accountId, op, v);
    }
    case 'subject':
      return matchOp(lowered(email).subject, op, v);
    case 'label':
      return lowered(email).labels.some((l) => matchOp(l, op, v));
    case 'snippet':
    case 'body':
      return matchOp(lowered(email).snippet, op, v);
    case 'bulk':
      if (email.isBulk === null || email.isBulk === undefined) return false;
      return email.isBulk === (v === 'true' || v === 'yes');
    case 'stream': {
      const target = findStream(useStore.getState().columns, criterion);
      if (!target || target.criteria.length === 0) return false;
      if (visitedStreams?.has(target.id)) return false;
      const visited = new Set(visitedStreams);
      visited.add(target.id);
      return emailMatchesCriteriaInternal(email, target.criteria, target.criteriaLogic, visited);
    }
    case 'sweep': {
      const s = useStore.getState();
      const sweep = sweepsById(s.sweepEmails).get(email.id);
      // 'needs review' / 'check failed': a Claude check is holding the sweep
      // (Claude was unsure, or couldn't check it).
      if (v === 'needs review') return sweep?.aiStatus === 'unsure';
      if (v === 'check failed') return sweep?.aiStatus === 'failed';
      // value is 'no rule' | 'has rule' (case-insensitive).
      // "has rule" = the email would be (or is) acted on by an enabled sweep
      // rule. Specifically: it's currently in sweep_queue OR it matches an
      // enabled rule's criteria. Exempted emails are treated as "no rule"
      // since the user has explicitly opted them out.
      const want = v.includes('has') ? true : v.includes('no') ? false : null;
      if (want === null) return false;
      const hasRule = !s.exemptedEmailIds.has(email.id) && (!!sweep || sweepRuleMatch(email) !== null);
      return hasRule === want;
    }
    default:
      return false;
  }
}

function matchOp(haystack: string, op: string, needle: string): boolean {
  switch (op) {
    case 'contains':
      return haystack.includes(needle);
    case 'not_contains':
      return !haystack.includes(needle);
    case 'equals':
      return haystack === needle;
    case 'startsWith':
    case 'starts_with':
      return haystack.startsWith(needle);
    case 'endsWith':
    case 'ends_with':
      return haystack.endsWith(needle);
    default:
      return haystack.includes(needle);
  }
}
