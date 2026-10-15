import { createAdminClient } from '../_shared/supabase-admin.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { AuthError, requireUser } from '../_shared/auth.ts';
import { fetchGmailContent, fetchOutlookContent } from '../_shared/emailContent.ts';

/**
 * Fetch the full HTML/text body of an email on demand.
 *
 * 1. Look up the email row + account details
 * 2. If body_html is already cached, return it immediately
 * 3. Otherwise, fetch from Gmail/Outlook API, cache in DB, return
 */
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

    const body = (await req.json().catch(() => ({}))) as { email_id?: unknown };
    if (typeof body.email_id !== 'string' || body.email_id.length === 0) {
      return jsonResponse({ error: 'Missing email_id' }, 400);
    }
    const email_id: string = body.email_id;

    const supabase = createAdminClient();

    // Fetch email row with account info.
    // The user_id filter enforces ownership — a caller cannot read
    // another user's email body by supplying its id.
    const { data: email, error: emailErr } = await supabase
      .from('emails')
      .select('id, provider_message_id, account_id, body_html, body_text')
      .eq('id', email_id)
      .eq('user_id', userId)
      .maybeSingle();

    if (emailErr || !email) {
      return jsonResponse({ error: 'Email not found' }, 404);
    }

    // Return cached body if available
    if (email.body_html || email.body_text) {
      return jsonResponse({
        body_html: email.body_html,
        body_text: email.body_text,
      });
    }

    // Fetch account to get provider + token
    const { data: account, error: acctErr } = await supabase
      .from('email_accounts')
      .select('id, provider, access_token_encrypted, refresh_token_encrypted, token_expires_at')
      .eq('id', email.account_id)
      .eq('user_id', userId)
      .maybeSingle();

    if (acctErr || !account) {
      return jsonResponse({ error: 'Account not found' }, 404);
    }

    // Decrypt access token
    let accessToken = await decryptToken(supabase, account.access_token_encrypted);

    // Refresh if expired
    if (account.token_expires_at && new Date(account.token_expires_at) <= new Date()) {
      accessToken = await refreshAndUpdate(supabase, account);
    }

    let bodyHtml: string | null = null;
    let bodyText: string | null = null;

    const result = account.provider === 'gmail'
      ? await fetchGmailContent(accessToken, email.provider_message_id)
      : await fetchOutlookContent(accessToken, email.provider_message_id);
    bodyHtml = result.html;
    bodyText = result.text;

    // Cache in database — re-assert user_id for defense in depth.
    await supabase
      .from('emails')
      .update({ body_html: bodyHtml, body_text: bodyText })
      .eq('id', email_id)
      .eq('user_id', userId);

    return jsonResponse({ body_html: bodyHtml, body_text: bodyText });
  } catch (err) {
    console.error('fetch-email-body error:', err);
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});

// ============================================================
// Token helpers (same as sync-emails)
// ============================================================

async function decryptToken(
  supabase: ReturnType<typeof createAdminClient>,
  encryptedToken: unknown,
): Promise<string> {
  if (!encryptedToken) throw new Error('No encrypted token');
  const { data, error } = await supabase.rpc('decrypt_token', {
    encrypted_text: encryptedToken,
  });
  if (error) throw error;
  return data as string;
}

async function refreshAndUpdate(
  supabase: ReturnType<typeof createAdminClient>,
  account: Record<string, unknown>,
): Promise<string> {
  const refreshToken = await decryptToken(supabase, account.refresh_token_encrypted);
  const provider = account.provider as string;
  const accountId = account.id as string;

  let tokenUrl: string;
  const params: Record<string, string> = {
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  };

  if (provider === 'gmail') {
    tokenUrl = 'https://oauth2.googleapis.com/token';
    params.client_id = Deno.env.get('GOOGLE_CLIENT_ID')!;
    params.client_secret = Deno.env.get('GOOGLE_CLIENT_SECRET')!;
  } else {
    tokenUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
    params.client_id = Deno.env.get('MICROSOFT_CLIENT_ID')!;
    params.client_secret = Deno.env.get('MICROSOFT_CLIENT_SECRET')!;
  }

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });

  if (!res.ok) {
    throw new Error(`Token refresh failed: ${await res.text()}`);
  }

  const tokens = await res.json();

  const { data: encAccess } = await supabase.rpc('encrypt_token', {
    plain_text: tokens.access_token,
  });

  const updates: Record<string, unknown> = {
    access_token_encrypted: encAccess,
    token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
  };

  if (tokens.refresh_token) {
    const { data: encRefresh } = await supabase.rpc('encrypt_token', {
      plain_text: tokens.refresh_token,
    });
    updates.refresh_token_encrypted = encRefresh;
  }

  await supabase
    .from('email_accounts')
    .update(updates)
    .eq('id', accountId);

  return tokens.access_token;
}

// ============================================================
// Helpers
// ============================================================

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
