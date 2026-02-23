import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase.ts';

const useMockData = import.meta.env.VITE_USE_MOCK_DATA === 'true';

/**
 * Subscribe to Supabase Realtime changes on the emails table.
 * When changes arrive, invalidate the React Query cache so the UI refreshes.
 *
 * Also subscribes to sweep_queue changes to keep the sweep column live.
 */
export function useRealtime(userId: string | undefined) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (useMockData || !supabase || !userId) return;

    const channel = supabase
      .channel('db-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'emails',
          filter: `user_id=eq.${userId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['emails', userId] });
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'sweep_queue',
          filter: `user_id=eq.${userId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['sweep_queue', userId] });
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'email_accounts',
          filter: `user_id=eq.${userId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['email_accounts', userId] });
        },
      )
      .subscribe();

    return () => {
      supabase!.removeChannel(channel);
    };
  }, [userId, queryClient]);
}
