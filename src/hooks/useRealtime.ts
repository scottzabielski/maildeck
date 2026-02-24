import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase.ts';

const useMockData = import.meta.env.VITE_USE_MOCK_DATA === 'true';

/**
 * Subscribe to Supabase Realtime changes on the emails table.
 * When changes arrive, invalidate the React Query cache so the UI refreshes.
 *
 * Invalidations are debounced per-table to avoid flooding the browser with
 * concurrent requests during bulk operations (e.g., email sync).
 *
 * Also subscribes to sweep_queue changes to keep the sweep column live.
 */
export function useRealtime(userId: string | undefined) {
  const queryClient = useQueryClient();
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    if (useMockData || !supabase || !userId) return;

    const debouncedInvalidate = (queryKey: unknown[], key: string, delay = 2000) => {
      if (timers.current[key]) clearTimeout(timers.current[key]);
      timers.current[key] = setTimeout(() => {
        queryClient.invalidateQueries({ queryKey });
        delete timers.current[key];
      }, delay);
    };

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
          debouncedInvalidate(['emails', userId], 'emails', 2000);
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
          debouncedInvalidate(['sweep_queue', userId], 'sweep_queue', 1000);
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
          debouncedInvalidate(['email_accounts', userId], 'email_accounts', 1000);
        },
      )
      .subscribe();

    return () => {
      // Clear all pending debounce timers
      for (const timer of Object.values(timers.current)) {
        clearTimeout(timer);
      }
      timers.current = {};
      supabase!.removeChannel(channel);
    };
  }, [userId, queryClient]);
}
