import { createAdminClient } from './supabase-admin.ts';

/**
 * Server-side sweep rule matching, shared by apply-sweep-rule,
 * sweep-backfill and mcp-api so they always agree on what a rule matches.
 * For plain fields it mirrors the apply_sweep_rules_on_insert() trigger
 * (migrations 009/012/014) — keep them in sync. Stream references are
 * resolved only here; the trigger skips them.
 */

export type AdminClient = ReturnType<typeof createAdminClient>;

export interface Criterion {
  field: string;
  op: string;
  value: string;
}

export interface SweepRuleRow {
  id: string;
  criteria: unknown;
  criteria_logic: string | null;
  action: string;
  delay_hours: number;
  sender_pattern: string | null;
}

/** Fields the server can evaluate. The client also understands "stream" and "sweep". */
export const SERVER_FIELDS = new Set(['from', 'to', 'subject', 'body', 'snippet', 'label']);

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Stands in for a stream reference that can't be resolved here: a stream
// that no longer exists or has no criteria, or a stream inside a stream.
// It isn't a server field, so it never matches (as in the client).
const UNRESOLVED_STREAM: Criterion = { field: 'unresolved_stream', op: 'equals', value: '' };

/** Shape-checks a jsonb criteria value. */
export function normalizeCriteria(raw: unknown): Criterion[] {
  return Array.isArray(raw)
    ? (raw as unknown[]).filter(
        (c): c is Criterion =>
          !!c && typeof c === 'object' &&
          typeof (c as Criterion).field === 'string' &&
          typeof (c as Criterion).op === 'string' &&
          typeof (c as Criterion).value === 'string',
      )
    : [];
}

/** A rule's criteria, falling back to the legacy sender_pattern like the trigger does. */
export function ruleCriteria(rule: Pick<SweepRuleRow, 'criteria' | 'sender_pattern'>): Criterion[] {
  const criteria = normalizeCriteria(rule.criteria);
  if (criteria.length === 0 && rule.sender_pattern) {
    return [{ field: 'from', op: 'contains', value: rule.sender_pattern }];
  }
  return criteria;
}

export function terminalActionFor(action: string): 'archive' | 'delete' {
  return action === 'delete' || action === 'keep_newest_delete' ? 'delete' : 'archive';
}

/**
 * Replace each "stream" criterion with the referenced column's criteria
 * (looked up by id, or by name for older rules). Only one level deep.
 */
export async function resolveStreamCriteria(
  admin: AdminClient,
  criteria: Criterion[],
  userId: string,
): Promise<Criterion[]> {
  const resolved: Criterion[] = [];

  for (const c of criteria) {
    if (c.field !== 'stream') {
      resolved.push(c);
      continue;
    }

    let columnQuery = admin
      .from('columns')
      .select('criteria, criteria_logic')
      .eq('user_id', userId);
    columnQuery = UUID_RE.test(c.value)
      ? columnQuery.eq('id', c.value)
      : columnQuery.ilike('name', c.value);

    const { data: columns } = await columnQuery.limit(1);
    const colCriteria = columns && columns.length > 0 ? normalizeCriteria(columns[0].criteria) : [];
    if (colCriteria.length === 0) {
      resolved.push(UNRESOLVED_STREAM);
      continue;
    }
    for (const cc of colCriteria) {
      resolved.push(cc.field === 'stream' ? UNRESOLVED_STREAM : cc);
    }
  }

  return resolved;
}

/**
 * The criteria to filter on, or null when the rule can't match anything.
 * A condition the server can't evaluate (an unresolved stream, a "sweep"
 * condition) never matches, the same as in the client: under "and" the
 * whole rule matches nothing, under "or" the condition drops out. Without
 * this, an empty filter would match every email in the inbox.
 */
export function serverCriteria(criteria: Criterion[], logic: 'and' | 'or'): Criterion[] | null {
  const usable = criteria.filter(c => SERVER_FIELDS.has(c.field));
  if (usable.length === 0) return null;
  if (logic === 'and' && usable.length < criteria.length) return null;
  return usable;
}

/**
 * A rule's matcher inputs: criteria with streams resolved, ready to filter
 * on, or null when the rule can't match anything.
 */
export async function resolveRuleCriteria(
  admin: AdminClient,
  userId: string,
  rule: Pick<SweepRuleRow, 'criteria' | 'criteria_logic' | 'sender_pattern'>,
): Promise<{ criteria: Criterion[]; logic: 'and' | 'or' } | null> {
  const criteria = ruleCriteria(rule);
  if (criteria.length === 0) return null;
  const logic: 'and' | 'or' = rule.criteria_logic === 'or' ? 'or' : 'and';
  const resolved = serverCriteria(await resolveStreamCriteria(admin, criteria, userId), logic);
  return resolved ? { criteria: resolved, logic } : null;
}

/**
 * Live (not archived or deleted) emails matching resolved criteria, paging
 * past the client's default 1000-row limit.
 */
export async function findLiveMatches<T extends { id: string; received_at: string }>(
  admin: AdminClient,
  userId: string,
  criteria: Criterion[],
  logic: 'and' | 'or',
  columns = 'id, received_at',
): Promise<T[]> {
  const matching: T[] = [];
  const PAGE_SIZE = 1000;
  let offset = 0;
  while (true) {
    let query = admin
      .from('emails')
      .select(columns)
      .eq('user_id', userId)
      .eq('is_archived', false)
      .eq('is_deleted', false);

    query = applyCriteriaFilters(query, criteria, logic);
    // A stable order keeps pages from overlapping or skipping rows.
    query = query.order('id').range(offset, offset + PAGE_SIZE - 1);

    const { data, error } = await query;
    if (error) throw error;
    if (!data || data.length === 0) break;
    matching.push(...(data as unknown as T[]));
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return matching;
}

export interface QueueRow {
  email_id: string;
  executed: boolean;
  scheduled_at: string;
  sweep_rule_id: string | null;
}

export interface SweepPlan<T> {
  matches: T[];
  terminalAction: 'archive' | 'delete';
  /** received_at + delay_hours, per matching email. */
  scheduledAt: Map<string, string>;
  /** Already swept or exempted: never re-queued. */
  done: Set<string>;
  /** Pending under another rule at the same time or sooner: left alone. */
  keptPending: Map<string, QueueRow>;
  /** Pending under another rule but later: this rule's sooner time replaces it. */
  replaced: Map<string, QueueRow>;
  /** The newest match, which a keep_newest rule keeps. */
  keeper?: T;
  /** What gets queued. */
  eligible: T[];
}

/**
 * Works out what applying a rule would queue, without writing anything.
 * Returns null when the rule can't match anything.
 *
 * ignorePendingOf treats that rule's pending rows as gone — for previewing
 * an edit, where they are cleared before the rule is re-applied.
 */
export async function planSweepRule<T extends { id: string; received_at: string }>(
  admin: AdminClient,
  userId: string,
  rule: SweepRuleRow,
  opts: { columns?: string; ignorePendingOf?: string } = {},
): Promise<SweepPlan<T> | null> {
  const delayHours = Number(rule.delay_hours);
  if (!Number.isFinite(delayHours) || delayHours < 0) {
    throw new Error('Invalid delay_hours on rule');
  }
  const resolved = await resolveRuleCriteria(admin, userId, rule);
  if (!resolved) return null;

  const matches = await findLiveMatches<T>(admin, userId, resolved.criteria, resolved.logic, opts.columns);
  const scheduledAt = new Map<string, string>();
  for (const e of matches) {
    scheduledAt.set(
      e.id,
      new Date(new Date(e.received_at).getTime() + delayHours * 3600 * 1000).toISOString(),
    );
  }

  // Existing queue rows for the matches, in chunks to stay under
  // query-string limits on .in().
  const ids = matches.map(e => e.id);
  const existing: QueueRow[] = [];
  for (let i = 0; i < ids.length; i += 500) {
    const { data, error } = await admin
      .from('sweep_queue')
      .select('email_id, executed, scheduled_at, sweep_rule_id')
      .eq('user_id', userId)
      .in('email_id', ids.slice(i, i + 500));
    if (error) throw error;
    if (data) existing.push(...(data as QueueRow[]));
  }

  const done = new Set<string>();
  const keptPending = new Map<string, QueueRow>();
  const replaced = new Map<string, QueueRow>();
  for (const q of existing) {
    if (q.executed) {
      done.add(q.email_id);
    } else if (opts.ignorePendingOf && q.sweep_rule_id === opts.ignorePendingOf) {
      continue;
    } else if (new Date(scheduledAt.get(q.email_id)!).getTime() < new Date(q.scheduled_at).getTime()) {
      replaced.set(q.email_id, q);
    } else {
      keptPending.set(q.email_id, q);
    }
  }

  let eligible = matches.filter(e => !done.has(e.id) && !keptPending.has(e.id));
  let keeper: T | undefined;
  if (rule.action.startsWith('keep_newest_')) {
    eligible.sort((a, b) => new Date(b.received_at).getTime() - new Date(a.received_at).getTime());
    keeper = eligible[0];
    eligible = eligible.slice(1);
  }

  return {
    matches,
    terminalAction: terminalActionFor(rule.action),
    scheduledAt,
    done,
    keptPending,
    replaced,
    keeper,
    eligible,
  };
}

/**
 * Applies a rule to mail already in the inbox: queues every match that
 * isn't swept, exempted, or already due sooner under another rule (the
 * sooner rule wins). Returns how many rows were queued.
 */
export async function applySweepRule(
  admin: AdminClient,
  userId: string,
  rule: SweepRuleRow,
): Promise<number> {
  const plan = await planSweepRule(admin, userId, rule);
  if (!plan || plan.eligible.length === 0) return 0;

  // Upserting on (user_id, email_id) also replaces the later rows in
  // plan.replaced, so they need no separate delete.
  let totalQueued = 0;
  for (let i = 0; i < plan.eligible.length; i += 500) {
    const batch = plan.eligible.slice(i, i + 500).map(e => ({
      user_id: userId,
      email_id: e.id,
      sweep_rule_id: rule.id,
      scheduled_at: plan.scheduledAt.get(e.id)!,
      action: plan.terminalAction,
      executed: false,
    }));

    const { error } = await admin
      .from('sweep_queue')
      .upsert(batch, { onConflict: 'user_id,email_id' });

    if (error) {
      console.error(`Batch insert error at offset ${i}:`, error);
    } else {
      totalQueued += batch.length;
    }
  }
  return totalQueued;
}

/**
 * Apply criteria as Supabase/PostgREST filters.
 *
 * Field → DB column mapping:
 *   from    → sender_name, sender_email
 *   to      → recipients (JSONB text search)
 *   subject → subject
 *   body/snippet → snippet
 *   label   → labels (JSONB text search)
 *
 * Op → Postgres:
 *   contains     → ILIKE '%value%'
 *   not_contains → NOT ILIKE '%value%'
 *   equals       → ILIKE 'value'
 *   starts_with  → ILIKE 'value%'
 *   ends_with    → ILIKE '%value'
 */
// deno-lint-ignore no-explicit-any
export function applyCriteriaFilters(query: any, criteria: Criterion[], logic: 'and' | 'or') {
  if (criteria.length === 0) return query;

  if (logic === 'or') {
    // Build an OR filter string for PostgREST
    const orParts = criteria.map(c => buildFilterExpression(c)).flat();
    return query.or(orParts.join(','));
  }

  // AND logic: chain filters sequentially
  for (const c of criteria) {
    query = applyAndFilter(query, c);
  }
  return query;
}

function buildIlikePattern(op: string, value: string): string {
  // Strip surrounding quotes
  const v = value.replace(/^["']+|["']+$/g, '');
  switch (op) {
    case 'contains': return `%${v}%`;
    case 'not_contains': return `%${v}%`;
    case 'equals': return v;
    case 'starts_with': return `${v}%`;
    case 'ends_with': return `%${v}`;
    default: return `%${v}%`;
  }
}

/**
 * Build PostgREST filter expression strings for a single criterion.
 * Returns an array of filter strings suitable for .or() chaining.
 */
function buildFilterExpression(c: Criterion): string[] {
  const pattern = buildIlikePattern(c.op, c.value);
  const isNot = c.op === 'not_contains';
  const filterOp = isNot ? 'not.ilike' : 'ilike';

  switch (c.field) {
    case 'from':
      return [
        `sender_name.${filterOp}.${pattern}`,
        `sender_email.${filterOp}.${pattern}`,
      ];
    case 'to':
      return [`recipients::text.${filterOp}.${pattern}`];
    case 'subject':
      return [`subject.${filterOp}.${pattern}`];
    case 'body':
    case 'snippet':
      return [`snippet.${filterOp}.${pattern}`];
    case 'label':
      return [`labels::text.${filterOp}.${pattern}`];
    default:
      return [];
  }
}

/**
 * Apply a single criterion as a chained AND filter.
 */
// deno-lint-ignore no-explicit-any
function applyAndFilter(query: any, c: Criterion) {
  const pattern = buildIlikePattern(c.op, c.value);
  const isNot = c.op === 'not_contains';

  switch (c.field) {
    case 'from':
      // For AND + from: either sender_name or sender_email must match
      if (isNot) {
        // Both must NOT contain
        return query
          .not('sender_name', 'ilike', pattern)
          .not('sender_email', 'ilike', pattern);
      }
      return query.or(
        `sender_name.ilike.${pattern},sender_email.ilike.${pattern}`
      );
    case 'to':
      if (isNot) {
        return query.not('recipients::text', 'ilike', pattern);
      }
      return query.ilike('recipients::text', pattern);
    case 'subject':
      if (isNot) {
        return query.not('subject', 'ilike', pattern);
      }
      return query.ilike('subject', pattern);
    case 'body':
    case 'snippet':
      if (isNot) {
        return query.not('snippet', 'ilike', pattern);
      }
      return query.ilike('snippet', pattern);
    case 'label':
      if (isNot) {
        return query.not('labels::text', 'ilike', pattern);
      }
      return query.ilike('labels::text', pattern);
    default:
      return query;
  }
}
