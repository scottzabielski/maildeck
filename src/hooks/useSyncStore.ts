import { useEffect, useRef } from 'react';
import { useStore } from '../store/index.ts';
import { useAuth } from './useAuth.ts';
import { useProfile, useUpdateProfile } from './useProfile.ts';
import { useColumns, useReorderColumns } from './useColumns.ts';
import { useSweepRules } from './useSweepRules.ts';
import { useEmailAccounts, useReorderEmailAccounts } from './useEmailAccounts.ts';
import { useEmails, useSyncAccount } from './useEmails.ts';
import { useSweepQueue } from './useSweepQueue.ts';
import { useRealtime } from './useRealtime.ts';
import type { Column, Account, SweepRule, SweepEmail, Email } from '../types/index.ts';

const useMockData = import.meta.env.VITE_USE_MOCK_DATA === 'true';

/**
 * Syncs Supabase data into the Zustand store.
 * When mock data is enabled, this hook is a no-op.
 *
 * Call this once in App/AppShell to hydrate the store.
 */
export function useSyncStore() {
  const { user } = useAuth();
  const userId = user?.id;

  const { data: profile } = useProfile(useMockData ? undefined : userId);
  const { data: dbColumns } = useColumns(useMockData ? undefined : userId);
  const { data: dbSweepRules } = useSweepRules(useMockData ? undefined : userId);
  const { data: dbAccounts } = useEmailAccounts(useMockData ? undefined : userId);
  const { data: dbEmails } = useEmails(useMockData ? undefined : userId);
  const { data: dbSweepQueue } = useSweepQueue(useMockData ? undefined : userId);

  const updateProfileMutation = useUpdateProfile();
  const reorderColumnsMutation = useReorderColumns();
  const reorderAccountsMutation = useReorderEmailAccounts();
  const syncAccountMutation = useSyncAccount();

  // Track which accounts we've already triggered initial sync for
  const syncedAccountsRef = useRef<Set<string>>(new Set());

  // Subscribe to Supabase Realtime for live updates
  useRealtime(useMockData ? undefined : userId);

  // Sync profile → store
  useEffect(() => {
    if (useMockData || !profile) return;
    const store = useStore.getState();
    if (profile.theme !== store.theme) {
      store.setTheme(profile.theme);
    }
    if (profile.default_sweep_delay_hours !== store.sweepDelayHours) {
      store.setSweepDelayHours(profile.default_sweep_delay_hours);
    }
  }, [profile]);

  // Sync columns → store
  useEffect(() => {
    if (useMockData || !dbColumns) return;
    const mapped: Column[] = dbColumns.map(c => ({
      id: c.id,
      name: c.name,
      icon: c.icon,
      accent: c.accent,
      criteria: c.criteria,
      criteriaLogic: c.criteria_logic,
    }));
    useStore.setState({ columns: mapped });
  }, [dbColumns]);

  // Sync sweep rules → store
  useEffect(() => {
    if (useMockData || !dbSweepRules) return;
    const mapped: SweepRule[] = dbSweepRules.map(r => ({
      id: r.id,
      name: r.name,
      detail: r.detail || '',
      enabled: r.is_enabled,
      sender: r.sender_pattern,
      action: r.action,
      delayHours: r.delay_hours,
    }));
    useStore.setState({ sweepRules: mapped });
  }, [dbSweepRules]);

  // Sync email accounts → store (as Account[])
  useEffect(() => {
    if (useMockData || !dbAccounts) return;
    const mapped: Account[] = dbAccounts.map(a => ({
      id: a.id,
      name: a.display_name || a.email,
      email: a.email,
      color: a.color,
      provider: a.provider === 'gmail' ? 'Gmail' : 'Outlook',
    }));
    useStore.setState({ accounts: mapped });
  }, [dbAccounts]);

  // Sync emails → store
  useEffect(() => {
    if (useMockData || !dbEmails) return;
    const mapped: Email[] = dbEmails.map(e => ({
      id: e.id,
      columnId: '', // No hardcoded columnId — columns use criteria matching
      accountId: e.account_id,
      sender: e.sender_name || e.sender_email || '',
      senderEmail: e.sender_email || '',
      subject: e.subject,
      snippet: e.snippet,
      time: new Date(e.received_at).getTime(),
      unread: e.is_unread,
      starred: e.is_starred,
      labels: e.labels,
    }));
    useStore.setState({ emails: mapped });
  }, [dbEmails]);

  // Sync sweep queue → store (as SweepEmail[])
  useEffect(() => {
    if (useMockData || !dbSweepQueue) return;
    const mapped: SweepEmail[] = dbSweepQueue.map(item => {
      const scheduledAt = new Date(item.scheduled_at).getTime();
      const secondsRemaining = Math.max(0, Math.floor((scheduledAt - Date.now()) / 1000));
      return {
        id: item.id,
        accountId: item.email?.account_id || '',
        sender: item.email?.sender_name || item.email?.sender_email || '',
        subject: item.email?.subject || '',
        sweepSeconds: secondsRemaining,
        exempted: false,
      };
    });
    useStore.setState({ sweepEmails: mapped });
  }, [dbSweepQueue]);

  // Auto-trigger initial sync for newly connected accounts
  useEffect(() => {
    if (useMockData || !dbAccounts) return;
    for (const acct of dbAccounts) {
      if (acct.sync_status === 'never_synced' && !syncedAccountsRef.current.has(acct.id)) {
        syncedAccountsRef.current.add(acct.id);
        syncAccountMutation.mutate({ accountId: acct.id, mode: 'full' });
      }
    }
  }, [dbAccounts, syncAccountMutation]);

  // Return mutation helpers for the settings panel to use
  return {
    userId,
    useMockData,
    persistTheme: (theme: string) => {
      if (useMockData || !userId) return;
      updateProfileMutation.mutate({ id: userId, theme });
    },
    persistSweepDelay: (hours: number) => {
      if (useMockData || !userId) return;
      updateProfileMutation.mutate({ id: userId, default_sweep_delay_hours: hours });
    },
    persistColumnReorder: (columns: Column[]) => {
      if (useMockData || !userId || !dbColumns) return;
      const dbCols = dbColumns.map((dc, i) => {
        const storeCol = columns[i];
        return storeCol ? { ...dc, sort_order: i } : dc;
      });
      reorderColumnsMutation.mutate({ columns: dbCols, userId });
    },
    persistAccountReorder: (accounts: Account[]) => {
      if (useMockData || !userId || !dbAccounts) return;
      const dbAccts = dbAccounts.map((da, i) => {
        const storeAcct = accounts[i];
        return storeAcct ? { ...da, sort_order: i } : da;
      });
      reorderAccountsMutation.mutate({ accounts: dbAccts, userId });
    },
  };
}
