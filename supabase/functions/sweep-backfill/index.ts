import { createAdminClient } from '../_shared/supabase-admin.ts';
import { corsHeaders } from '../_shared/cors.ts';

interface Criterion {
  field: string;
  op: string;
  value: string;
}

interface RuleRow {
  id: string;
  user_id: string;
  criteria: Criterion[];
  criteria_logic: 'and' | 'or';
  action: string;
  delay_hours: number;
  sender_pattern: string | null;
}

/**
 * Sweep backfill — periodic safety net.
 *
 * The apply_sweep_rules_on_insert trigger queues new emails as they sync.
 * But emails that arrived BEFORE a rule was created (or before it was
 * applied) stay outside the queue until the user manually re-applies the
 * rule. This function walks every enabled rule across every user, finds
 * matching emails not already queued, and enqueues them.
 *
 * Authentication: relies on service-role key, NOT user JWT. Invoked by
 * pg_cron with a Bearer token in the Authorization header. The check here
 * is an explicit equality test against SUPABASE_SERVICE_ROLE_KEY so a
 * leaked anon key cannot trigger arbitrary backfills.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Shared-secret auth check. The cron job sends a Bearer token; we compare
  // it against a SWEEP_BACKFILL_SECRET env var so the function isn't
  // open to anonymous callers (verify_jwt is off at the gateway).
  const auth = req.headers.get('authorization');
  const secret = Deno.env.get('SWEEP_BACKFILL_SECRET');
  if (!secret) {
    console.error('[sweep-backfill] SWEEP_BACKFILL_SECRET not configured');
    return jsonResponse({ error: 'Server misconfigured' }, 500);
  }
  if (!auth || auth !== `Bearer ${secret}`) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  try {
    const admin = createAdminClient();

    const { data: rules, error: rulesErr } = await admin
      .from('sweep_rules')
      .select('id, user_id, criteria, criteria_logic, action, delay_hours, sender_pattern')
      .eq('is_enabled', true);
    if (rulesErr) throw rulesErr;

    let totalQueued = 0;
    let rulesProcessed = 0;
    const perRule: Record<string, number> = {};

    for (const row of (rules ?? []) as RuleRow[]) {
      try {
        const queued = await processRule(admin, row);
        totalQueued += queued;
        perRule[row.id] = queued;
        rulesProcessed += 1;
      } catch (err) {
        console.error(`[sweep-backfill] rule ${row.id} failed:`, (err as Error).message);
      }
    }

    return jsonResponse({ rulesProcessed, totalQueued, perRule });
  } catch (err) {
    console.error('[sweep-backfill] error:', err);
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});

async function processRule(
  admin: ReturnType<typeof createAdminClient>,
  rule: RuleRow,
): Promise<number> {
  // Normalize criteria.
  let criteria: Criterion[] = Array.isArray(rule.criteria)
    ? (rule.criteria as unknown[]).filter(
        (c): c is Criterion =>
          !!c && typeof c === 'object' &&
          typeof (c as Criterion).field === 'string' &&
          typeof (c as Criterion).op === 'string' &&
          typeof (c as Criterion).value === 'string',
      )
    : [];
  const logic: 'and' | 'or' = rule.criteria_logic === 'or' ? 'or' : 'and';
  const delayHours = Number(rule.delay_hours);
  if (!Number.isFinite(delayHours) || delayHours < 0) return 0;

  if (criteria.length === 0) {
    if (!rule.sender_pattern) return 0;
    criteria = [{ field: 'from', op: 'contains', value: rule.sender_pattern }];
  }

  // Flatten stream refs (single-level, same as apply-sweep-rule).
  const resolvedCriteria = await resolveStreamCriteria(admin, criteria, rule.user_id);

  // Find matching emails.
  const matching: { id: string; received_at: string }[] = [];
  const PAGE_SIZE = 1000;
  let offset = 0;
  while (true) {
    let q = admin
      .from('emails')
      .select('id, received_at')
      .eq('user_id', rule.user_id)
      .eq('is_archived', false)
      .eq('is_deleted', false);

    q = applyCriteriaFilters(q, resolvedCriteria, logic);
    q = q.range(offset, offset + PAGE_SIZE - 1);

    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    matching.push(...data);
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  if (matching.length === 0) return 0;

  // Exclude anything already in sweep_queue (don't disturb existing
  // entries — this is a backfill, not a re-apply).
  const ids = matching.map(e => e.id);
  const existing = new Set<string>();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const { data } = await admin
      .from('sweep_queue')
      .select('email_id')
      .eq('user_id', rule.user_id)
      .in('email_id', chunk);
    for (const r of data ?? []) existing.add((r as { email_id: string }).email_id);
  }

  let eligible = matching.filter(e => !existing.has(e.id));

  // For keep_newest, skip the most recent matching email.
  const isKeepNewest = rule.action.startsWith('keep_newest_');
  if (isKeepNewest && eligible.length > 1) {
    eligible.sort((a, b) =>
      new Date(b.received_at).getTime() - new Date(a.received_at).getTime()
    );
    eligible = eligible.slice(1);
  } else if (isKeepNewest && eligible.length <= 1) {
    return 0;
  }

  if (eligible.length === 0) return 0;

  const terminalAction = rule.action === 'delete' || rule.action === 'keep_newest_delete' ? 'delete' : 'archive';

  let queued = 0;
  for (let i = 0; i < eligible.length; i += 500) {
    const batch = eligible.slice(i, i + 500).map(e => ({
      user_id: rule.user_id,
      email_id: e.id,
      sweep_rule_id: rule.id,
      scheduled_at: new Date(
        new Date(e.received_at).getTime() + delayHours * 3600 * 1000
      ).toISOString(),
      action: terminalAction,
      executed: false,
    }));
    const { error } = await admin
      .from('sweep_queue')
      .upsert(batch, { onConflict: 'user_id,email_id' });
    if (error) {
      console.error(`[sweep-backfill] insert error rule=${rule.id} offset=${i}:`, error);
    } else {
      queued += batch.length;
    }
  }

  return queued;
}

// ---------- Filter helpers (mirror apply-sweep-rule/index.ts) ----------

async function resolveStreamCriteria(
  admin: ReturnType<typeof createAdminClient>,
  criteria: Criterion[],
  userId: string,
): Promise<Criterion[]> {
  const resolved: Criterion[] = [];
  for (const c of criteria) {
    if (c.field !== 'stream') {
      resolved.push(c);
      continue;
    }
    let q = admin.from('columns').select('criteria, criteria_logic').eq('user_id', userId);
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c.value);
    if (isUuid) q = q.eq('id', c.value);
    else q = q.ilike('name', c.value);
    const { data } = await q.limit(1);
    if (data && data.length > 0) {
      const cc = data[0].criteria as Criterion[];
      for (const x of cc) if (x.field !== 'stream') resolved.push(x);
    }
  }
  return resolved;
}

// deno-lint-ignore no-explicit-any
function applyCriteriaFilters(query: any, criteria: Criterion[], logic: 'and' | 'or') {
  if (criteria.length === 0) return query;
  if (logic === 'or') {
    const orParts = criteria.map(c => buildFilterExpression(c)).flat();
    return query.or(orParts.join(','));
  }
  for (const c of criteria) query = applyAndFilter(query, c);
  return query;
}

function buildIlikePattern(op: string, value: string): string {
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
    case 'to': return [`recipients::text.${filterOp}.${pattern}`];
    case 'subject': return [`subject.${filterOp}.${pattern}`];
    case 'body':
    case 'snippet': return [`snippet.${filterOp}.${pattern}`];
    case 'label': return [`labels::text.${filterOp}.${pattern}`];
    default: return [];
  }
}

// deno-lint-ignore no-explicit-any
function applyAndFilter(query: any, c: Criterion) {
  const pattern = buildIlikePattern(c.op, c.value);
  const isNot = c.op === 'not_contains';
  switch (c.field) {
    case 'from':
      if (isNot) return query.not('sender_name', 'ilike', pattern).not('sender_email', 'ilike', pattern);
      return query.or(`sender_name.ilike.${pattern},sender_email.ilike.${pattern}`);
    case 'to':
      if (isNot) return query.not('recipients::text', 'ilike', pattern);
      return query.ilike('recipients::text', pattern);
    case 'subject':
      if (isNot) return query.not('subject', 'ilike', pattern);
      return query.ilike('subject', pattern);
    case 'body':
    case 'snippet':
      if (isNot) return query.not('snippet', 'ilike', pattern);
      return query.ilike('snippet', pattern);
    case 'label':
      if (isNot) return query.not('labels::text', 'ilike', pattern);
      return query.ilike('labels::text', pattern);
    default: return query;
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
