import { createAdminClient } from '../_shared/supabase-admin.ts';
import { createClaudeClient } from '../_shared/claude.ts';
import { runChecks } from '../_shared/claudeCheck.ts';
import { SupabaseCheckStore, providerBodySource } from '../_shared/claudeCheckStore.ts';

/**
 * Sweep check — Claude's verdicts for Claude-checked sweep rules.
 *
 * Called by pg_cron every minute. Messages a Claude-checked rule matched
 * wait in the sweep queue (ai_status 'pending'); this asks Claude about up
 * to 25 of them per run and records match, no_match or unsure. Only a
 * match is ever swept (sweep-execute skips everything else). Failures,
 * spent budgets and a missing key leave messages waiting; see
 * _shared/claudeCheck.ts.
 *
 * Authentication: the cron job sends the same shared secret as
 * sweep-backfill (its command is a copy of that job's, migration 019).
 */
Deno.serve(async (req) => {
  const secret = Deno.env.get('SWEEP_BACKFILL_SECRET');
  if (!secret) {
    console.error('[sweep-check] SWEEP_BACKFILL_SECRET not configured');
    return jsonResponse({ error: 'Server misconfigured' }, 500);
  }
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  try {
    const admin = createAdminClient();
    const summary = await runChecks(
      new SupabaseCheckStore(admin),
      createClaudeClient(),
      providerBodySource(admin),
      { deadline: Date.now() + 45_000 },
    );
    if (summary.claimed) console.log('[sweep-check]', JSON.stringify(summary));
    return jsonResponse(summary);
  } catch (err) {
    console.error('[sweep-check] error:', err);
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
