import { createAdminClient } from '../_shared/supabase-admin.ts';
import { corsHeaders } from '../_shared/cors.ts';

interface Criterion {
  field: string;
  op: string;
  value: string;
}

/**
 * Apply sweep rule Edge Function.
 *
 * Evaluates sweep rule criteria against the FULL emails table (not just
 * paginated client-side emails) and batch-inserts matching email IDs
 * into sweep_queue.
 *
 * Accepts: POST { rule_id, user_id, criteria, criteria_logic, action, delay_hours }
 * Returns: { queued: N }
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const {
      rule_id,
      user_id,
      criteria,
      criteria_logic,
      action,
      delay_hours,
    } = (await req.json()) as {
      rule_id: string;
      user_id: string;
      criteria: Criterion[];
      criteria_logic: 'and' | 'or';
      action: string;
      delay_hours: number;
    };

    if (!user_id || !rule_id || !criteria || criteria.length === 0) {
      return jsonResponse({ error: 'Missing required fields' }, 400);
    }

    const admin = createAdminClient();

    // Resolve stream criteria: if any criterion uses field="stream",
    // load the referenced column's criteria and flatten them
    const resolvedCriteria = await resolveStreamCriteria(admin, criteria, user_id);

    // Build the query against the full emails table
    let query = admin
      .from('emails')
      .select('id, received_at')
      .eq('user_id', user_id)
      .eq('is_archived', false)
      .eq('is_deleted', false);

    // Apply criteria filters
    query = applyCriteriaFilters(query, resolvedCriteria, criteria_logic);

    const { data: matchingEmails, error: queryError } = await query;
    if (queryError) throw queryError;

    if (!matchingEmails || matchingEmails.length === 0) {
      return jsonResponse({ queued: 0 });
    }

    // Exclude emails already in sweep_queue (pending) for this rule.
    // Also clear out old executed rows for matching emails so they can be re-queued
    // (e.g., if the provider action failed or the email reappeared in the inbox).
    const matchingIds = matchingEmails.map(e => e.id);

    const { data: existingQueue } = await admin
      .from('sweep_queue')
      .select('email_id, executed')
      .eq('user_id', user_id)
      .in('email_id', matchingIds);

    const pendingIds = new Set<string>();
    const executedIds: string[] = [];
    for (const q of existingQueue || []) {
      if (q.executed) {
        executedIds.push(q.email_id);
      } else {
        pendingIds.add(q.email_id);
      }
    }

    // Delete executed rows so the upsert can re-insert them
    if (executedIds.length > 0) {
      await admin
        .from('sweep_queue')
        .delete()
        .eq('user_id', user_id)
        .in('email_id', executedIds);
    }

    let eligible = matchingEmails.filter(e => !pendingIds.has(e.id));

    // For keep_newest actions, skip the most recent email
    const isKeepNewest = action.startsWith('keep_newest_');
    if (isKeepNewest && eligible.length > 1) {
      eligible.sort((a, b) =>
        new Date(b.received_at).getTime() - new Date(a.received_at).getTime()
      );
      eligible = eligible.slice(1);
    } else if (isKeepNewest && eligible.length <= 1) {
      return jsonResponse({ queued: 0 });
    }

    // Determine terminal action for the queue
    const terminalAction = (action === 'delete' || action === 'keep_newest_delete')
      ? 'delete'
      : 'archive';

    const scheduledAt = new Date(
      Date.now() + (isKeepNewest ? 0 : delay_hours) * 3600 * 1000
    ).toISOString();

    // Batch-insert into sweep_queue (chunks of 500 to stay within limits)
    let totalQueued = 0;
    for (let i = 0; i < eligible.length; i += 500) {
      const batch = eligible.slice(i, i + 500).map(e => ({
        user_id,
        email_id: e.id,
        sweep_rule_id: rule_id,
        scheduled_at: scheduledAt,
        action: terminalAction,
        executed: false,
      }));

      const { error: insertError } = await admin
        .from('sweep_queue')
        .upsert(batch, { onConflict: 'user_id,email_id', ignoreDuplicates: true });

      if (insertError) {
        console.error(`Batch insert error at offset ${i}:`, insertError);
      } else {
        totalQueued += batch.length;
      }
    }

    return jsonResponse({ queued: totalQueued });
  } catch (err) {
    console.error('Apply sweep rule error:', err);
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});

/**
 * Resolve "stream" criteria by loading the referenced column's criteria
 * from the columns table and replacing the stream criterion with them.
 * Only one level deep to prevent infinite recursion.
 */
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

    // Load the column by ID or name
    let columnQuery = admin
      .from('columns')
      .select('criteria, criteria_logic')
      .eq('user_id', userId);

    // Try by ID first (UUIDs), fall back to name
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c.value);
    if (isUuid) {
      columnQuery = columnQuery.eq('id', c.value);
    } else {
      columnQuery = columnQuery.ilike('name', c.value);
    }

    const { data: columns } = await columnQuery.limit(1);
    if (columns && columns.length > 0) {
      const colCriteria = columns[0].criteria as Criterion[];
      // Flatten column criteria (skip any nested stream refs to prevent recursion)
      for (const cc of colCriteria) {
        if (cc.field !== 'stream') {
          resolved.push(cc);
        }
      }
    }
  }

  return resolved;
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
function applyCriteriaFilters(query: any, criteria: Criterion[], logic: 'and' | 'or') {
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

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
