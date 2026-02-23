import { createAdminClient } from '../_shared/supabase-admin.ts';
import { corsHeaders } from '../_shared/cors.ts';

/**
 * Token refresh Edge Function.
 *
 * Called by pg_cron every 30 minutes. Finds email accounts whose tokens
 * expire within 15 minutes and refreshes them.
 *
 * Can also be called manually for a specific account via POST { account_id }.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabase = createAdminClient();

  try {
    let accounts: { id: string; provider: string; refresh_token_encrypted: string; user_id: string }[];

    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));

      if (body.account_id) {
        // Refresh a specific account
        const { data, error } = await supabase
          .from('email_accounts')
          .select('id, provider, refresh_token_encrypted, user_id')
          .eq('id', body.account_id)
          .single();

        if (error || !data) {
          return new Response(JSON.stringify({ error: 'Account not found' }), {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        accounts = [data];
      } else {
        // Refresh all accounts expiring within 15 minutes
        const threshold = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        const { data, error } = await supabase
          .from('email_accounts')
          .select('id, provider, refresh_token_encrypted, user_id')
          .eq('is_enabled', true)
          .lt('token_expires_at', threshold)
          .not('refresh_token_encrypted', 'is', null);

        if (error) throw error;
        accounts = data || [];
      }
    } else {
      // GET: refresh all expiring
      const threshold = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from('email_accounts')
        .select('id, provider, refresh_token_encrypted, user_id')
        .eq('is_enabled', true)
        .lt('token_expires_at', threshold)
        .not('refresh_token_encrypted', 'is', null);

      if (error) throw error;
      accounts = data || [];
    }

    const results: { id: string; status: string }[] = [];

    for (const account of accounts) {
      try {
        // Decrypt refresh token
        const { data: refreshToken } = await supabase.rpc('decrypt_token', {
          encrypted_text: account.refresh_token_encrypted,
        });

        if (!refreshToken) {
          results.push({ id: account.id, status: 'error: no refresh token' });
          continue;
        }

        let newTokens: { access_token: string; refresh_token?: string; expires_in: number };

        if (account.provider === 'gmail') {
          newTokens = await refreshGmailToken(refreshToken);
        } else {
          newTokens = await refreshOutlookToken(refreshToken);
        }

        // Encrypt new tokens
        const { data: encAccessToken } = await supabase.rpc('encrypt_token', {
          plain_text: newTokens.access_token,
        });

        const updates: Record<string, unknown> = {
          access_token_encrypted: encAccessToken,
          token_expires_at: new Date(Date.now() + newTokens.expires_in * 1000).toISOString(),
        };

        // If a new refresh token was issued, encrypt and store it
        if (newTokens.refresh_token) {
          const { data: encRefreshToken } = await supabase.rpc('encrypt_token', {
            plain_text: newTokens.refresh_token,
          });
          updates.refresh_token_encrypted = encRefreshToken;
        }

        await supabase
          .from('email_accounts')
          .update(updates)
          .eq('id', account.id);

        results.push({ id: account.id, status: 'refreshed' });
      } catch (err) {
        console.error(`Failed to refresh account ${account.id}:`, err);

        // Mark as error so frontend can show reconnect prompt
        await supabase
          .from('email_accounts')
          .update({ sync_status: 'error' })
          .eq('id', account.id);

        results.push({ id: account.id, status: `error: ${(err as Error).message}` });
      }
    }

    return new Response(
      JSON.stringify({ refreshed: results.length, results }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  } catch (err) {
    console.error('Token refresh error:', err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  }
});

async function refreshGmailToken(refreshToken: string) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: Deno.env.get('GOOGLE_CLIENT_ID')!,
      client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gmail token refresh failed: ${err}`);
  }

  return await res.json();
}

async function refreshOutlookToken(refreshToken: string) {
  const res = await fetch(
    'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: Deno.env.get('MICROSOFT_CLIENT_ID')!,
        client_secret: Deno.env.get('MICROSOFT_CLIENT_SECRET')!,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    },
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Outlook token refresh failed: ${err}`);
  }

  return await res.json();
}
