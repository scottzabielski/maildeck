import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase.ts';

const PAGE_SIZE = 500;

export interface DbEmail {
  id: string;
  user_id: string;
  account_id: string;
  provider_message_id: string;
  thread_id: string | null;
  sender_name: string | null;
  sender_email: string | null;
  recipients: Array<{ name?: string; email: string }>;
  subject: string;
  snippet: string;
  body_text: string | null;
  body_html: string | null;
  received_at: string;
  is_unread: boolean;
  is_starred: boolean;
  is_archived: boolean;
  is_deleted: boolean;
  labels: string[];
}

/**
 * Fetch non-archived, non-deleted emails with cursor-based pagination.
 */
export function useEmails(userId: string | undefined) {
  return useInfiniteQuery({
    queryKey: ['emails', userId],
    queryFn: async ({ pageParam }: { pageParam: string | undefined }) => {
      if (!supabase || !userId) return [];
      let query = supabase
        .from('emails')
        .select('id, user_id, account_id, provider_message_id, thread_id, sender_name, sender_email, recipients, subject, snippet, received_at, is_unread, is_starred, is_archived, is_deleted, labels')
        .eq('user_id', userId)
        .eq('is_archived', false)
        .eq('is_deleted', false)
        .order('received_at', { ascending: false })
        .limit(PAGE_SIZE);
      if (pageParam) {
        query = query.lt('received_at', pageParam);
      }
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as DbEmail[];
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => {
      if (lastPage.length < PAGE_SIZE) return undefined;
      return lastPage[lastPage.length - 1].received_at;
    },
    enabled: !!supabase && !!userId,
    refetchInterval: 30000,
  });
}

/**
 * Trigger initial sync for a specific email account.
 */
export function useSyncAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ accountId, mode = 'full' }: { accountId: string; mode?: 'full' | 'incremental' }) => {
      if (!supabase) throw new Error('Supabase not configured');

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-emails`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ account_id: accountId, mode }),
        },
      );

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Sync failed: ${err}`);
      }

      return res.json();
    },
    onSuccess: () => {
      // Invalidate emails and accounts queries to refresh UI
      queryClient.invalidateQueries({ queryKey: ['emails'] });
      queryClient.invalidateQueries({ queryKey: ['email_accounts'] });
    },
  });
}
