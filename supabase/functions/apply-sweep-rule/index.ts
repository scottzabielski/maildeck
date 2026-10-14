import { createAdminClient } from '../_shared/supabase-admin.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { AuthError, requireUser } from '../_shared/auth.ts';
import { applySweepRule } from '../_shared/sweepMatching.ts';

/**
 * Apply sweep rule Edge Function.
 *
 * Evaluates sweep rule criteria against the FULL emails table (not just
 * paginated client-side emails) and batch-inserts matching email IDs
 * into sweep_queue. The matching itself lives in _shared/sweepMatching.ts,
 * shared with sweep-backfill and mcp-api.
 *
 * Accepts: POST { rule_id }
 * The user_id is derived from the JWT — callers cannot target another
 * user. criteria / criteria_logic / action / delay_hours are read from
 * the rule row in the DB, NOT the request body, so a caller holding a
 * legitimate rule_id cannot substitute their own criteria or actions.
 * Returns: { queued: N }
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    let user_id: string;
    try {
      user_id = await requireUser(req);
    } catch (err) {
      if (err instanceof AuthError) return jsonResponse({ error: err.message }, err.status);
      throw err;
    }

    const body = (await req.json().catch(() => ({}))) as { rule_id?: string };
    const rule_id = body.rule_id;
    if (!rule_id || typeof rule_id !== 'string') {
      return jsonResponse({ error: 'Missing rule_id' }, 400);
    }

    const admin = createAdminClient();

    // Load the rule and verify ownership in a single query. Filtering by
    // (id, user_id) means callers cannot distinguish "rule does not
    // exist" from "rule belongs to someone else" — both return 404.
    const { data: ruleRow, error: ruleErr } = await admin
      .from('sweep_rules')
      .select('id, criteria, criteria_logic, action, delay_hours, sender_pattern, is_enabled')
      .eq('id', rule_id)
      .eq('user_id', user_id)
      .maybeSingle();
    if (ruleErr || !ruleRow) {
      return jsonResponse({ error: 'Rule not found' }, 404);
    }
    if (!ruleRow.is_enabled) {
      return jsonResponse({ error: 'Rule is disabled' }, 409);
    }

    const queued = await applySweepRule(admin, user_id, ruleRow);
    return jsonResponse({ queued });
  } catch (err) {
    console.error('Apply sweep rule error:', err);
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
