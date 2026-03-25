import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase.ts';

export interface DbSweepQueueItem {
  id: string;
  user_id: string;
  email_id: string;
  sweep_rule_id: string | null;
  scheduled_at: string;
  action: string;
  executed: boolean;
  // Joined email fields
  email?: {
    id: string;
    account_id: string;
    sender_name: string | null;
    sender_email: string | null;
    subject: string;
  };
}

/**
 * Fetch pending (non-executed) sweep queue items for a user,
 * joined with email info for display.
 */
export function useSweepQueue(userId: string | undefined) {
  return useQuery({
    queryKey: ['sweep_queue', userId],
    queryFn: async () => {
      if (!supabase || !userId) return [];
      const { data, error } = await supabase
        .from('sweep_queue')
        .select(`
          id,
          user_id,
          email_id,
          sweep_rule_id,
          scheduled_at,
          action,
          executed,
          emails!inner (
            id,
            account_id,
            sender_name,
            sender_email,
            subject
          )
        `)
        .eq('user_id', userId)
        .eq('executed', false)
        .order('scheduled_at', { ascending: true });

      if (error) throw error;
      return (data || []).map((item: Record<string, unknown>) => ({
        ...item,
        email: item.emails,
      })) as DbSweepQueueItem[];
    },
    enabled: !!supabase && !!userId,
    refetchInterval: 10000, // Refresh every 10 seconds to update countdowns
  });
}

/**
 * Exempt (remove) a sweep queue item — cancels the pending sweep action.
 */
export function useExemptSweepItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, userId }: { id: string; userId: string }) => {
      if (!supabase) throw new Error('Supabase not configured');
      const { error } = await supabase
        .from('sweep_queue')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['sweep_queue', variables.userId] });
    },
  });
}

/**
 * Insert an email into the sweep queue with a scheduled execution time.
 */
export function useAddToSweepQueue() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      userId,
      emailId,
      sweepRuleId,
      action,
      delayHours,
    }: {
      userId: string;
      emailId: string;
      sweepRuleId?: string;
      action: string;
      delayHours: number;
    }) => {
      if (!supabase) throw new Error('Supabase not configured');

      const scheduledAt = new Date(Date.now() + delayHours * 3600 * 1000).toISOString();

      const { data, error } = await supabase
        .from('sweep_queue')
        .insert({
          user_id: userId,
          email_id: emailId,
          sweep_rule_id: sweepRuleId || null,
          scheduled_at: scheduledAt,
          action: (action === 'delete' || action === 'keep_newest_delete') ? 'delete' : 'archive',
          executed: false,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['sweep_queue', variables.userId] });
    },
  });
}
