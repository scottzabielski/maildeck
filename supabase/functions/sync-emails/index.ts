import { createAdminClient } from '../_shared/supabase-admin.ts';
import { corsHeaders } from '../_shared/cors.ts';

/**
 * Email sync Edge Function.
 *
 * Modes:
 * - full: Initial sync — fetch all inbox emails
 * - incremental: Fetch only new/changed emails since last sync
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
      mode?: 'full' | 'incremental';
    };

    const supabase = createAdminClient();

    if (account_id) {
      // Sync a specific account
      const result = await syncAccount(supabase, account_id, mode);
      return jsonResponse(result);
    }

    // Sync all enabled accounts (for pg_cron polling)
    const { data: accounts, error } = await supabase
      .from('email_accounts')
      .select('id')
      .eq('is_enabled', true)
      .neq('sync_status', 'never_synced');

    if (error) throw error;

    const results = [];
    for (const acct of accounts || []) {
      try {
        const result = await syncAccount(supabase, acct.id, 'incremental');
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

  // Mark as syncing
  await supabase
    .from('email_accounts')
    .update({ sync_status: 'syncing' })
    .eq('id', accountId);

  try {
    // Decrypt access token
    let accessToken = await decryptToken(supabase, account.access_token_encrypted);

    // Check if token is expired and refresh if needed
    if (account.token_expires_at && new Date(account.token_expires_at) <= new Date()) {
      accessToken = await refreshAndUpdate(supabase, account);
    }

    let messageCount: number;

    if (account.provider === 'gmail') {
      messageCount = mode === 'full' || !account.sync_history_id
        ? await gmailFullSync(supabase, account, accessToken)
        : await gmailIncrementalSync(supabase, account, accessToken);
    } else {
      messageCount = mode === 'full' || !account.sync_delta_link
        ? await outlookFullSync(supabase, account, accessToken)
        : await outlookIncrementalSync(supabase, account, accessToken);
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

  // Fetch message metadata in parallel batches with time budget
  let synced = 0;
  const batchSize = 20;

  for (let i = 0; i < remainingIds.length; i += batchSize) {
    if (Date.now() - startTime > TIME_BUDGET_MS) {
      console.log(`Time budget reached after syncing ${synced} messages, ${remainingIds.length - i} still remaining`);
      break;
    }

    const batch = remainingIds.slice(i, i + batchSize);
    const messages = await Promise.all(
      batch.map(async (id) => {
        const res = await gmailFetch(accessToken, `/messages/${id}?format=METADATA&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject`);
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
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      startHistoryId: historyId,
      historyTypes: 'messageAdded,messageDeleted,labelAdded,labelRemoved',
    });
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
      }
    }

    pageToken = data.nextPageToken;
  } while (pageToken);

  // Fetch and upsert added messages
  let synced = 0;
  const uniqueAdded = [...new Set(addedIds)];

  for (let i = 0; i < uniqueAdded.length; i += 20) {
    const batch = uniqueAdded.slice(i, i + 20);
    const messages = await Promise.all(
      batch.map(async (id) => {
        const res = await gmailFetch(accessToken, `/messages/${id}?format=METADATA&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject`);
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
  if (deletedIds.length > 0) {
    await supabase
      .from('emails')
      .update({ is_deleted: true })
      .eq('account_id', accountId)
      .in('provider_message_id', deletedIds);
  }

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
  };
}

async function gmailFetch(accessToken: string, path: string): Promise<Response> {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gmail API error (${res.status}): ${err}`);
  }
  return res;
}

// ============================================================
// Outlook sync
// ============================================================

async function outlookFullSync(
  supabase: ReturnType<typeof createAdminClient>,
  account: Record<string, unknown>,
  accessToken: string,
): Promise<number> {
  const userId = account.user_id as string;
  const accountId = account.id as string;

  let synced = 0;
  let url: string | null = `https://graph.microsoft.com/v1.0/me/messages?$top=100&$orderby=receivedDateTime desc&$select=id,conversationId,from,toRecipients,subject,bodyPreview,receivedDateTime,isRead,flag,categories,parentFolderId`;

  while (url) {
    const res = await outlookFetch(accessToken, url);
    const data = await res.json();

    if (data.value) {
      const rows = data.value.map((msg: Record<string, unknown>) =>
        outlookMessageToRow(msg, userId, accountId),
      );
      const { error } = await supabase
        .from('emails')
        .upsert(rows, { onConflict: 'account_id,provider_message_id' });

      if (error) console.error('Upsert batch error:', error);
      synced += rows.length;
    }

    url = data['@odata.nextLink'] || null;
  }

  // Get deltaLink for incremental sync
  const deltaUrl = `https://graph.microsoft.com/v1.0/me/messages/delta?$select=id,conversationId,from,toRecipients,subject,bodyPreview,receivedDateTime,isRead,flag,categories,parentFolderId`;
  let deltaLink: string | null = null;
  let deltaNextUrl: string | null = deltaUrl;

  while (deltaNextUrl) {
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
        const rows = added.map((msg: Record<string, unknown>) =>
          outlookMessageToRow(msg, userId, accountId),
        );
        await supabase
          .from('emails')
          .upsert(rows, { onConflict: 'account_id,provider_message_id' });
        synced += rows.length;
      }

      if (removed.length > 0) {
        const ids = removed.map((msg: Record<string, unknown>) => msg.id as string);
        await supabase
          .from('emails')
          .update({ is_deleted: true })
          .eq('account_id', accountId)
          .in('provider_message_id', ids);
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

function outlookMessageToRow(
  msg: Record<string, unknown>,
  userId: string,
  accountId: string,
) {
  const from = msg.from as { emailAddress: { name: string; address: string } } | undefined;
  const toRecipients = msg.toRecipients as Array<{ emailAddress: { name: string; address: string } }> | undefined;
  const flag = msg.flag as { flagStatus: string } | undefined;

  // Determine if archived (not in Inbox folder)
  // The Inbox folder ID varies per user, but deletedItems contains "deleteditems"
  const parentFolderId = (msg.parentFolderId as string) || '';

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
    is_archived: false, // Will be determined by folder-based logic
    is_deleted: parentFolderId.toLowerCase().includes('deleteditems'),
    labels: JSON.stringify(msg.categories || []),
    recipients: JSON.stringify(
      (toRecipients || []).map((r) => ({
        name: r.emailAddress.name,
        email: r.emailAddress.address,
      })),
    ),
  };
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
