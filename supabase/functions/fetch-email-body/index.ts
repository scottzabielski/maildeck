import { createAdminClient } from '../_shared/supabase-admin.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { AuthError, requireUser } from '../_shared/auth.ts';

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

    if (account.provider === 'gmail') {
      const result = await fetchGmailBody(accessToken, email.provider_message_id);
      bodyHtml = result.html;
      bodyText = result.text;
    } else {
      const result = await fetchOutlookBody(accessToken, email.provider_message_id);
      bodyHtml = result.html;
      bodyText = result.text;
    }

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
// Gmail body fetch
// ============================================================

async function fetchGmailBody(
  accessToken: string,
  messageId: string,
): Promise<{ html: string | null; text: string | null }> {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=FULL`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );

  if (!res.ok) {
    throw new Error(`Gmail API error (${res.status}): ${await res.text()}`);
  }

  const msg = await res.json();
  return extractGmailBody(msg.payload);
}

function extractGmailBody(
  payload: Record<string, unknown>,
): { html: string | null; text: string | null } {
  let html: string | null = null;
  let text: string | null = null;

  const mimeType = payload.mimeType as string;
  const body = payload.body as { data?: string; size?: number } | undefined;
  const parts = payload.parts as Array<Record<string, unknown>> | undefined;

  // Single-part message
  if (body?.data) {
    const decoded = base64UrlDecode(body.data);
    if (mimeType === 'text/html') html = decoded;
    else if (mimeType === 'text/plain') text = decoded;
  }

  // Multipart — recurse into parts
  if (parts) {
    for (const part of parts) {
      const partMime = part.mimeType as string;
      const partBody = part.body as { data?: string } | undefined;
      const subParts = part.parts as Array<Record<string, unknown>> | undefined;

      if (partBody?.data) {
        const decoded = base64UrlDecode(partBody.data);
        if (partMime === 'text/html' && !html) html = decoded;
        else if (partMime === 'text/plain' && !text) text = decoded;
      }

      // Recurse for nested multipart (e.g. multipart/alternative inside multipart/mixed)
      if (subParts) {
        const nested = extractGmailBody(part);
        if (nested.html && !html) html = nested.html;
        if (nested.text && !text) text = nested.text;
      }
    }
  }

  return { html, text };
}

function base64UrlDecode(data: string): string {
  // Gmail returns base64url-encoded data
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64);
  // Handle UTF-8 properly
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder('utf-8').decode(bytes);
}

// ============================================================
// Outlook body fetch
// ============================================================

async function fetchOutlookBody(
  accessToken: string,
  messageId: string,
): Promise<{ html: string | null; text: string | null }> {
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/me/messages/${messageId}?$select=body,uniqueBody`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );

  if (!res.ok) {
    throw new Error(`Graph API error (${res.status}): ${await res.text()}`);
  }

  const msg = await res.json();
  const body = msg.body as { contentType: string; content: string } | undefined;

  if (!body) return { html: null, text: null };

  if (body.contentType === 'html') {
    return { html: body.content, text: null };
  }
  return { html: null, text: body.content };
}

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
