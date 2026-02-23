import { createAdminClient } from '../_shared/supabase-admin.ts';
import { corsHeaders } from '../_shared/cors.ts';

type Action = 'archive' | 'unarchive' | 'delete' | 'mark_read' | 'mark_unread' | 'star' | 'unstar';

/**
 * Email actions Edge Function.
 *
 * Accepts: POST { action, email_id }
 *
 * Updates the local DB row, then syncs the action to the email provider
 * (Gmail labels or Outlook PATCH).
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { action, email_id } = (await req.json()) as {
      action: Action;
      email_id: string;
    };

    if (!action || !email_id) {
      return jsonResponse({ error: 'Missing action or email_id' }, 400);
    }

    const supabase = createAdminClient();

    // Fetch the email with its account info
    const { data: email, error: emailError } = await supabase
      .from('emails')
      .select('id, account_id, provider_message_id, is_unread, is_starred, is_archived, is_deleted')
      .eq('id', email_id)
      .single();

    if (emailError || !email) {
      return jsonResponse({ error: 'Email not found' }, 404);
    }

    const { data: account, error: accountError } = await supabase
      .from('email_accounts')
      .select('id, provider, access_token_encrypted, token_expires_at')
      .eq('id', email.account_id)
      .single();

    if (accountError || !account) {
      return jsonResponse({ error: 'Account not found' }, 404);
    }

    // Update local DB first
    const dbUpdates = getDbUpdates(action);
    await supabase
      .from('emails')
      .update(dbUpdates)
      .eq('id', email_id);

    // Decrypt access token
    const { data: accessToken } = await supabase.rpc('decrypt_token', {
      encrypted_text: account.access_token_encrypted,
    });

    if (!accessToken) {
      return jsonResponse({ error: 'Failed to decrypt token' }, 500);
    }

    // Sync to provider
    try {
      if (account.provider === 'gmail') {
        await syncToGmail(accessToken, email.provider_message_id, action);
      } else {
        await syncToOutlook(accessToken, email.provider_message_id, action);
      }
    } catch (providerError) {
      // Log but don't fail — local state is already updated
      console.error(`Provider sync failed for ${action}:`, providerError);
    }

    return jsonResponse({ ok: true, action, email_id });
  } catch (err) {
    console.error('Email action error:', err);
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});

function getDbUpdates(action: Action): Record<string, boolean> {
  switch (action) {
    case 'archive':
      return { is_archived: true };
    case 'unarchive':
      return { is_archived: false };
    case 'delete':
      return { is_deleted: true };
    case 'mark_read':
      return { is_unread: false };
    case 'mark_unread':
      return { is_unread: true };
    case 'star':
      return { is_starred: true };
    case 'unstar':
      return { is_starred: false };
    default:
      return {};
  }
}

// ============================================================
// Gmail sync
// ============================================================

async function syncToGmail(
  accessToken: string,
  messageId: string,
  action: Action,
): Promise<void> {
  let addLabelIds: string[] = [];
  let removeLabelIds: string[] = [];

  switch (action) {
    case 'archive':
      removeLabelIds = ['INBOX'];
      break;
    case 'unarchive':
      addLabelIds = ['INBOX'];
      break;
    case 'delete':
      addLabelIds = ['TRASH'];
      break;
    case 'mark_read':
      removeLabelIds = ['UNREAD'];
      break;
    case 'mark_unread':
      addLabelIds = ['UNREAD'];
      break;
    case 'star':
      addLabelIds = ['STARRED'];
      break;
    case 'unstar':
      removeLabelIds = ['STARRED'];
      break;
  }

  const body: Record<string, string[]> = {};
  if (addLabelIds.length > 0) body.addLabelIds = addLabelIds;
  if (removeLabelIds.length > 0) body.removeLabelIds = removeLabelIds;

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
    const err = await res.text();
    throw new Error(`Gmail modify failed: ${err}`);
  }
}

// ============================================================
// Outlook sync
// ============================================================

async function syncToOutlook(
  accessToken: string,
  messageId: string,
  action: Action,
): Promise<void> {
  const graphUrl = `https://graph.microsoft.com/v1.0/me/messages/${messageId}`;

  switch (action) {
    case 'archive': {
      // Move to Archive folder
      const res = await fetch(`${graphUrl}/move`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ destinationId: 'archive' }),
      });
      if (!res.ok) throw new Error(`Outlook move failed: ${await res.text()}`);
      break;
    }
    case 'unarchive': {
      const res = await fetch(`${graphUrl}/move`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ destinationId: 'inbox' }),
      });
      if (!res.ok) throw new Error(`Outlook move failed: ${await res.text()}`);
      break;
    }
    case 'delete': {
      const res = await fetch(graphUrl, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) throw new Error(`Outlook delete failed: ${await res.text()}`);
      break;
    }
    case 'mark_read':
    case 'mark_unread': {
      const res = await fetch(graphUrl, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ isRead: action === 'mark_read' }),
      });
      if (!res.ok) throw new Error(`Outlook patch failed: ${await res.text()}`);
      break;
    }
    case 'star':
    case 'unstar': {
      const res = await fetch(graphUrl, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          flag: { flagStatus: action === 'star' ? 'flagged' : 'notFlagged' },
        }),
      });
      if (!res.ok) throw new Error(`Outlook patch failed: ${await res.text()}`);
      break;
    }
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
