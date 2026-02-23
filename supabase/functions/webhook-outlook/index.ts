import { createAdminClient } from '../_shared/supabase-admin.ts';

/**
 * Outlook push notification webhook.
 *
 * Receives notifications from Microsoft Graph subscriptions when emails change.
 * Handles both validation requests and change notifications.
 *
 * Validation: GET/POST with ?validationToken=... → echo the token back
 * Notification: POST with { value: [{ subscriptionId, clientState, resource, ... }] }
 */
Deno.serve(async (req) => {
  const url = new URL(req.url);

  // Handle subscription validation
  const validationToken = url.searchParams.get('validationToken');
  if (validationToken) {
    return new Response(validationToken, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = await req.json();
    const notifications = body.value;

    if (!Array.isArray(notifications) || notifications.length === 0) {
      return new Response('OK', { status: 202 });
    }

    const supabase = createAdminClient();
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Process each notification
    const accountIds = new Set<string>();

    for (const notification of notifications) {
      const subscriptionId = notification.subscriptionId;

      if (!subscriptionId) continue;

      // Find the account by push_subscription_id
      const { data: account } = await supabase
        .from('email_accounts')
        .select('id')
        .eq('provider', 'outlook')
        .eq('push_subscription_id', subscriptionId)
        .eq('is_enabled', true)
        .single();

      if (account) {
        accountIds.add(account.id);
      }
    }

    // Trigger incremental sync for each affected account
    for (const accountId of accountIds) {
      await fetch(`${supabaseUrl}/functions/v1/sync-emails`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({
          account_id: accountId,
          mode: 'incremental',
        }),
      });
    }

    // Must return 202 to acknowledge to Microsoft Graph
    return new Response('OK', { status: 202 });
  } catch (err) {
    console.error('Outlook webhook error:', err);
    return new Response('OK', { status: 202 });
  }
});
