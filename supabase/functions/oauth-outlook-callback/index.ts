import { createAdminClient } from '../_shared/supabase-admin.ts';

/**
 * Outlook OAuth callback handler.
 *
 * Flow:
 * 1. Microsoft redirects here with ?code=...&state=...
 * 2. Verify state JWT to get user_id
 * 3. Exchange code for access_token + refresh_token
 * 4. Fetch user profile (email, displayName)
 * 5. Encrypt tokens via DB function
 * 6. Upsert email_accounts row
 * 7. Redirect back to the app
 */
Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  const errorDesc = url.searchParams.get('error_description');

  const appUrl = Deno.env.get('APP_URL') || 'http://localhost:5173';

  if (error) {
    return redirectWithError(appUrl, errorDesc || `Microsoft OAuth error: ${error}`);
  }

  if (!code || !state) {
    return redirectWithError(appUrl, 'Missing code or state parameter');
  }

  try {
    const supabase = createAdminClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser(state);

    if (authError || !user) {
      console.error('Auth verification failed:', authError);
      return redirectWithError(appUrl, 'Invalid or expired session. Please log in and try again.');
    }

    const userId = user.id;

    // Exchange authorization code for tokens
    const tokenResponse = await fetch(
      'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: Deno.env.get('MICROSOFT_CLIENT_ID')!,
          client_secret: Deno.env.get('MICROSOFT_CLIENT_SECRET')!,
          redirect_uri: `${Deno.env.get('SUPABASE_URL')}/functions/v1/oauth-outlook-callback`,
          grant_type: 'authorization_code',
        }),
      },
    );

    if (!tokenResponse.ok) {
      const err = await tokenResponse.text();
      console.error('Token exchange failed:', err);
      return redirectWithError(appUrl, 'Failed to exchange authorization code');
    }

    const tokens = await tokenResponse.json();
    const { access_token, refresh_token, expires_in } = tokens;

    // Fetch user profile from Microsoft Graph
    const profileResponse = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    if (!profileResponse.ok) {
      return redirectWithError(appUrl, 'Failed to fetch Microsoft profile');
    }

    const profile = await profileResponse.json();
    const email = profile.mail || profile.userPrincipalName;
    const displayName = profile.displayName || email;

    // Encrypt tokens
    const { data: encAccessToken } = await supabase.rpc('encrypt_token', {
      plain_text: access_token,
    });
    const { data: encRefreshToken } = await supabase.rpc('encrypt_token', {
      plain_text: refresh_token || '',
    });

    const expiresAt = new Date(Date.now() + (expires_in ?? 3600) * 1000).toISOString();

    // Get current max sort_order
    const { data: existing } = await supabase
      .from('email_accounts')
      .select('sort_order')
      .eq('user_id', userId)
      .order('sort_order', { ascending: false })
      .limit(1);

    const nextSortOrder = existing && existing.length > 0 ? existing[0].sort_order + 1 : 0;

    const COLORS = ['#0078d4', '#f25022', '#7fba00', '#ffb900', '#00a4ef', '#737373'];
    const color = COLORS[nextSortOrder % COLORS.length];

    // Upsert the email account
    const { data: upserted, error: upsertError } = await supabase
      .from('email_accounts')
      .upsert(
        {
          user_id: userId,
          provider: 'outlook',
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
      )
      .select('id')
      .single();

    if (upsertError) {
      console.error('Upsert failed:', upsertError);
      return redirectWithError(appUrl, 'Failed to save account');
    }

    // Set up push notifications (fire-and-forget)
    if (upserted?.id) {
      fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/push-subscribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        },
        body: JSON.stringify({ account_id: upserted.id }),
      }).catch(err => console.error('Push subscribe failed:', err));
    }

    return new Response(null, {
      status: 302,
      headers: {
        Location: `${appUrl}/settings/accounts?connected=outlook&email=${encodeURIComponent(email)}`,
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

