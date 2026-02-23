import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase.ts';

export interface DbEmailAccount {
  id: string;
  user_id: string;
  provider: 'gmail' | 'outlook';
  email: string;
  display_name: string | null;
  color: string;
  sort_order: number;
  is_enabled: boolean;
  last_synced_at: string | null;
  sync_status: 'idle' | 'syncing' | 'error' | 'never_synced';
}

export function useEmailAccounts(userId: string | undefined) {
  return useQuery({
    queryKey: ['email_accounts', userId],
    queryFn: async () => {
      if (!supabase || !userId) return [];
      const { data, error } = await supabase
        .from('email_accounts')
        .select('id, user_id, provider, email, display_name, color, sort_order, is_enabled, last_synced_at, sync_status')
        .eq('user_id', userId)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return data as DbEmailAccount[];
    },
    enabled: !!supabase && !!userId,
    refetchInterval: 15000, // Refresh every 15 seconds to pick up sync status changes
  });
}

export function useUpdateEmailAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Pick<DbEmailAccount, 'display_name' | 'color' | 'sort_order' | 'is_enabled'>> & { id: string; userId: string }) => {
      if (!supabase) throw new Error('Supabase not configured');
      const { userId: _userId, ...dbUpdates } = updates;
      const { data, error } = await supabase
        .from('email_accounts')
        .update(dbUpdates)
        .eq('id', id)
        .select('id, user_id, provider, email, display_name, color, sort_order, is_enabled, last_synced_at, sync_status')
        .single();
      if (error) throw error;
      return data as DbEmailAccount;
    },
    onMutate: async (variables) => {
      const userId = variables.userId;
      await queryClient.cancelQueries({ queryKey: ['email_accounts', userId] });
      const previous = queryClient.getQueryData<DbEmailAccount[]>(['email_accounts', userId]);
      if (previous) {
        queryClient.setQueryData<DbEmailAccount[]>(['email_accounts', userId],
          previous.map(a => a.id === variables.id ? { ...a, ...variables } : a)
        );
      }
      return { previous, userId };
    },
    onError: (_err, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['email_accounts', context.userId], context.previous);
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: ['email_accounts', variables.userId] });
    },
  });
}

export function useDeleteEmailAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, userId }: { id: string; userId: string }) => {
      if (!supabase) throw new Error('Supabase not configured');
      const { error } = await supabase
        .from('email_accounts')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['email_accounts', variables.userId] });
    },
  });
}

export function useReorderEmailAccounts() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ accounts, userId }: { accounts: DbEmailAccount[]; userId: string }) => {
      if (!supabase) throw new Error('Supabase not configured');
      const updates = accounts.map((acct, index) =>
        supabase!
          .from('email_accounts')
          .update({ sort_order: index })
          .eq('id', acct.id)
      );
      await Promise.all(updates);
    },
    onMutate: async ({ accounts, userId }) => {
      await queryClient.cancelQueries({ queryKey: ['email_accounts', userId] });
      const previous = queryClient.getQueryData<DbEmailAccount[]>(['email_accounts', userId]);
      queryClient.setQueryData<DbEmailAccount[]>(['email_accounts', userId],
        accounts.map((a, i) => ({ ...a, sort_order: i }))
      );
      return { previous, userId };
    },
    onError: (_err, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['email_accounts', context.userId], context.previous);
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: ['email_accounts', variables.userId] });
    },
  });
}
