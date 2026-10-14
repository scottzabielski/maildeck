import { createAdminClient } from '../_shared/supabase-admin.ts';
import { corsHeaders } from '../_shared/cors.ts';
import {
  type AdminClient,
  type SweepRuleRow,
  findLiveMatches,
  queueState,
  resolveRuleCriteria,
  terminalActionFor,
} from '../_shared/sweepMatching.ts';

interface RuleRow extends SweepRuleRow {
  user_id: string;
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
  admin: AdminClient,
  rule: RuleRow,
): Promise<number> {
  const delayHours = Number(rule.delay_hours);
  if (!Number.isFinite(delayHours) || delayHours < 0) return 0;

  // Flatten stream refs and drop rules that can't match anything (shared
  // with apply-sweep-rule, so an unresolvable stream never matches all mail).
  const resolved = await resolveRuleCriteria(admin, rule.user_id, rule);
  if (!resolved) return 0;

  // Find matching emails.
  const matching = await findLiveMatches(admin, rule.user_id, resolved.criteria, resolved.logic);

  if (matching.length === 0) return 0;

  // Exclude anything already in sweep_queue (don't disturb existing
  // entries — this is a backfill, not a re-apply). queueState throws if the
  // lookup fails; without it the upsert below would reset exempted rows.
  const existing = new Set(
    (await queueState(admin, rule.user_id, matching.map(e => e.id))).map(r => r.email_id),
  );

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

  const terminalAction = terminalActionFor(rule.action);

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

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
