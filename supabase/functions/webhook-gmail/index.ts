import { createAdminClient } from '../_shared/supabase-admin.ts';

/**
 * Gmail push notification webhook.
 *
 * Receives notifications from Google Cloud Pub/Sub when emails change.
 * Triggers an incremental sync for the affected account.
 *
 * Pub/Sub delivers a JSON body with:
 *   { message: { data: base64-encoded JSON, messageId, publishTime }, subscription }
 *
 * The decoded data contains:
 *   { emailAddress, historyId }
 */
Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = await req.json();
    const message = body.message;

    if (!message?.data) {
      return new Response('No message data', { status: 400 });
    }

    // Decode the Pub/Sub message
    const decoded = JSON.parse(atob(message.data));
    const emailAddress = decoded.emailAddress;

    if (!emailAddress) {
      return new Response('No email address in notification', { status: 400 });
    }

    const supabase = createAdminClient();

    // Find the account by email address
    const { data: account, error } = await supabase
      .from('email_accounts')
      .select('id')
      .eq('provider', 'gmail')
      .eq('email', emailAddress)
      .eq('is_enabled', true)
      .single();

    if (error || !account) {
      console.log(`No active Gmail account found for ${emailAddress}`);
      // Return 200 to acknowledge the message (don't retry)
      return new Response('OK', { status: 200 });
    }

    // Trigger incremental sync via the sync-emails function
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    await fetch(`${supabaseUrl}/functions/v1/sync-emails`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({
        account_id: account.id,
        mode: 'incremental',
      }),
    });

    return new Response('OK', { status: 200 });
  } catch (err) {
    console.error('Gmail webhook error:', err);
    // Return 200 to prevent Pub/Sub retries on non-transient errors
    return new Response('OK', { status: 200 });
  }
});
