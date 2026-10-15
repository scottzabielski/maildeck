import { createAdminClient } from '../_shared/supabase-admin.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { type Header, isBulkMail } from '../_shared/emailContent.ts';

/**
 * Email sync Edge Function.
 *
 * Modes:
 * - full: Initial sync — fetch all inbox emails
 * - incremental: Fetch only new/changed emails since last sync
 *
 * Outlook inboxes are also reconciled against the real inbox (see
 * outlookReconcile) after every complete full sync and once an hour.
 *
 * Called by:
 * - Frontend (after connecting a new account)
 * - pg_cron polling (every 5 minutes)
 * - Push webhook handlers (Gmail/Outlook)
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { account_id, mode = 'incremental' } = body as {
      account_id?: string;
      mode?: 'full' | 'incremental' | 'renew_push';
      provider?: 'gmail' | 'outlook';
    };

    // Delegate push subscription renewal to push-subscribe function
    if (mode === 'renew_push') {
      await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/push-subscribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        },
        body: JSON.stringify({ mode: 'renew', provider: body.provider }),
      });
      return jsonResponse({ status: 'delegated_to_push_subscribe' });
    }

    const supabase = createAdminClient();

    if (account_id) {
      // Sync a specific account
      const result = await syncAccount(supabase, account_id, mode);
      return jsonResponse(result);
    }

    // Sync all enabled accounts (for pg_cron polling)
    // Include never_synced, syncing, error, and idle accounts
    const { data: accounts, error } = await supabase
      .from('email_accounts')
      .select('id, sync_status')
      .eq('is_enabled', true);

    if (error) throw error;

    const results = [];
    for (const acct of accounts || []) {
      try {
        // Full mode only for accounts that never synced: syncAccount falls back to
        // a full sync by itself when there's no history id / delta link, and
        // forcing one after an error (often a 429) only made the next run heavier.
        const acctMode = acct.sync_status === 'never_synced' ? 'full' : 'incremental';
        const result = await syncAccount(supabase, acct.id, acctMode);
        results.push(result);
      } catch (err) {
        results.push({ account_id: acct.id, status: 'error', error: (err as Error).message });
      }
    }

    return jsonResponse({ synced: results.length, results });
  } catch (err) {
    console.error('Sync error:', err);
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});

// ============================================================
// Core sync logic
// ============================================================

interface SyncResult {
  account_id: string;
  status: string;
  messages_synced?: number;
}

async function syncAccount(
  supabase: ReturnType<typeof createAdminClient>,
  accountId: string,
  mode: 'full' | 'incremental',
): Promise<SyncResult> {
  // Fetch account details
  const { data: account, error } = await supabase
    .from('email_accounts')
    .select('id, user_id, provider, email, access_token_encrypted, refresh_token_encrypted, token_expires_at, sync_history_id, sync_delta_link')
    .eq('id', accountId)
    .single();

  if (error || !account) {
    throw new Error(`Account ${accountId} not found`);
  }

  // Claim the account: one sync per mailbox at a time. Push notifications
  // arrive in bursts (a bulk sweep produces hundreds), and overlapping syncs
  // of one mailbox trip Gmail's per-user concurrency limit (429) and fail each
  // other. Gmail history and Outlook deltas are cumulative, so a skipped sync
  // loses nothing. A claim older than 2 minutes is from a run that died.
  const staleBefore = new Date(Date.now() - 2 * 60_000).toISOString();
  const { data: claimed, error: claimErr } = await supabase
    .from('email_accounts')
    .update({ sync_status: 'syncing' })
    .eq('id', accountId)
    .or(`sync_status.neq.syncing,updated_at.lt."${staleBefore}"`)
    .select('id');
  if (claimErr) throw claimErr;
  if (!claimed?.length) {
    return { account_id: accountId, status: 'busy' };
  }

  try {
    // Decrypt access token
    let accessToken = await decryptToken(supabase, account.access_token_encrypted);

    // Check if token is expired and refresh if needed
    if (account.token_expires_at && new Date(account.token_expires_at) <= new Date()) {
      accessToken = await refreshAndUpdate(supabase, account);
    }

    let messageCount: number;

    if (account.provider === 'gmail') {
      if (mode === 'full' || !account.sync_history_id) {
        messageCount = await gmailFullSync(supabase, account, accessToken);
      } else {
        try {
          messageCount = await gmailIncrementalSync(supabase, account, accessToken);
        } catch (err) {
          // History ID expired or invalid — fall back to full sync
          if ((err as Error).message?.includes('404')) {
            console.log(`Gmail history expired for ${accountId}, falling back to full sync`);
            messageCount = await gmailFullSync(supabase, account, accessToken);
          } else {
            throw err;
          }
        }
      }
    } else {
      if (mode === 'full' || !account.sync_delta_link) {
        messageCount = await outlookFullSync(supabase, account, accessToken);
      } else {
        try {
          messageCount = await outlookIncrementalSync(supabase, account, accessToken);
          // Once an hour (the polling run at the top of the hour) as a safety
          // net. A failed reconcile shouldn't fail the sync itself.
          if (new Date().getUTCMinutes() < 5) {
            await outlookReconcile(supabase, account, accessToken)
              .catch((err) => console.error(`Outlook reconcile failed for ${accountId}:`, (err as Error).message));
          }
        } catch (err) {
          // Delta link expired or invalid — fall back to full sync
          if ((err as Error).message?.includes('410') || (err as Error).message?.includes('404')) {
            console.log(`Outlook delta expired for ${accountId}, falling back to full sync`);
            await supabase.from('email_accounts').update({ sync_delta_link: null }).eq('id', accountId);
            messageCount = await outlookFullSync(supabase, account, accessToken);
          } else {
            throw err;
          }
        }
      }
    }

    // If no sync_history_id yet, the full sync isn't complete — keep status as 'syncing'
    // so the frontend auto-retries. Otherwise mark as 'idle'.
    const { data: acctAfter } = await supabase
      .from('email_accounts')
      .select('sync_history_id, sync_delta_link')
      .eq('id', accountId)
      .single();

    const syncComplete = account.provider === 'gmail'
      ? !!acctAfter?.sync_history_id
      : !!acctAfter?.sync_delta_link;

    await supabase
      .from('email_accounts')
      .update({
        sync_status: syncComplete ? 'idle' : 'syncing',
        last_synced_at: new Date().toISOString(),
      })
      .eq('id', accountId);

    return { account_id: accountId, status: syncComplete ? 'ok' : 'partial', messages_synced: messageCount };
  } catch (err) {
    await supabase
      .from('email_accounts')
      .update({ sync_status: 'error' })
      .eq('id', accountId);
    throw err;
  }
}

// ============================================================
// Gmail sync
// ============================================================

async function gmailFullSync(
  supabase: ReturnType<typeof createAdminClient>,
  account: Record<string, unknown>,
  accessToken: string,
): Promise<number> {
  const userId = account.user_id as string;
  const accountId = account.id as string;

  const startTime = Date.now();
  const TIME_BUDGET_MS = 50_000; // Stop fetching metadata at 50s to leave room for cleanup

  // Fetch all inbox message IDs
  let messageIds: string[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      maxResults: '500',
      q: 'in:inbox',
    });
    if (pageToken) params.set('pageToken', pageToken);

    const res = await gmailFetch(accessToken, `/messages?${params}`);
    const data = await res.json();

    if (data.messages) {
      messageIds.push(...data.messages.map((m: { id: string }) => m.id));
    }
    pageToken = data.nextPageToken;
  } while (pageToken);

  // Query DB for already-synced message IDs (paginate to avoid max_rows limit)
  const existingIds = new Set<string>();
  const pageSize = 1000;
  let offset = 0;
  while (true) {
    const { data: rows, error: qErr } = await supabase
      .from('emails')
      .select('provider_message_id')
      .eq('account_id', accountId)
      .range(offset, offset + pageSize - 1);
    if (qErr) {
      console.error('Error querying existing IDs:', qErr);
      break;
    }
    if (!rows || rows.length === 0) break;
    for (const r of rows) existingIds.add(r.provider_message_id);
    if (rows.length < pageSize) break;
    offset += pageSize;
  }

  const remainingIds = messageIds.filter((id) => !existingIds.has(id));
  console.log(`Full sync: ${messageIds.length} total IDs, ${existingIds.size} already synced, ${remainingIds.length} remaining`);

  // If nothing left to fetch, store historyId — full sync is truly complete
  if (remainingIds.length === 0) {
    if (messageIds.length > 0) {
      const res = await gmailFetch(accessToken, `/messages/${messageIds[0]}?format=MINIMAL`);
      const latest = await res.json();
      if (latest.historyId) {
        await supabase
          .from('email_accounts')
          .update({ sync_history_id: latest.historyId })
          .eq('id', accountId);
      }
    }
    return 0;
  }

  // Fetch message metadata in parallel batches with time budget. Gmail allows
  // only a few concurrent requests per mailbox, so keep batches small.
  let synced = 0;
  const batchSize = GMAIL_CONCURRENCY;

  for (let i = 0; i < remainingIds.length; i += batchSize) {
    if (Date.now() - startTime > TIME_BUDGET_MS) {
      console.log(`Time budget reached after syncing ${synced} messages, ${remainingIds.length - i} still remaining`);
      break;
    }

    const batch = remainingIds.slice(i, i + batchSize);
    const messages = await Promise.all(
      batch.map(async (id) => {
        const res = await gmailFetch(accessToken, `/messages/${id}?${GMAIL_METADATA}`);
        return res.json();
      }),
    );

    const rows = messages.map((msg) => gmailMessageToRow(msg, userId, accountId));
    const { error } = await supabase
      .from('emails')
      .upsert(rows, { onConflict: 'account_id,provider_message_id' });

    if (error) console.error('Upsert batch error:', error);
    synced += rows.length;
  }

  return synced;
}

async function gmailIncrementalSync(
  supabase: ReturnType<typeof createAdminClient>,
  account: Record<string, unknown>,
  accessToken: string,
): Promise<number> {
  const userId = account.user_id as string;
  const accountId = account.id as string;
  const historyId = account.sync_history_id as string;

  let newHistoryId = historyId;
  const addedIds: string[] = [];
  const deletedIds: string[] = [];
  const changedIds: string[] = []; // messages whose labels changed (moved to junk, archived, etc.)
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({ startHistoryId: historyId });
    params.append('historyTypes', 'messageAdded');
    params.append('historyTypes', 'messageDeleted');
    params.append('historyTypes', 'labelAdded');
    params.append('historyTypes', 'labelRemoved');
    if (pageToken) params.set('pageToken', pageToken);

    const res = await gmailFetch(accessToken, `/history?${params}`);
    const data = await res.json();

    if (data.historyId) newHistoryId = data.historyId;

    if (data.history) {
      for (const h of data.history) {
        if (h.messagesAdded) {
          addedIds.push(...h.messagesAdded.map((m: { message: { id: string } }) => m.message.id));
        }
        if (h.messagesDeleted) {
          deletedIds.push(...h.messagesDeleted.map((m: { message: { id: string } }) => m.message.id));
        }
        // Label changes: email moved to/from Inbox, Spam, Trash, etc.
        if (h.labelsAdded) {
          changedIds.push(...h.labelsAdded.map((m: { message: { id: string } }) => m.message.id));
        }
        if (h.labelsRemoved) {
          changedIds.push(...h.labelsRemoved.map((m: { message: { id: string } }) => m.message.id));
        }
      }
    }

    pageToken = data.nextPageToken;
  } while (pageToken);

  // Merge added + label-changed IDs (re-fetch to get current labels)
  let synced = 0;
  const deletedSet = new Set(deletedIds);
  const uniqueAdded = [...new Set([...addedIds, ...changedIds])].filter(id => !deletedSet.has(id));

  for (let i = 0; i < uniqueAdded.length; i += GMAIL_CONCURRENCY) {
    const batch = uniqueAdded.slice(i, i + GMAIL_CONCURRENCY);
    const messages = await Promise.all(
      batch.map(async (id) => {
        const res = await gmailFetch(accessToken, `/messages/${id}?${GMAIL_METADATA}`);
        return res.json();
      }),
    );

    const rows = messages
      .filter((msg) => msg.id) // filter out any errors
      .map((msg) => gmailMessageToRow(msg, userId, accountId));

    if (rows.length > 0) {
      await supabase
        .from('emails')
        .upsert(rows, { onConflict: 'account_id,provider_message_id' });
      synced += rows.length;
    }
  }

  // Mark deleted messages
  await updateByProviderIds(supabase, accountId, deletedIds, { is_deleted: true });

  // Update historyId
  await supabase
    .from('email_accounts')
    .update({ sync_history_id: newHistoryId })
    .eq('id', accountId);

  return synced;
}

function gmailMessageToRow(
  msg: Record<string, unknown>,
  userId: string,
  accountId: string,
) {
  const headers = ((msg.payload as Record<string, unknown>)?.headers as Array<{ name: string; value: string }>) || [];
  const getHeader = (name: string) => headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

  const fromRaw = getHeader('From');
  const fromMatch = fromRaw.match(/^"?(.+?)"?\s*<(.+?)>$/);
  const senderName = fromMatch ? fromMatch[1] : fromRaw;
  const senderEmail = fromMatch ? fromMatch[2] : fromRaw;

  const labelIds = (msg.labelIds as string[]) || [];

  return {
    user_id: userId,
    account_id: accountId,
    provider_message_id: msg.id as string,
    thread_id: msg.threadId as string,
    sender_name: senderName,
    sender_email: senderEmail,
    subject: getHeader('Subject'),
    snippet: (msg.snippet as string) || '',
    received_at: new Date(Number(msg.internalDate)).toISOString(),
    is_unread: labelIds.includes('UNREAD'),
    is_starred: labelIds.includes('STARRED'),
    is_archived: !labelIds.includes('INBOX'),
    is_deleted: labelIds.includes('TRASH'),
    labels: JSON.stringify(labelIds),
    recipients: JSON.stringify([{ email: getHeader('To') }]),
    is_bulk: isBulkMail(headers),
  };
}

const GMAIL_CONCURRENCY = 5;

// From, To and Subject fill the row; the list headers mark bulk mail.
const GMAIL_METADATA = ['From', 'To', 'Subject', 'List-Unsubscribe', 'List-Id', 'Precedence']
  .reduce((q, h) => `${q}&metadataHeaders=${h}`, 'format=METADATA');

async function gmailFetch(accessToken: string, path: string): Promise<Response> {
  // Gmail rate-limits per mailbox; back off briefly (1s, then 3s) on 429/5xx.
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.ok) return res;
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      await res.body?.cancel();
      await new Promise((resolve) => setTimeout(resolve, 1000 * 3 ** attempt));
      continue;
    }
    const err = await res.text();
    throw new Error(`Gmail API error (${res.status}): ${err}`);
  }
}

// ============================================================
// Outlook sync
// ============================================================

async function resolveOutlookInboxFolderId(accessToken: string): Promise<string> {
  const res = await outlookFetch(accessToken, 'https://graph.microsoft.com/v1.0/me/mailFolders/Inbox?$select=id');
  const data = await res.json();
  return data.id as string;
}

async function outlookFullSync(
  supabase: ReturnType<typeof createAdminClient>,
  account: Record<string, unknown>,
  accessToken: string,
): Promise<number> {
  const userId = account.user_id as string;
  const accountId = account.id as string;
  const startTime = Date.now();
  const TIME_BUDGET_MS = 50_000;
  const inboxFolderId = await resolveOutlookInboxFolderId(accessToken);

  let synced = 0;
  let url: string | null = `https://graph.microsoft.com/v1.0/me/mailFolders/Inbox/messages?$top=100&$orderby=receivedDateTime desc&$select=${OUTLOOK_FIELDS},internetMessageHeaders`;
  let timedOut = false;
  const inboxIds = new Set<string>();

  while (url) {
    if (Date.now() - startTime > TIME_BUDGET_MS) {
      console.log(`Outlook full sync: time budget reached after syncing ${synced} messages`);
      timedOut = true;
      break;
    }

    const res = await outlookFetch(accessToken, url);
    const data = await res.json();

    if (data.value) {
      for (const msg of data.value) inboxIds.add(msg.id as string);
      const rows = data.value.map((msg: Record<string, unknown>) =>
        outlookMessageToRow(msg, userId, accountId, inboxFolderId),
      );
      const error = await upsertEmailRows(supabase, rows);

      if (error) console.error('Upsert batch error:', error);
      synced += rows.length;
    }

    url = data['@odata.nextLink'] || null;
  }

  // Only get deltaLink when all messages have been fetched (no timeout)
  if (!timedOut) {
    // The delta link keeps this $select for good, so it stays as it was; new
    // messages from incremental syncs get their headers from outlookBulkFlags.
    const deltaUrl = `https://graph.microsoft.com/v1.0/me/mailFolders/Inbox/messages/delta?$select=${OUTLOOK_FIELDS}`;
    let deltaLink: string | null = null;
    let deltaNextUrl: string | null = deltaUrl;

    while (deltaNextUrl) {
      if (Date.now() - startTime > TIME_BUDGET_MS) {
        console.log('Outlook full sync: time budget reached during delta link fetch');
        break;
      }
      const res = await outlookFetch(accessToken, deltaNextUrl);
      const data = await res.json();
      deltaNextUrl = data['@odata.nextLink'] || null;
      if (data['@odata.deltaLink']) {
        deltaLink = data['@odata.deltaLink'];
      }
    }

    if (deltaLink) {
      await supabase
        .from('email_accounts')
        .update({ sync_delta_link: deltaLink })
        .eq('id', accountId);
    }

    // The listing above covered the whole inbox, so anything still marked as
    // in the inbox here but not in that listing has left it.
    await outlookReconcile(supabase, account, accessToken, inboxIds)
      .catch((err) => console.error(`Outlook reconcile failed for ${accountId}:`, (err as Error).message));
  }

  return synced;
}

async function outlookIncrementalSync(
  supabase: ReturnType<typeof createAdminClient>,
  account: Record<string, unknown>,
  accessToken: string,
): Promise<number> {
  const userId = account.user_id as string;
  const accountId = account.id as string;
  const deltaLink = account.sync_delta_link as string;
  const inboxFolderId = await resolveOutlookInboxFolderId(accessToken);

  let synced = 0;
  let url: string | null = deltaLink;
  let newDeltaLink: string | null = null;

  while (url) {
    const res = await outlookFetch(accessToken, url);
    const data = await res.json();

    if (data.value) {
      const added = data.value.filter((msg: Record<string, unknown>) => !msg['@removed']);
      const removed = data.value.filter((msg: Record<string, unknown>) => msg['@removed']);

      if (added.length > 0) {
        const bulk = await outlookBulkFlags(supabase, accountId, accessToken,
          added.map((msg: Record<string, unknown>) => msg.id as string));
        const rows = added.map((msg: Record<string, unknown>) =>
          outlookMessageToRow(msg, userId, accountId, inboxFolderId, bulk.get(msg.id as string)),
        );
        await upsertEmailRows(supabase, rows);
        synced += rows.length;
      }

      if (removed.length > 0) {
        const ids = removed.map((msg: Record<string, unknown>) => msg.id as string);
        // Inbox-scoped delta: @removed means "no longer in Inbox" (moved, deleted, etc.)
        // Mark as archived so the client-side query (is_archived=false) filters them out.
        // A failure here throws: the delta link isn't advanced, so the next sync retries.
        await updateByProviderIds(supabase, accountId, ids, { is_archived: true });
      }
    }

    url = data['@odata.nextLink'] || null;
    if (data['@odata.deltaLink']) {
      newDeltaLink = data['@odata.deltaLink'];
    }
  }

  if (newDeltaLink) {
    await supabase
      .from('email_accounts')
      .update({ sync_delta_link: newDeltaLink })
      .eq('id', accountId);
  }

  return synced;
}

/**
 * The bulk flag comes from the message's headers when it was fetched with
 * them, or from `bulk` (outlookBulkFlags); otherwise the row leaves it alone.
 */
function outlookMessageToRow(
  msg: Record<string, unknown>,
  userId: string,
  accountId: string,
  inboxFolderId: string,
  bulk?: boolean,
) {
  const headers = msg.internetMessageHeaders as Header[] | undefined;
  const isBulk = bulk ?? (Array.isArray(headers) ? isBulkMail(headers) : undefined);
  const from = msg.from as { emailAddress: { name: string; address: string } } | undefined;
  const toRecipients = msg.toRecipients as Array<{ emailAddress: { name: string; address: string } }> | undefined;
  const flag = msg.flag as { flagStatus: string } | undefined;

  const parentFolderId = (msg.parentFolderId as string) || '';
  const isInInbox = parentFolderId === inboxFolderId;
  const isInDeletedItems = parentFolderId.toLowerCase().includes('deleteditems');

  return {
    user_id: userId,
    account_id: accountId,
    provider_message_id: msg.id as string,
    thread_id: (msg.conversationId as string) || null,
    sender_name: from?.emailAddress?.name || '',
    sender_email: from?.emailAddress?.address || '',
    subject: (msg.subject as string) || '',
    snippet: (msg.bodyPreview as string) || '',
    received_at: msg.receivedDateTime as string,
    is_unread: !(msg.isRead as boolean),
    is_starred: flag?.flagStatus === 'flagged',
    is_archived: !isInInbox && !isInDeletedItems,
    is_deleted: isInDeletedItems,
    labels: JSON.stringify(msg.categories || []),
    recipients: JSON.stringify(
      (toRecipients || []).map((r) => ({
        name: r.emailAddress.name,
        email: r.emailAddress.address,
      })),
    ),
    ...(isBulk !== undefined ? { is_bulk: isBulk } : {}),
  };
}

const OUTLOOK_FIELDS = 'id,conversationId,from,toRecipients,subject,bodyPreview,receivedDateTime,isRead,flag,categories,parentFolderId';

/**
 * Upserts email rows. Rows without a known bulk flag go in their own batch:
 * in a shared one PostgREST would write null over a flag already stored.
 */
async function upsertEmailRows(
  supabase: ReturnType<typeof createAdminClient>,
  rows: Record<string, unknown>[],
) {
  for (const batch of [rows.filter((r) => 'is_bulk' in r), rows.filter((r) => !('is_bulk' in r))]) {
    if (batch.length === 0) continue;
    const { error } = await supabase.from('emails').upsert(batch, { onConflict: 'account_id,provider_message_id' });
    if (error) return error;
  }
  return null;
}

/**
 * Bulk flags for messages a delta sync reports, read from their headers
 * (20 per Graph batch request). Only for messages not stored yet: the
 * insert trigger matches rules as the row is created, so a "bulk" condition
 * needs the flag then. Best effort: a message whose headers can't be read
 * gets no flag.
 */
async function outlookBulkFlags(
  supabase: ReturnType<typeof createAdminClient>,
  accountId: string,
  accessToken: string,
  ids: string[],
): Promise<Map<string, boolean>> {
  const flags = new Map<string, boolean>();
  try {
    const known = new Set<string>();
    for (let i = 0; i < ids.length; i += OUTLOOK_ID_CHUNK) {
      const { data, error } = await supabase
        .from('emails')
        .select('provider_message_id')
        .eq('account_id', accountId)
        .in('provider_message_id', ids.slice(i, i + OUTLOOK_ID_CHUNK));
      if (error) throw error;
      for (const r of data ?? []) known.add(r.provider_message_id as string);
    }
    const fresh = ids.filter((id) => !known.has(id));
    for (let i = 0; i < fresh.length; i += 20) {
      const chunk = fresh.slice(i, i + 20);
      const res = await fetch('https://graph.microsoft.com/v1.0/$batch', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: chunk.map((id, n) => ({
            id: String(n),
            method: 'GET',
            url: `/me/messages/${encodeURIComponent(id)}?$select=internetMessageHeaders`,
          })),
        }),
      });
      if (!res.ok) {
        console.warn(`Outlook bulk flags: batch failed (${res.status}) for ${accountId}`);
        continue;
      }
      const data = await res.json() as { responses?: { id: string; status: number; body?: { internetMessageHeaders?: Header[] } }[] };
      for (const r of data.responses ?? []) {
        const headers = r.body?.internetMessageHeaders;
        if (r.status === 200 && Array.isArray(headers)) flags.set(chunk[Number(r.id)], isBulkMail(headers));
      }
    }
  } catch (err) {
    console.warn(`Outlook bulk flags failed for ${accountId}:`, (err as Error).message);
  }
  return flags;
}

// Outlook ids are ~152 characters, so 50 per `in.(...)` filter keeps the URL
// near 8 KB, well under the edge's ~16 KB limit (past it, the request fails).
const OUTLOOK_ID_CHUNK = 50;
const ROW_ID_CHUNK = 200;

async function updateByProviderIds(
  supabase: ReturnType<typeof createAdminClient>,
  accountId: string,
  providerIds: string[],
  updates: Record<string, unknown>,
): Promise<void> {
  for (let i = 0; i < providerIds.length; i += OUTLOOK_ID_CHUNK) {
    const { error } = await supabase
      .from('emails')
      .update(updates)
      .eq('account_id', accountId)
      .in('provider_message_id', providerIds.slice(i, i + OUTLOOK_ID_CHUNK));
    if (error) throw error;
  }
}

async function updateByRowIds(
  supabase: ReturnType<typeof createAdminClient>,
  rowIds: string[],
  updates: Record<string, unknown>,
): Promise<void> {
  for (let i = 0; i < rowIds.length; i += ROW_ID_CHUNK) {
    const { error } = await supabase
      .from('emails')
      .update(updates)
      .in('id', rowIds.slice(i, i + ROW_ID_CHUNK));
    if (error) throw error;
  }
}

/**
 * Makes MailDeck's copy of an Outlook inbox match the real one.
 *
 * The inbox-scoped delta only reports changes while a delta link is held, so
 * mail that left the inbox during a gap (a full resync after the link
 * expired, an update that failed) stayed "in the inbox" here, and sweeps then
 * moved or deleted messages the user had already filed or deleted. This
 * archives local copies that aren't in the real inbox, un-archives ones that
 * are, and fetches up to 100 inbox messages that never synced.
 *
 * `inboxIds` comes from a full sync's own listing; otherwise the inbox is
 * listed here (ids only) and nothing changes unless the listing is complete.
 */
async function outlookReconcile(
  supabase: ReturnType<typeof createAdminClient>,
  account: Record<string, unknown>,
  accessToken: string,
  inboxIds?: Set<string>,
): Promise<{ archived: number; restored: number; added: number; missing: number } | null> {
  const accountId = account.id as string;
  let ids = inboxIds;
  if (!ids) {
    const folder = await (await outlookFetch(accessToken,
      'https://graph.microsoft.com/v1.0/me/mailFolders/Inbox?$select=totalItemCount')).json();
    const total = Number(folder.totalItemCount);
    const listed = new Set<string>();
    let url: string | null = 'https://graph.microsoft.com/v1.0/me/mailFolders/Inbox/messages?$select=id&$top=1000';
    while (url) {
      const data = await (await outlookFetch(accessToken, url)).json();
      for (const msg of data.value ?? []) listed.add(msg.id as string);
      url = data['@odata.nextLink'] || null;
    }
    // Mail arriving or leaving mid-listing shifts the count slightly; a big
    // shortfall means the listing is incomplete, so change nothing.
    if (!Number.isFinite(total) || listed.size < total - 25) {
      console.warn(`Outlook reconcile skipped for ${accountId}: listed ${listed.size} of ${total} inbox items`);
      return null;
    }
    ids = listed;
  }

  // Every local copy of this account's mail, live or not.
  const local = new Map<string, { id: string; live: boolean }>();
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from('emails')
      .select('id, provider_message_id, is_archived, is_deleted')
      .eq('account_id', accountId)
      .order('id')
      .range(offset, offset + 999);
    if (error) throw error;
    for (const r of data ?? []) {
      local.set(r.provider_message_id as string, { id: r.id as string, live: !r.is_archived && !r.is_deleted });
    }
    if (!data || data.length < 1000) break;
  }

  const stale: string[] = [];
  for (const [providerId, row] of local) {
    if (row.live && !ids.has(providerId)) stale.push(row.id);
  }
  const restored: string[] = [];
  const missing: string[] = [];
  for (const providerId of ids) {
    const row = local.get(providerId);
    if (!row) missing.push(providerId);
    else if (!row.live) restored.push(row.id);
  }

  await updateByRowIds(supabase, stale, { is_archived: true });
  await updateByRowIds(supabase, restored, { is_archived: false, is_deleted: false });

  let added = 0;
  if (missing.length > 0) {
    const inboxFolderId = await resolveOutlookInboxFolderId(accessToken);
    const fetchNow = missing.slice(0, 100);
    for (let i = 0; i < fetchNow.length; i += 5) {
      const msgs = await Promise.all(fetchNow.slice(i, i + 5).map(async (id) => {
        const res = await outlookFetch(accessToken,
          `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(id)}?$select=${OUTLOOK_FIELDS},internetMessageHeaders`);
        return res.json();
      }));
      const rows = msgs.map((msg) => outlookMessageToRow(msg, account.user_id as string, accountId, inboxFolderId));
      const error = await upsertEmailRows(supabase, rows);
      if (error) throw error;
      added += rows.length;
    }
  }

  if (stale.length || restored.length || missing.length) {
    console.log(`Outlook reconcile ${accountId}: archived ${stale.length}, restored ${restored.length}, added ${added} of ${missing.length} unsynced`);
  }
  return { archived: stale.length, restored: restored.length, added, missing: missing.length };
}

async function outlookFetch(accessToken: string, url: string): Promise<Response> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Graph API error (${res.status}): ${err}`);
  }
  return res;
}

// ============================================================
// Token helpers
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
    throw new Error(`Token refresh failed for ${provider}: ${await res.text()}`);
  }

  const tokens = await res.json();

  // Encrypt and store new tokens
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
