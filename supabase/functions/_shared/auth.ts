import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * Validate a Supabase user JWT from the Authorization header.
 *
 * Called at the top of edge functions that act on per-user resources.
 * We intentionally do NOT rely on the edge runtime's `verify_jwt: true`
 * setting — that was inconsistent across dashboard vs. repo config and
 * caused apply-sweep-rule to silently 401 for ~6 weeks. Instead, every
 * sensitive function disables `verify_jwt` in config.toml and calls this
 * helper to do the check in code.
 *
 * Returns the authenticated user's id. Throws an AuthError (carrying an
 * HTTP status) if the header is missing, the token is invalid, or the
 * user cannot be resolved.
 */
export class AuthError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// Module-scope anon client — edge function workers are persistent
// (policy = per_worker in config.toml) so we only pay the setup cost
// once. Fail fast at import time if the env vars are missing so a
// misconfigured worker doesn't quietly 401 every request with a
// confusing "Invalid token" error.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    'auth helper: SUPABASE_URL and SUPABASE_ANON_KEY must be set in the function environment',
  );
}
const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export async function requireUser(req: Request): Promise<string> {
  // Headers.get() is case-insensitive per the Fetch spec.
  const header = req.headers.get('authorization');
  if (!header || !header.toLowerCase().startsWith('bearer ')) {
    throw new AuthError(401, 'Missing bearer token');
  }
  const token = header.slice(7).trim();
  if (!token) {
    throw new AuthError(401, 'Empty bearer token');
  }

  // getUser(token) validates the JWT against the project's JWT secret
  // via GoTrue — no service role needed.
  const { data, error } = await anonClient.auth.getUser(token);
  if (error || !data.user) {
    throw new AuthError(401, error?.message || 'Invalid token');
  }
  return data.user.id;
}
