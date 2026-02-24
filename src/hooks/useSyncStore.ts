import { useEffect, useRef } from 'react';
import { useStore } from '../store/index.ts';
import { useAuth } from './useAuth.ts';
import { useProfile, useUpdateProfile } from './useProfile.ts';
import { useColumns, useReorderColumns, useCreateColumn, useUpdateColumn, useDeleteColumn } from './useColumns.ts';
import { useSweepRules } from './useSweepRules.ts';
import { useEmailAccounts, useReorderEmailAccounts, useUpdateEmailAccount } from './useEmailAccounts.ts';
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
  const { data: dbColumns, isFetched: columnsFetched } = useColumns(useMockData ? undefined : userId);
  const { data: dbSweepRules } = useSweepRules(useMockData ? undefined : userId);
  const { data: dbAccounts, isFetched: accountsFetched } = useEmailAccounts(useMockData ? undefined : userId);
  const { data: dbEmailPages, isFetched: emailsFetched, fetchNextPage, hasNextPage, isFetchingNextPage } = useEmails(useMockData ? undefined : userId);
  const { data: dbSweepQueue } = useSweepQueue(useMockData ? undefined : userId);

  const hydrated = useMockData || (accountsFetched && emailsFetched && columnsFetched);

  const updateProfileMutation = useUpdateProfile();
  const reorderColumnsMutation = useReorderColumns();
  const createColumnMutation = useCreateColumn();
  const updateColumnMutation = useUpdateColumn();
  const deleteColumnMutation = useDeleteColumn();
  const reorderAccountsMutation = useReorderEmailAccounts();
  const updateAccountMutation = useUpdateEmailAccount();
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
      enabled: c.is_enabled,
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
      criteria: r.criteria || (r.sender_pattern ? [{ field: 'from', op: 'contains', value: r.sender_pattern }] : []),
      criteriaLogic: r.criteria_logic || 'and',
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

  // Sync emails → store (flatten infinite query pages)
  useEffect(() => {
    if (useMockData || !dbEmailPages) return;
    const allDbEmails = dbEmailPages.pages.flat();
    const mapped: Email[] = allDbEmails.map(e => {
      const firstRecipient = Array.isArray(e.recipients) && e.recipients.length > 0
        ? e.recipients[0].email
        : undefined;
      return {
        id: e.id,
        columnId: '', // No hardcoded columnId — columns use criteria matching
        accountId: e.account_id,
        sender: e.sender_name || e.sender_email || '',
        senderEmail: e.sender_email || '',
        toEmail: firstRecipient,
        subject: e.subject,
        snippet: e.snippet,
        time: new Date(e.received_at).getTime(),
        unread: e.is_unread,
        starred: e.is_starred,
        labels: e.labels,
      };
    });
    useStore.setState({ emails: mapped });
  }, [dbEmailPages]);

  // Sync pagination state → store
  useEffect(() => {
    if (useMockData) return;
    useStore.setState({
      _fetchNextPage: hasNextPage ? () => fetchNextPage() : undefined,
      _hasNextPage: hasNextPage,
      _isFetchingNextPage: isFetchingNextPage,
    });
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Sync sweep queue → store (as SweepEmail[])
  useEffect(() => {
    if (useMockData || !dbSweepQueue) return;
    const mapped: SweepEmail[] = dbSweepQueue.map(item => {
      const scheduledAt = new Date(item.scheduled_at).getTime();
      const secondsRemaining = Math.max(0, Math.floor((scheduledAt - Date.now()) / 1000));
      return {
        id: item.email_id,
        accountId: item.email?.account_id || '',
        sender: item.email?.sender_name || item.email?.sender_email || '',
        subject: item.email?.subject || '',
        sweepSeconds: secondsRemaining,
        exempted: false,
        action: item.action,
      };
    });
    useStore.setState({ sweepEmails: mapped });
  }, [dbSweepQueue]);

  // Auto-trigger initial sync for newly connected accounts (staggered to avoid rate limits)
  useEffect(() => {
    if (useMockData || !dbAccounts) return;
    const needsSync = dbAccounts.filter(
      acct => (acct.sync_status === 'never_synced' || acct.sync_status === 'error')
        && !syncedAccountsRef.current.has(acct.id)
    );
    if (needsSync.length === 0) return;

    // Sync accounts sequentially with delays to avoid rate limits
    let cancelled = false;
    (async () => {
      for (let i = 0; i < needsSync.length; i++) {
        if (cancelled) break;
        const acct = needsSync[i];
        syncedAccountsRef.current.add(acct.id);
        try {
          await syncAccountMutation.mutateAsync({ accountId: acct.id, mode: 'full' });
        } catch (e) {
          console.error(`Sync failed for ${acct.email}:`, e);
        }
        // Wait 2 seconds between accounts to avoid rate limits
        if (i < needsSync.length - 1) {
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    })();

    return () => { cancelled = true; };
  }, [dbAccounts, syncAccountMutation]);

  // Return mutation helpers for the settings panel to use
  return {
    userId,
    useMockData,
    hydrated,
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
      const dbColMap = new Map(dbColumns.map(dc => [dc.id, dc]));
      const dbCols = columns.map((storeCol, i) => {
        const dc = dbColMap.get(storeCol.id);
        return dc ? { ...dc, sort_order: i } : null;
      }).filter(Boolean) as typeof dbColumns;
      reorderColumnsMutation.mutate({ columns: dbCols, userId });
    },
    persistColumnCreate: (column: Column) => {
      if (useMockData || !userId) return;
      const sortOrder = useStore.getState().columns.length - 1;
      createColumnMutation.mutate({
        user_id: userId,
        name: column.name,
        icon: column.icon,
        accent: column.accent,
        criteria: column.criteria,
        criteria_logic: column.criteriaLogic,
        sort_order: Math.max(0, sortOrder),
        is_enabled: column.enabled,
      });
    },
    persistColumnUpdate: (columnId: string, updates: Partial<Omit<Column, 'id'>>) => {
      if (useMockData || !userId) return;
      const dbUpdates: Record<string, unknown> = {};
      if (updates.name !== undefined) dbUpdates.name = updates.name;
      if (updates.icon !== undefined) dbUpdates.icon = updates.icon;
      if (updates.accent !== undefined) dbUpdates.accent = updates.accent;
      if (updates.criteria !== undefined) dbUpdates.criteria = updates.criteria;
      if (updates.criteriaLogic !== undefined) dbUpdates.criteria_logic = updates.criteriaLogic;
      if (updates.enabled !== undefined) dbUpdates.is_enabled = updates.enabled;
      updateColumnMutation.mutate({ id: columnId, user_id: userId, ...dbUpdates } as any);
    },
    persistColumnDelete: (columnId: string) => {
      if (useMockData || !userId) return;
      deleteColumnMutation.mutate({ id: columnId, userId });
    },
    persistAccountReorder: (accounts: Account[]) => {
      if (useMockData || !userId || !dbAccounts) return;
      const dbAcctMap = new Map(dbAccounts.map(da => [da.id, da]));
      const dbAccts = accounts.map((storeAcct, i) => {
        const da = dbAcctMap.get(storeAcct.id);
        return da ? { ...da, sort_order: i } : null;
      }).filter(Boolean) as typeof dbAccounts;
      reorderAccountsMutation.mutate({ accounts: dbAccts, userId });
    },
    persistAccountRename: (accountId: string, name: string) => {
      if (useMockData || !userId) return;
      updateAccountMutation.mutate({ id: accountId, display_name: name, userId });
    },
  };
}
