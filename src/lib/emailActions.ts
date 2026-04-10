import { supabase } from './supabase.ts';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
const useMockData = import.meta.env.VITE_USE_MOCK_DATA === 'true';

type Action = 'archive' | 'unarchive' | 'delete' | 'mark_read' | 'mark_unread' | 'star' | 'unstar';

/**
 * Fire-and-forget email action to the Edge Function.
 * The store applies the optimistic update first, then this syncs to the backend.
 * Errors are logged but do not revert the UI (the undo system handles reversals).
 */
export async function fireEmailAction(emailId: string, action: Action): Promise<void> {
  if (useMockData || !supabase) return;

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const res = await fetch(`${SUPABASE_URL}/functions/v1/email-actions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ action, email_id: emailId }),
    });

    if (!res.ok) {
      console.error(`Email action ${action} failed:`, await res.text());
    }
  } catch (err) {
    console.error(`Email action ${action} error:`, err);
  }
}
