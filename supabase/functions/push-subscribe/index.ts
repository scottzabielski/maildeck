import { createAdminClient } from '../_shared/supabase-admin.ts';
import { corsHeaders } from '../_shared/cors.ts';

/**
 * Push notification subscription manager.
 *
 * Modes:
 * 1. Subscribe a single account: POST { account_id }
 *    - Gmail: calls users.watch() to register Pub/Sub push
 *    - Outlook: creates a Graph subscription for inbox changes
 *
 * 2. Renew all subscriptions: POST { mode: "renew", provider: "gmail" | "outlook" }
 *    - Gmail: re-calls users.watch() for all enabled Gmail accounts (idempotent)
 *    - Outlook: PATCHes expiration on existing subscriptions, re-creates if expired
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { account_id, mode, provider } = body as {
      account_id?: string;
      mode?: 'renew';
      provider?: 'gmail' | 'outlook';
    };

    const supabase = createAdminClient();

    if (mode === 'renew' && provider) {
      const results = await renewAll(supabase, provider);
      return jsonResponse({ status: 'renewed', results });
    }

    if (account_id) {
      const result = await subscribeAccount(supabase, account_id);
      return jsonResponse(result);
    }

    return jsonResponse({ error: 'Provide account_id or { mode: "renew", provider }' }, 400);
  } catch (err) {
    console.error('Push subscribe error:', err);
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});

// ============================================================
// Subscribe a single account
// ============================================================

async function subscribeAccount(
  supabase: ReturnType<typeof createAdminClient>,
  accountId: string,
) {
  const { data: account, error } = await supabase
    .from('email_accounts')
    .select('id, provider, email, access_token_encrypted, refresh_token_encrypted, token_expires_at')
    .eq('id', accountId)
    .single();

  if (error || !account) {
    throw new Error(`Account ${accountId} not found`);
  }

  const accessToken = await getFreshToken(supabase, account);

  if (account.provider === 'gmail') {
    return await subscribeGmail(supabase, account, accessToken);
  } else {
    return await subscribeOutlook(supabase, account, accessToken);
  }
}

// ============================================================
// Gmail push subscription
// ============================================================

async function subscribeGmail(
  supabase: ReturnType<typeof createAdminClient>,
  account: Record<string, unknown>,
  accessToken: string,
) {
  const topicName = Deno.env.get('GOOGLE_PUBSUB_TOPIC');
  if (!topicName) {
    throw new Error('GOOGLE_PUBSUB_TOPIC env var not set');
  }

  const res = await fetch('https://www.googleapis.com/gmail/v1/users/me/watch', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      topicName,
      labelIds: ['INBOX'],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gmail watch failed (${res.status}): ${err}`);
  }

  const data = await res.json();
  // data.expiration is a ms timestamp string
  const expiresAt = new Date(Number(data.expiration)).toISOString();

  await supabase
    .from('email_accounts')
    .update({ push_expires_at: expiresAt })
    .eq('id', account.id);

  console.log(`Gmail push registered for ${account.email}, expires ${expiresAt}`);
  return { account_id: account.id, provider: 'gmail', status: 'subscribed', expires_at: expiresAt };
}

// ============================================================
// Outlook push subscription
// ============================================================

async function subscribeOutlook(
  supabase: ReturnType<typeof createAdminClient>,
  account: Record<string, unknown>,
  accessToken: string,
) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const notificationUrl = `${supabaseUrl}/functions/v1/webhook-outlook`;

  // Outlook subscriptions max out at 3 days (4230 minutes) for mail resources
  const expirationDateTime = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

  const res = await fetch('https://graph.microsoft.com/v1.0/subscriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      changeType: 'created,updated',
      notificationUrl,
      resource: "me/mailFolders('Inbox')/messages",
      expirationDateTime,
      clientState: account.id as string,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Outlook subscription failed (${res.status}): ${err}`);
  }

  const data = await res.json();

  await supabase
    .from('email_accounts')
    .update({
      push_subscription_id: data.id,
      push_expires_at: data.expirationDateTime,
    })
    .eq('id', account.id);

  console.log(`Outlook push registered for ${account.email}, subscription ${data.id}`);
  return {
    account_id: account.id,
    provider: 'outlook',
    status: 'subscribed',
    subscription_id: data.id,
    expires_at: data.expirationDateTime,
  };
}

// ============================================================
// Renew all subscriptions for a provider
// ============================================================

async function renewAll(
  supabase: ReturnType<typeof createAdminClient>,
  provider: 'gmail' | 'outlook',
) {
  const results: Array<{ account_id: string; status: string }> = [];

  if (provider === 'gmail') {
    const { data: accounts, error } = await supabase
      .from('email_accounts')
      .select('id, provider, email, access_token_encrypted, refresh_token_encrypted, token_expires_at')
      .eq('provider', 'gmail')
      .eq('is_enabled', true);

    if (error) throw error;

    for (const account of accounts || []) {
      try {
        const accessToken = await getFreshToken(supabase, account);
        await subscribeGmail(supabase, account, accessToken);
        results.push({ account_id: account.id, status: 'renewed' });
      } catch (err) {
        console.error(`Gmail renew failed for ${account.id}:`, err);
        results.push({ account_id: account.id, status: `error: ${(err as Error).message}` });
      }
    }
  } else {
    const { data: accounts, error } = await supabase
      .from('email_accounts')
      .select('id, provider, email, push_subscription_id, access_token_encrypted, refresh_token_encrypted, token_expires_at')
      .eq('provider', 'outlook')
      .eq('is_enabled', true);

    if (error) throw error;

    for (const account of accounts || []) {
      try {
        const accessToken = await getFreshToken(supabase, account);

        if (account.push_subscription_id) {
          // Try to renew existing subscription
          const renewed = await renewOutlookSubscription(supabase, account, accessToken);
          if (renewed) {
            results.push({ account_id: account.id, status: 'renewed' });
            continue;
          }
        }

        // No existing subscription or renewal failed — create new one
        await subscribeOutlook(supabase, account, accessToken);
        results.push({ account_id: account.id, status: 'recreated' });
      } catch (err) {
        console.error(`Outlook renew failed for ${account.id}:`, err);
        results.push({ account_id: account.id, status: `error: ${(err as Error).message}` });
      }
    }
  }

  return results;
}

async function renewOutlookSubscription(
  supabase: ReturnType<typeof createAdminClient>,
  account: Record<string, unknown>,
  accessToken: string,
): Promise<boolean> {
  const subscriptionId = account.push_subscription_id as string;
  const expirationDateTime = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

  const res = await fetch(`https://graph.microsoft.com/v1.0/subscriptions/${subscriptionId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ expirationDateTime }),
  });

  if (!res.ok) {
    console.log(`Outlook PATCH subscription ${subscriptionId} failed (${res.status}), will recreate`);
    return false;
  }

  const data = await res.json();

  await supabase
    .from('email_accounts')
    .update({
      push_subscription_id: data.id,
      push_expires_at: data.expirationDateTime,
    })
    .eq('id', account.id);

  console.log(`Outlook push renewed for ${account.email}, expires ${data.expirationDateTime}`);
  return true;
}

// ============================================================
// Token helpers
// ============================================================

async function getFreshToken(
  supabase: ReturnType<typeof createAdminClient>,
  account: Record<string, unknown>,
): Promise<string> {
  // Check if token is expired or expiring within 2 minutes
  const tokenExpiresAt = account.token_expires_at as string | null;
  if (tokenExpiresAt && new Date(tokenExpiresAt) <= new Date(Date.now() + 2 * 60 * 1000)) {
    // Refresh the token via token-refresh function
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const refreshRes = await fetch(`${supabaseUrl}/functions/v1/token-refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({ account_id: account.id }),
    });

    if (!refreshRes.ok) {
      throw new Error(`Token refresh failed for account ${account.id}: ${await refreshRes.text()}`);
    }

    // Re-read the account to get the fresh encrypted token
    const { data: refreshed, error } = await supabase
      .from('email_accounts')
      .select('access_token_encrypted')
      .eq('id', account.id)
      .single();

    if (error || !refreshed) {
      throw new Error(`Failed to re-read account ${account.id} after token refresh`);
    }

    return await decryptToken(supabase, refreshed.access_token_encrypted);
  }

  return await decryptToken(supabase, account.access_token_encrypted);
}

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

// ============================================================
// Helpers
// ============================================================

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
