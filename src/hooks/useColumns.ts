import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase.ts';

export interface DbColumn {
  id: string;
  user_id: string;
  name: string;
  icon: string;
  accent: string;
  criteria: Array<{ field: string; op: string; value: string }>;
  criteria_logic: 'and' | 'or';
  sort_order: number;
  is_enabled: boolean;
}

export function useColumns(userId: string | undefined) {
  return useQuery({
    queryKey: ['columns', userId],
    queryFn: async () => {
      if (!supabase || !userId) return [];
      const { data, error } = await supabase
        .from('columns')
        .select('*')
        .eq('user_id', userId)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return data as DbColumn[];
    },
    enabled: !!supabase && !!userId,
  });
}

export function useCreateColumn() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (col: Omit<DbColumn, 'id'>) => {
      if (!supabase) throw new Error('Supabase not configured');
      const { data, error } = await supabase
        .from('columns')
        .insert(col)
        .select()
        .single();
      if (error) throw error;
      return data as DbColumn;
    },
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: ['columns', variables.user_id] });
      const previous = queryClient.getQueryData<DbColumn[]>(['columns', variables.user_id]);
      // Optimistically add the new column with a temporary ID
      const optimistic: DbColumn = { ...variables, id: `temp-${Date.now()}` } as DbColumn;
      queryClient.setQueryData<DbColumn[]>(['columns', variables.user_id],
        [...(previous || []), optimistic]
      );
      return { previous, userId: variables.user_id };
    },
    onSuccess: (data, variables) => {
      // Replace the optimistic entry with the real server data
      const current = queryClient.getQueryData<DbColumn[]>(['columns', variables.user_id]);
      if (current) {
        queryClient.setQueryData<DbColumn[]>(['columns', variables.user_id],
          current.map(c => c.id.startsWith('temp-') ? data : c)
        );
      }
    },
    onError: (_err, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['columns', context.userId], context.previous);
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: ['columns', variables.user_id] });
    },
  });
}

export function useUpdateColumn() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<DbColumn> & { id: string; user_id: string }) => {
      if (!supabase) throw new Error('Supabase not configured');
      const { data, error } = await supabase
        .from('columns')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data as DbColumn;
    },
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: ['columns', variables.user_id] });
      const previous = queryClient.getQueryData<DbColumn[]>(['columns', variables.user_id]);
      if (previous) {
        queryClient.setQueryData<DbColumn[]>(['columns', variables.user_id],
          previous.map(c => c.id === variables.id ? { ...c, ...variables } : c)
        );
      }
      return { previous, userId: variables.user_id };
    },
    onError: (_err, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['columns', context.userId], context.previous);
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: ['columns', variables.user_id] });
    },
  });
}

export function useDeleteColumn() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, userId }: { id: string; userId: string }) => {
      if (!supabase) throw new Error('Supabase not configured');
      const { error } = await supabase
        .from('columns')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['columns', variables.userId] });
    },
  });
}

export function useReorderColumns() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ columns, userId }: { columns: DbColumn[]; userId: string }) => {
      if (!supabase) throw new Error('Supabase not configured');
      // Update sort_order for each column
      const updates = columns.map((col, index) =>
        supabase!
          .from('columns')
          .update({ sort_order: index })
          .eq('id', col.id)
      );
      await Promise.all(updates);
    },
    onMutate: async ({ columns, userId }) => {
      await queryClient.cancelQueries({ queryKey: ['columns', userId] });
      const previous = queryClient.getQueryData<DbColumn[]>(['columns', userId]);
      queryClient.setQueryData<DbColumn[]>(['columns', userId],
        columns.map((c, i) => ({ ...c, sort_order: i }))
      );
      return { previous, userId };
    },
    onError: (_err, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['columns', context.userId], context.previous);
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: ['columns', variables.userId] });
    },
  });
}
