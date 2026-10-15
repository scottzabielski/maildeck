import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase.ts';

/** Claude check spending: this month (UTC) and the last 24 hours, with the user's limits. */
export interface ClaudeUsage {
  spent_month_usd: number;
  checks_24h: number;
  monthly_budget_usd: number;
  daily_check_limit: number;
}

export function useClaudeUsage(userId: string | undefined) {
  return useQuery({
    queryKey: ['claude_usage', userId],
    queryFn: async () => {
      if (!supabase || !userId) return null;
      const { data, error } = await supabase.rpc('my_claude_check_usage');
      if (error) throw error;
      const row = ((data ?? []) as Record<string, unknown>[])[0];
      if (!row) return null;
      return {
        spent_month_usd: Number(row.spent_month_usd ?? 0),
        checks_24h: Number(row.checks_24h ?? 0),
        monthly_budget_usd: Number(row.monthly_budget_usd ?? 0),
        daily_check_limit: Number(row.daily_check_limit ?? 0),
      } satisfies ClaudeUsage;
    },
    enabled: !!supabase && !!userId,
    refetchInterval: 60_000,
  });
}

/** Saves the monthly budget and daily check limit (profiles). */
export function useUpdateClaudeLimits() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, ...limits }: {
      userId: string;
      ai_monthly_budget_usd?: number;
      ai_daily_check_limit?: number;
    }) => {
      if (!supabase) throw new Error('Supabase not configured');
      const { error } = await supabase.from('profiles').update(limits).eq('id', userId);
      if (error) throw error;
    },
    // Show the new limits right away; the refetch confirms them.
    onMutate: ({ userId, ...limits }) => {
      queryClient.setQueryData<ClaudeUsage | null>(['claude_usage', userId], (old) =>
        old ? {
          ...old,
          monthly_budget_usd: limits.ai_monthly_budget_usd ?? old.monthly_budget_usd,
          daily_check_limit: limits.ai_daily_check_limit ?? old.daily_check_limit,
        } : old,
      );
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: ['claude_usage', variables.userId] });
    },
  });
}
