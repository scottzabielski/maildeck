import { createAdminClient } from '../_shared/supabase-admin.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { AuthError, requireUser } from '../_shared/auth.ts';
import { createClaudeClient } from '../_shared/claude.ts';
import { DraftError, draftSweepRule } from '../_shared/ruleDraft.ts';

/**
 * Drafts a sweep rule from a plain-English description, for the app's rule
 * editor. Returns the rule (conditions, action, delay, and a Claude check
 * when the conditions alone can't capture the description) for the user to
 * review and save; nothing is saved here. See _shared/ruleDraft.ts.
 */

// Soft per-user limit against accidental loops: a draft is a paid call.
const lastCall = new Map<string, number>();
const MIN_INTERVAL_MS = 3000;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    let userId: string;
    try {
      userId = await requireUser(req);
    } catch (err) {
      if (err instanceof AuthError) return jsonResponse({ error: err.message }, err.status);
      throw err;
    }

    const now = Date.now();
    if (now - (lastCall.get(userId) ?? 0) < MIN_INTERVAL_MS) {
      return jsonResponse({ error: 'Still working on the last one. Try again in a moment.' }, 429);
    }
    lastCall.set(userId, now);

    const body = (await req.json().catch(() => ({}))) as { description?: unknown };
    if (typeof body.description !== 'string') return jsonResponse({ error: 'Missing description' }, 400);

    const result = await draftSweepRule(
      createAdminClient(),
      createClaudeClient({ timeoutMs: 90_000 }),
      userId,
      body.description,
    );
    return jsonResponse(result);
  } catch (err) {
    if (err instanceof DraftError) return jsonResponse({ error: err.message }, 422);
    console.error('draft-sweep-rule error:', err);
    return jsonResponse({ error: 'Something went wrong drafting the rule.' }, 500);
  }
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
