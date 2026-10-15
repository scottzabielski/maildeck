import { createAdminClient } from '../_shared/supabase-admin.ts';
import { corsHeaders } from '../_shared/cors.ts';

/**
 * Sweep execute Edge Function.
 *
 * Called by pg_cron every minute. Processes pending sweep queue items
 * whose scheduled_at has passed, performing the configured action
 * (archive or delete) on the email provider and then locally.
 *
 * A sweep only counts as done once the provider confirms it. A rate limit,
 * an expired token or a provider outage pushes the item back 10 minutes
 * instead of marking an email archived that is still in the real inbox.
 * Outlook messages are checked first and left alone unless they are still
 * in the inbox, so a sweep never pulls a message out of a folder it was
 * filed in (or out of Deleted Items).
 *
 * Sweeps queued by a Claude-checked rule wait for sweep-check's verdict:
 * only rows without a check, or whose check said match, are run here.
 */

const RETRY_DELAY_MS = 10 * 60_000;

type Outcome = 'done' | 'retry' | 'gone' | 'not_in_inbox' | 'failed';

interface AccountContext {
  provider: string;
  accessToken: string;
  inboxId?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabase = createAdminClient();

  try {
    // Fetch pending sweep items that are due, oldest first
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
      // A Claude-checked rule's sweep runs only once Claude said match.
      .or('ai_status.is.null,ai_status.eq.match')
      .lte('scheduled_at', new Date().toISOString())
      .order('scheduled_at', { ascending: true })
      .limit(100);

    if (error) throw error;
    if (!pendingItems || pendingItems.length === 0) {
      return jsonResponse({ processed: 0 });
    }

    const results: { id: string; status: string }[] = [];
    const accounts = new Map<string, AccountContext | null>();
    const markExecuted = (id: string) =>
      supabase.from('sweep_queue').update({ executed: true }).eq('id', id);

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
          await markExecuted(item.id);
          results.push({ id: item.id, status: 'skipped' });
          continue;
        }

        const account = await accountContext(supabase, accounts, email.account_id);
        const outcome: Outcome = !account
          ? 'done' // No provider access: local-only, as before
          : account.provider === 'gmail'
            ? await sweepGmail(account, email.provider_message_id, item.action)
            : await sweepOutlook(account, email.provider_message_id, item.action);

        if (outcome === 'retry') {
          await supabase
            .from('sweep_queue')
            .update({ scheduled_at: new Date(Date.now() + RETRY_DELAY_MS).toISOString() })
            .eq('id', item.id);
          results.push({ id: item.id, status: 'retry' });
          continue;
        }

        if (outcome === 'done') {
          await supabase
            .from('emails')
            .update(item.action === 'delete' ? { is_deleted: true } : { is_archived: true })
            .eq('id', email.id);
        } else if (outcome === 'gone' || outcome === 'not_in_inbox') {
          // Already out of the inbox: record that, change nothing on the provider.
          await supabase.from('emails').update({ is_archived: true }).eq('id', email.id);
        }
        // 'failed' (a permanent provider error): the email is still where it was,
        // so leave its local state alone and stop retrying.

        await markExecuted(item.id);
        results.push({ id: item.id, status: outcome === 'done' ? 'executed' : outcome });
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

/** Provider access for an account, cached for this run. null = no token, act locally only. */
async function accountContext(
  supabase: ReturnType<typeof createAdminClient>,
  cache: Map<string, AccountContext | null>,
  accountId: string,
): Promise<AccountContext | null> {
  if (cache.has(accountId)) return cache.get(accountId)!;
  const { data: account } = await supabase
    .from('email_accounts')
    .select('id, provider, access_token_encrypted')
    .eq('id', accountId)
    .single();

  let ctx: AccountContext | null = null;
  if (account?.access_token_encrypted) {
    const { data: accessToken } = await supabase.rpc('decrypt_token', {
      encrypted_text: account.access_token_encrypted,
    });
    if (accessToken) ctx = { provider: account.provider, accessToken };
  }
  cache.set(accountId, ctx);
  return ctx;
}

/** How a provider response maps to an outcome. Not found means the message is already gone. */
function classify(status: number): Outcome {
  if (status === 404) return 'gone';
  if (status === 401 || status === 408 || status === 429 || status >= 500) return 'retry';
  return 'failed';
}

async function sweepGmail(account: AccountContext, messageId: string, action: string): Promise<Outcome> {
  const body = action === 'delete'
    ? { addLabelIds: ['TRASH'] }
    : { removeLabelIds: ['INBOX'] };

  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${account.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  ).catch(() => null);

  if (!res) return 'retry';
  if (res.ok) return 'done';
  const text = await res.text();
  // Gmail reports some rate limits as 403 (userRateLimitExceeded, quota).
  const outcome = res.status === 403 && /rateLimit|quota|dailyLimit/i.test(text) ? 'retry' : classify(res.status);
  if (outcome !== 'gone') console.error(`Gmail sweep ${action} failed (${res.status}): ${text.slice(0, 300)}`);
  return outcome;
}

async function sweepOutlook(account: AccountContext, messageId: string, action: string): Promise<Outcome> {
  const auth = { Authorization: `Bearer ${account.accessToken}` };
  const graphUrl = `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(messageId)}`;

  // Act only on messages still in the inbox.
  if (!account.inboxId) {
    const res = await fetch('https://graph.microsoft.com/v1.0/me/mailFolders/Inbox?$select=id', { headers: auth })
      .catch(() => null);
    if (!res?.ok) return 'retry';
    account.inboxId = (await res.json()).id as string;
  }
  const lookup = await fetch(`${graphUrl}?$select=parentFolderId`, { headers: auth }).catch(() => null);
  if (!lookup) return 'retry';
  if (!lookup.ok) return classify(lookup.status);
  if ((await lookup.json()).parentFolderId !== account.inboxId) return 'not_in_inbox';

  const res = action === 'delete'
    ? await fetch(graphUrl, { method: 'DELETE', headers: auth }).catch(() => null)
    : await fetch(`${graphUrl}/move`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ destinationId: 'archive' }),
    }).catch(() => null);

  if (!res) return 'retry';
  if (res.ok) return 'done';
  const outcome = classify(res.status);
  if (outcome !== 'gone') console.error(`Outlook sweep ${action} failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  return outcome;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
