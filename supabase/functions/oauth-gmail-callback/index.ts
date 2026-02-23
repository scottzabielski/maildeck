import { createAdminClient } from '../_shared/supabase-admin.ts';

/**
 * Gmail OAuth callback handler.
 *
 * Flow:
 * 1. Google redirects here with ?code=...&state=...
 * 2. Verify state JWT to get user_id
 * 3. Exchange code for access_token + refresh_token
 * 4. Fetch user profile (email, name)
 * 5. Encrypt tokens via DB function
 * 6. Upsert email_accounts row
 * 7. Redirect back to the app
 */
Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  const appUrl = Deno.env.get('APP_URL') || 'http://localhost:5173';

  if (error) {
    return redirectWithError(appUrl, `Google OAuth error: ${error}`);
  }

  if (!code || !state) {
    return redirectWithError(appUrl, 'Missing code or state parameter');
  }

  try {
    // Verify state JWT to get user_id
    const supabase = createAdminClient();
    const jwtSecret = Deno.env.get('SUPABASE_JWT_SECRET')!;
    const payload = await verifyJwt(state, jwtSecret);
    const userId = payload.sub;

    if (!userId) {
      return redirectWithError(appUrl, 'Invalid state token');
    }

    // Exchange authorization code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: Deno.env.get('GOOGLE_CLIENT_ID')!,
        client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!,
        redirect_uri: `${Deno.env.get('SUPABASE_URL')}/functions/v1/oauth-gmail-callback`,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) {
      const err = await tokenResponse.text();
      console.error('Token exchange failed:', err);
      return redirectWithError(appUrl, 'Failed to exchange authorization code');
    }

    const tokens = await tokenResponse.json();
    const { access_token, refresh_token, expires_in } = tokens;

    // Fetch user profile from Google
    const profileResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    if (!profileResponse.ok) {
      return redirectWithError(appUrl, 'Failed to fetch Google profile');
    }

    const profile = await profileResponse.json();
    const email = profile.email;
    const displayName = profile.name || email;

    // Encrypt tokens using DB functions (only accessible via service_role)
    const { data: encAccessToken } = await supabase.rpc('encrypt_token', {
      plain_text: access_token,
    });
    const { data: encRefreshToken } = await supabase.rpc('encrypt_token', {
      plain_text: refresh_token || '',
    });

    const expiresAt = new Date(Date.now() + (expires_in ?? 3600) * 1000).toISOString();

    // Get current max sort_order for the user
    const { data: existing } = await supabase
      .from('email_accounts')
      .select('sort_order')
      .eq('user_id', userId)
      .order('sort_order', { ascending: false })
      .limit(1);

    const nextSortOrder = existing && existing.length > 0 ? existing[0].sort_order + 1 : 0;

    // Pick a color from a palette based on sort order
    const COLORS = ['#ea4335', '#34a853', '#4285f4', '#fbbc04', '#ff6d01', '#46bdc6'];
    const color = COLORS[nextSortOrder % COLORS.length];

    // Upsert the email account (update tokens if account already exists)
    const { error: upsertError } = await supabase
      .from('email_accounts')
      .upsert(
        {
          user_id: userId,
          provider: 'gmail',
          email,
          display_name: displayName,
          color,
          sort_order: nextSortOrder,
          is_enabled: true,
          access_token_encrypted: encAccessToken,
          refresh_token_encrypted: encRefreshToken,
          token_expires_at: expiresAt,
          sync_status: 'never_synced',
        },
        { onConflict: 'user_id,email' },
      );

    if (upsertError) {
      console.error('Upsert failed:', upsertError);
      return redirectWithError(appUrl, 'Failed to save account');
    }

    // Redirect back to app with success
    return new Response(null, {
      status: 302,
      headers: {
        Location: `${appUrl}/settings/accounts?connected=gmail&email=${encodeURIComponent(email)}`,
      },
    });
  } catch (err) {
    console.error('OAuth callback error:', err);
    return redirectWithError(appUrl, 'Internal error during OAuth');
  }
});

function redirectWithError(appUrl: string, message: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${appUrl}/settings/accounts?error=${encodeURIComponent(message)}`,
    },
  });
}

/**
 * Minimal JWT verification using Web Crypto API.
 * Verifies HS256 signature and checks expiry.
 */
async function verifyJwt(
  token: string,
  secret: string,
): Promise<{ sub?: string; exp?: number }> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT');

  const [headerB64, payloadB64, signatureB64] = parts;

  // Verify signature
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );

  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = base64UrlDecode(signatureB64);

  const valid = await crypto.subtle.verify('HMAC', key, signature, data);
  if (!valid) throw new Error('Invalid JWT signature');

  // Decode payload
  const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadB64)));

  // Check expiry
  if (payload.exp && payload.exp < Date.now() / 1000) {
    throw new Error('JWT expired');
  }

  return payload;
}

function base64UrlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
