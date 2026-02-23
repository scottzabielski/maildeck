import { createAdminClient } from '../_shared/supabase-admin.ts';
import { corsHeaders } from '../_shared/cors.ts';

/**
 * Sweep execute Edge Function.
 *
 * Called by pg_cron every minute. Processes all pending sweep queue items
 * whose scheduled_at has passed, performing the configured action
 * (archive or delete) both locally and on the email provider.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabase = createAdminClient();

  try {
    // Fetch pending sweep items that are due
    const { data: pendingItems, error } = await supabase
      .from('sweep_queue')
      .select(`
        id,
        email_id,
        action,
        user_id,
        emails!inner (
          id,
          account_id,
          provider_message_id,
          is_archived,
          is_deleted
        )
      `)
      .eq('executed', false)
      .lte('scheduled_at', new Date().toISOString())
      .limit(100);

    if (error) throw error;
    if (!pendingItems || pendingItems.length === 0) {
      return jsonResponse({ processed: 0 });
    }

    const results: { id: string; status: string }[] = [];

    for (const item of pendingItems) {
      try {
        const email = item.emails as unknown as {
          id: string;
          account_id: string;
          provider_message_id: string;
          is_archived: boolean;
          is_deleted: boolean;
        };

        // Skip if email is already archived/deleted
        if (
          (item.action === 'archive' && email.is_archived) ||
          (item.action === 'delete' && email.is_deleted)
        ) {
          await supabase
            .from('sweep_queue')
            .update({ executed: true })
            .eq('id', item.id);
          results.push({ id: item.id, status: 'skipped' });
          continue;
        }

        // Get account for provider sync
        const { data: account } = await supabase
          .from('email_accounts')
          .select('id, provider, access_token_encrypted')
          .eq('id', email.account_id)
          .single();

        // Update local DB
        const dbUpdates = item.action === 'delete'
          ? { is_deleted: true }
          : { is_archived: true };

        await supabase
          .from('emails')
          .update(dbUpdates)
          .eq('id', email.id);

        // Sync to provider if we have account access
        if (account?.access_token_encrypted) {
          try {
            const { data: accessToken } = await supabase.rpc('decrypt_token', {
              encrypted_text: account.access_token_encrypted,
            });

            if (accessToken) {
              if (account.provider === 'gmail') {
                await syncGmail(accessToken, email.provider_message_id, item.action);
              } else {
                await syncOutlook(accessToken, email.provider_message_id, item.action);
              }
            }
          } catch (providerErr) {
            console.error(`Provider sync failed for sweep item ${item.id}:`, providerErr);
          }
        }

        // Mark as executed
        await supabase
          .from('sweep_queue')
          .update({ executed: true })
          .eq('id', item.id);

        results.push({ id: item.id, status: 'executed' });
      } catch (itemErr) {
        console.error(`Failed to execute sweep item ${item.id}:`, itemErr);
        results.push({ id: item.id, status: 'error' });
      }
    }

    return jsonResponse({ processed: results.length, results });
  } catch (err) {
    console.error('Sweep execute error:', err);
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});

async function syncGmail(
  accessToken: string,
  messageId: string,
  action: string,
): Promise<void> {
  const body = action === 'delete'
    ? { addLabelIds: ['TRASH'] }
    : { removeLabelIds: ['INBOX'] };

  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  );

  if (!res.ok) {
    throw new Error(`Gmail sweep sync failed: ${await res.text()}`);
  }
}

async function syncOutlook(
  accessToken: string,
  messageId: string,
  action: string,
): Promise<void> {
  const graphUrl = `https://graph.microsoft.com/v1.0/me/messages/${messageId}`;

  if (action === 'delete') {
    const res = await fetch(graphUrl, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`Outlook sweep delete failed: ${await res.text()}`);
  } else {
    const res = await fetch(`${graphUrl}/move`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ destinationId: 'archive' }),
    });
    if (!res.ok) throw new Error(`Outlook sweep archive failed: ${await res.text()}`);
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
