import type { Criterion, Email, Column } from '../types/index.ts';
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
 *   - "stream"  → evaluates referenced column's criteria recursively
 *
 * Operations:
 *   - "contains" → case-insensitive substring match
 *   - "equals"   → case-insensitive exact match
 *   - "startsWith" → case-insensitive prefix match
 *   - "endsWith" → case-insensitive suffix match
 */

// Cached references to avoid repeated useStore.getState() in hot loops
let _cachedColumns: Column[] | null = null;
let _cachedSweepIds: Set<string> | null = null;
let _cachedEnabledSweepRules: Array<{ criteria: Criterion[]; criteriaLogic: 'and' | 'or' }> | null = null;
let _cachedExemptedIds: Set<string> | null = null;

function getColumns(): Column[] {
  if (!_cachedColumns) _cachedColumns = useStore.getState().columns;
  return _cachedColumns;
}

function getSweepIds(): Set<string> {
  if (!_cachedSweepIds) {
    _cachedSweepIds = new Set(useStore.getState().sweepEmails.map(e => e.id));
  }
  return _cachedSweepIds;
}

function getEnabledSweepRules(): Array<{ criteria: Criterion[]; criteriaLogic: 'and' | 'or' }> {
  if (!_cachedEnabledSweepRules) {
    _cachedEnabledSweepRules = useStore.getState().sweepRules
      .filter(r => r.enabled)
      .map(r => ({ criteria: r.criteria, criteriaLogic: r.criteriaLogic }));
  }
  return _cachedEnabledSweepRules;
}

function getExemptedIds(): Set<string> {
  if (!_cachedExemptedIds) _cachedExemptedIds = useStore.getState().exemptedEmailIds;
  return _cachedExemptedIds;
}

/**
 * Call before a batch of emailMatchesCriteria calls to snapshot store state
 * once, and after to release references.
 */
export function beginCriteriaMatch() {
  const s = useStore.getState();
  _cachedColumns = s.columns;
  _cachedSweepIds = new Set(s.sweepEmails.map(e => e.id));
  _cachedEnabledSweepRules = s.sweepRules
    .filter(r => r.enabled)
    .map(r => ({ criteria: r.criteria, criteriaLogic: r.criteriaLogic }));
  _cachedExemptedIds = s.exemptedEmailIds;
}
export function endCriteriaMatch() {
  _cachedColumns = null;
  _cachedSweepIds = null;
  _cachedEnabledSweepRules = null;
  _cachedExemptedIds = null;
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
  const { field, op, value } = criterion;
  // Strip surrounding quotes if present (e.g. "quoted phrase" → quoted phrase)
  const stripped = value.replace(/^["']+|["']+$/g, '');
  const v = stripped.toLowerCase();

  switch (field) {
    case 'from': {
      const sender = email.sender.toLowerCase();
      const senderEmail = (email.senderEmail || '').toLowerCase();
      return matchOp(sender, op, v) || matchOp(senderEmail, op, v);
    }
    case 'to': {
      const toEmail = (email.toEmail || '').toLowerCase();
      const accountId = (email.accountId || '').toLowerCase();
      return matchOp(toEmail, op, v) || matchOp(accountId, op, v);
    }
    case 'subject':
      return matchOp(email.subject.toLowerCase(), op, v);
    case 'label': {
      if (!email.labels) return false;
      return email.labels.some((l) => matchOp(l.toLowerCase(), op, v));
    }
    case 'snippet':
      return matchOp(email.snippet.toLowerCase(), op, v);
    case 'body':
      return matchOp(email.snippet.toLowerCase(), op, v);
    case 'stream': {
      const cols = getColumns();
      const target = cols.find(c => c.id === value || c.name.toLowerCase() === v);
      if (!target || target.criteria.length === 0) return false;
      if (visitedStreams?.has(target.id)) return false;
      const visited = new Set(visitedStreams);
      visited.add(target.id);
      return emailMatchesCriteriaInternal(email, target.criteria, target.criteriaLogic, visited);
    }
    case 'sweep': {
      // value is 'no rule' | 'has rule' (case-insensitive).
      // "has rule" = the email would be (or is) acted on by an enabled sweep
      // rule. Specifically: it's currently in sweep_queue OR it matches an
      // enabled rule's criteria. Exempted emails are treated as "no rule"
      // since the user has explicitly opted them out.
      const exempt = getExemptedIds().has(email.id);
      let hasRule = false;
      if (!exempt) {
        if (getSweepIds().has(email.id)) {
          hasRule = true;
        } else {
          for (const r of getEnabledSweepRules()) {
            if (emailMatchesCriteriaInternal(email, r.criteria, r.criteriaLogic, visitedStreams)) {
              hasRule = true;
              break;
            }
          }
        }
      }
      const want = v.includes('has') ? true : v.includes('no') ? false : null;
      if (want === null) return false;
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
