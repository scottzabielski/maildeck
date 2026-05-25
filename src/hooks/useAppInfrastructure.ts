import { useEffect } from 'react';
import { useStore } from '../store/index.ts';
import { useSyncStore } from './useSyncStore.ts';

const useMockData = import.meta.env.VITE_USE_MOCK_DATA === 'true';

/**
 * Shared infrastructure that both the desktop and mobile shells need:
 * - Supabase → Zustand hydration
 * - OAuth redirect handling
 * - Persist helpers injection
 * - Theme application
 * - Sweep countdown tick
 * - Mock email simulation (mock mode only)
 *
 * Returns `hydrated` so the caller can render a loading state.
 */
export function useAppInfrastructure(): { hydrated: boolean } {
  const tickSweepCountdowns = useStore(s => s.tickSweepCountdowns);
  const addNewEmail = useStore(s => s.addNewEmail);
  const theme = useStore(s => s.theme);

  const {
    hydrated,
    persistTheme,
    persistSweepDelay,
    persistColumnReorder,
    persistColumnCreate,
    persistColumnUpdate,
    persistColumnDelete,
    persistAccountReorder,
    persistAccountRename,
  } = useSyncStore();

  // Handle OAuth provider redirect (e.g. /settings/accounts?connected=gmail)
  useEffect(() => {
    const path = window.location.pathname;
    const params = new URLSearchParams(window.location.search);
    if (path === '/settings/accounts' && (params.has('connected') || params.has('error'))) {
      useStore.setState({ isSettingsOpen: true, settingsSection: 'accounts' });
      window.history.replaceState({}, '', '/');
    }
  }, []);

  // Expose persist helpers on the store
  useEffect(() => {
    useStore.setState({
      _persistTheme: persistTheme,
      _persistSweepDelay: persistSweepDelay,
      _persistColumnReorder: persistColumnReorder,
      _persistColumnCreate: persistColumnCreate,
      _persistColumnUpdate: persistColumnUpdate,
      _persistColumnDelete: persistColumnDelete,
      _persistAccountReorder: persistAccountReorder,
      _persistAccountRename: persistAccountRename,
    });
  }, [persistTheme, persistSweepDelay, persistColumnReorder, persistColumnCreate, persistColumnUpdate, persistColumnDelete, persistAccountReorder, persistAccountRename]);

  // Apply theme to document
  useEffect(() => {
    const apply = (resolved: string) => document.documentElement.setAttribute('data-theme', resolved);
    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      apply(mq.matches ? 'dark' : 'light');
      const handler = (e: MediaQueryListEvent) => apply(e.matches ? 'dark' : 'light');
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
    apply(theme);
  }, [theme]);

  // Tick sweep countdowns every second
  useEffect(() => {
    const interval = setInterval(tickSweepCountdowns, 1000);
    return () => clearInterval(interval);
  }, [tickSweepCountdowns]);

  // Simulate new email arrivals periodically (only in mock mode)
  useEffect(() => {
    if (!useMockData) return;

    const newEmailTemplates = [
      { columnId: 'github', accountId: 'channel1', sender: 'renovate[bot]', subject: 'Update dependency @types/node to v20.11.5', snippet: 'This PR contains the following updates...', unread: true },
      { columnId: 'team', accountId: 'syzmail', sender: 'Amy Chen', subject: 'Quick sync on API design', snippet: 'Hey, wanted to run a few things by you about the...', unread: true },
      { columnId: 'newsletters', accountId: 'szabielski', sender: 'Hacker News Digest', subject: 'Top stories today', snippet: 'Show HN: I built a real-time collaborative...', unread: true },
      { columnId: 'clients', accountId: 'scottz', sender: 'Diana Frost (Apex)', subject: 'Partnership proposal', snippet: 'We\'ve been evaluating your platform and would like to...', unread: true },
    ];
    let idx = 0;
    const interval = setInterval(() => {
      const template = newEmailTemplates[idx % newEmailTemplates.length];
      addNewEmail({
        ...template,
        id: `new-${Date.now()}`,
        time: Date.now(),
        starred: false,
      });
      idx++;
    }, 15000);

    return () => clearInterval(interval);
  }, [addNewEmail]);

  return { hydrated };
}
