import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase.ts';

export interface DbSweepRule {
  id: string;
  user_id: string;
  name: string;
  detail: string | null;
  is_enabled: boolean;
  sender_pattern: string | null;
  action: string;
  delay_hours: number;
}

export function useSweepRules(userId: string | undefined) {
  return useQuery({
    queryKey: ['sweep_rules', userId],
    queryFn: async () => {
      if (!supabase || !userId) return [];
      const { data, error } = await supabase
        .from('sweep_rules')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data as DbSweepRule[];
    },
    enabled: !!supabase && !!userId,
  });
}

export function useCreateSweepRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (rule: Omit<DbSweepRule, 'id'>) => {
      if (!supabase) throw new Error('Supabase not configured');
      const { data, error } = await supabase
        .from('sweep_rules')
        .insert(rule)
        .select()
        .single();
      if (error) throw error;
      return data as DbSweepRule;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['sweep_rules', variables.user_id] });
    },
  });
}

export function useUpdateSweepRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<DbSweepRule> & { id: string; user_id: string }) => {
      if (!supabase) throw new Error('Supabase not configured');
      const { data, error } = await supabase
        .from('sweep_rules')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data as DbSweepRule;
    },
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: ['sweep_rules', variables.user_id] });
      const previous = queryClient.getQueryData<DbSweepRule[]>(['sweep_rules', variables.user_id]);
      if (previous) {
        queryClient.setQueryData<DbSweepRule[]>(['sweep_rules', variables.user_id],
          previous.map(r => r.id === variables.id ? { ...r, ...variables } : r)
        );
      }
      return { previous, userId: variables.user_id };
    },
    onError: (_err, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['sweep_rules', context.userId], context.previous);
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: ['sweep_rules', variables.user_id] });
    },
  });
}

export function useToggleSweepRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, is_enabled, userId }: { id: string; is_enabled: boolean; userId: string }) => {
      if (!supabase) throw new Error('Supabase not configured');
      const { data, error } = await supabase
        .from('sweep_rules')
        .update({ is_enabled })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data as DbSweepRule;
    },
    onMutate: async ({ id, is_enabled, userId }) => {
      await queryClient.cancelQueries({ queryKey: ['sweep_rules', userId] });
      const previous = queryClient.getQueryData<DbSweepRule[]>(['sweep_rules', userId]);
      if (previous) {
        queryClient.setQueryData<DbSweepRule[]>(['sweep_rules', userId],
          previous.map(r => r.id === id ? { ...r, is_enabled } : r)
        );
      }
      return { previous, userId };
    },
    onError: (_err, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['sweep_rules', context.userId], context.previous);
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: ['sweep_rules', variables.userId] });
    },
  });
}

export function useDeleteSweepRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, userId }: { id: string; userId: string }) => {
      if (!supabase) throw new Error('Supabase not configured');
      const { error } = await supabase
        .from('sweep_rules')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['sweep_rules', variables.userId] });
    },
  });
}
