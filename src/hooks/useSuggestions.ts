import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase.ts';
import type { Criterion, Suggestion } from '../types/index.ts';

async function callEdgeFunction<T>(path: string, body: unknown): Promise<T> {
  if (!supabase) throw new Error('Supabase not configured');
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('No active session');

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  const res = await fetch(`${supabaseUrl}/functions/v1/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error || `${path} failed: ${res.status}`);
  }
  return (await res.json()) as T;
}

export function useSuggestRuleName() {
  return useMutation({
    mutationFn: async (input: {
      criteria: Criterion[];
      criteriaLogic: 'and' | 'or';
      action: string;
      existingRuleNames: string[];
    }) => {
      return callEdgeFunction<{ name: string; detail: string }>('suggest-rule-name', input);
    },
  });
}

export function useSuggestConsolidations() {
  return useMutation({
    mutationFn: async () => {
      return callEdgeFunction<{ suggestions: Suggestion[] }>('suggest-sweep-consolidations', {});
    },
  });
}

export function useDismissSuggestion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, suggestionHash }: { userId: string; suggestionHash: string }) => {
      if (!supabase) throw new Error('Supabase not configured');
      const { error } = await supabase
        .from('sweep_suggestion_dismissals')
        .upsert(
          { user_id: userId, suggestion_hash: suggestionHash },
          { onConflict: 'user_id,suggestion_hash' },
        );
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['sweep_suggestion_dismissals', variables.userId] });
    },
  });
}
