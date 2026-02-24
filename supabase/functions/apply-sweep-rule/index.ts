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

    // Build the query against the full emails table, paginating to avoid the
    // default 1000-row limit in the Supabase JS client.
    const matchingEmails: { id: string; received_at: string }[] = [];
    const PAGE_SIZE = 1000;
    let offset = 0;
    while (true) {
      let query = admin
        .from('emails')
        .select('id, received_at')
        .eq('user_id', user_id)
        .eq('is_archived', false)
        .eq('is_deleted', false);

      query = applyCriteriaFilters(query, resolvedCriteria, criteria_logic);
      query = query.range(offset, offset + PAGE_SIZE - 1);

      const { data, error: queryError } = await query;
      if (queryError) throw queryError;
      if (!data || data.length === 0) break;
      matchingEmails.push(...data);
      if (data.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }

    if (matchingEmails.length === 0) {
      return jsonResponse({ queued: 0 });
    }

    // Compute scheduling up front so we can compare with existing queue items
    const isKeepNewest = action.startsWith('keep_newest_');
    const terminalAction = (action === 'delete' || action === 'keep_newest_delete')
      ? 'delete'
      : 'archive';

    // Build per-email scheduled_at map: received_at + delay_hours
    const scheduledAtMap = new Map<string, string>();
    for (const e of matchingEmails) {
      const scheduledAt = new Date(
        new Date(e.received_at).getTime() + delay_hours * 3600 * 1000
      ).toISOString();
      scheduledAtMap.set(e.id, scheduledAt);
    }

    // Exclude emails already in sweep_queue (pending) for this rule.
    // Also clear out old executed rows for matching emails so they can be re-queued.
    // If an email already has a pending sweep with a LATER scheduled_at, replace it
    // with the sooner one (sooner rule wins).
    const matchingIds = matchingEmails.map(e => e.id);

    // Fetch existing queue entries in chunks to avoid query-string limits on .in()
    const existingQueue: { email_id: string; executed: boolean; scheduled_at: string }[] = [];
    for (let i = 0; i < matchingIds.length; i += 500) {
      const chunk = matchingIds.slice(i, i + 500);
      const { data } = await admin
        .from('sweep_queue')
        .select('email_id, executed, scheduled_at')
        .eq('user_id', user_id)
        .in('email_id', chunk);
      if (data) existingQueue.push(...data);
    }

    const skipIds = new Set<string>();
    const replaceSoonerIds: string[] = [];
    for (const q of existingQueue || []) {
      if (q.executed) {
        // Already swept — don't re-queue
        skipIds.add(q.email_id);
      } else {
        // If the new scheduled_at is sooner, replace the existing pending item
        const newScheduledAt = scheduledAtMap.get(q.email_id)!;
        if (new Date(newScheduledAt).getTime() < new Date(q.scheduled_at).getTime()) {
          replaceSoonerIds.push(q.email_id);
        } else {
          skipIds.add(q.email_id);
        }
      }
    }

    // Delete pending rows that will be replaced with a sooner scheduled_at
    for (let i = 0; i < replaceSoonerIds.length; i += 500) {
      const chunk = replaceSoonerIds.slice(i, i + 500);
      await admin
        .from('sweep_queue')
        .delete()
        .eq('user_id', user_id)
        .in('email_id', chunk);
    }

    let eligible = matchingEmails.filter(e => !skipIds.has(e.id));

    // For keep_newest actions, skip the most recent email
    if (isKeepNewest && eligible.length > 1) {
      eligible.sort((a, b) =>
        new Date(b.received_at).getTime() - new Date(a.received_at).getTime()
      );
      eligible = eligible.slice(1);
    } else if (isKeepNewest && eligible.length <= 1) {
      return jsonResponse({ queued: 0 });
    }

    // Batch-insert into sweep_queue (chunks of 500 to stay within limits)
    let totalQueued = 0;
    for (let i = 0; i < eligible.length; i += 500) {
      const batch = eligible.slice(i, i + 500).map(e => ({
        user_id,
        email_id: e.id,
        sweep_rule_id: rule_id,
        scheduled_at: scheduledAtMap.get(e.id)!,
        action: terminalAction,
        executed: false,
      }));

      const { error: insertError } = await admin
        .from('sweep_queue')
        .upsert(batch, { onConflict: 'user_id,email_id' });

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
