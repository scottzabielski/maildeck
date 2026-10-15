import { createAdminClient } from '../_shared/supabase-admin.ts';
import type { AdminClient } from '../_shared/sweepMatching.ts';
import { ApiError, type Args, type Ctx, FILTER_SYNTAX_MESSAGE, isFilterSyntaxError, isStatementTimeout, sha256Hex } from './common.ts';
import { createRule, deleteRule, draftRule, listRules, previewRule, updateRule } from './rules.ts';
import { createStream, deleteStream, listStreams, updateStream } from './streams.ts';
import { exemptSweeps, listSweeps, resolveSweeps, status } from './sweeps.ts';

/**
 * MailDeck API for the mail MCP server (the mail-mcp Cloudflare Worker).
 *
 * Accepts: POST { op, args } with "Authorization: Bearer mdk_…".
 * The key maps to one user through public.api_keys (only its SHA-256 hash
 * is stored) and every query is scoped to that user. verify_jwt is off at
 * the gateway because the key isn't a JWT, so the key check below is the
 * only door and runs before anything else.
 *
 * Returns the op's result, or { error } with a 4xx status for problems the
 * caller can fix (worded for the model to read) and 500 otherwise.
 */

const OPS = new Map<string, (ctx: Ctx, args: Args) => Promise<unknown>>([
  ['status', status],
  ['rules.list', listRules],
  ['rules.preview', previewRule],
  ['rules.create', createRule],
  ['rules.update', updateRule],
  ['rules.delete', deleteRule],
  ['rules.draft', draftRule],
  ['sweeps.list', listSweeps],
  ['sweeps.exempt', exemptSweeps],
  ['sweeps.resolve', resolveSweeps],
  ['streams.list', listStreams],
  ['streams.create', createStream],
  ['streams.update', updateStream],
  ['streams.delete', deleteStream],
]);

const KEY_RE = /^mdk_[A-Za-z0-9_-]{32,128}$/;

async function authenticate(req: Request, admin: AdminClient): Promise<string> {
  const header = req.headers.get('authorization') ?? '';
  const key = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  if (!KEY_RE.test(key)) throw new ApiError(401, 'Missing or malformed API key');

  const { data, error } = await admin
    .from('api_keys')
    .select('id, user_id, last_used_at')
    .eq('key_hash', await sha256Hex(key))
    .is('revoked_at', null)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiError(401, 'Invalid API key');

  // Record use, at most every few minutes.
  if (!data.last_used_at || Date.parse(data.last_used_at) < Date.now() - 5 * 60_000) {
    await admin.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', data.id);
  }
  return data.user_id as string;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return jsonResponse({ error: 'Use POST' }, 405);

  const started = Date.now();
  const admin = createAdminClient();
  let op = '(none)';
  try {
    const userId = await authenticate(req, admin);
    const body = (await req.json().catch(() => null)) as { op?: unknown; args?: unknown } | null;
    if (typeof body?.op === 'string') op = body.op.slice(0, 40);
    const fn = OPS.get(op);
    if (!fn) throw new ApiError(400, `Unknown op "${op}"`);
    const args = body?.args ?? {};
    if (typeof args !== 'object' || args === null || Array.isArray(args)) {
      throw new ApiError(400, 'args must be an object');
    }

    const result = await fn({ admin, userId }, args as Args);
    console.log(`[mcp-api] ${op} ok ${Date.now() - started}ms`);
    return jsonResponse(result);
  } catch (err) {
    if (err instanceof ApiError) {
      console.log(`[mcp-api] ${op} ${err.status} ${Date.now() - started}ms`);
      return jsonResponse({ error: err.message }, err.status);
    }
    if (isFilterSyntaxError(err)) {
      console.log(`[mcp-api] ${op} 422 filter syntax ${Date.now() - started}ms`);
      return jsonResponse({ error: FILTER_SYNTAX_MESSAGE }, 422);
    }
    if (isStatementTimeout(err)) {
      console.warn(`[mcp-api] ${op} 503 statement timeout ${Date.now() - started}ms`);
      return jsonResponse({ error: "MailDeck's database timed out on that request (it may be busy syncing). Try again in a minute." }, 503);
    }
    console.error(`[mcp-api] ${op} failed:`, err);
    return jsonResponse({ error: 'Internal error' }, 500);
  }
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
