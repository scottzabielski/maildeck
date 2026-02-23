import { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useStore } from './store/index.ts';
import { useAuth } from './hooks/useAuth.ts';
import { useSyncStore } from './hooks/useSyncStore.ts';
import { TopBar } from './components/TopBar.tsx';
import { DeckLayout } from './components/DeckLayout.tsx';
import { ContextMenu } from './components/ContextMenu.tsx';
import { SweepRuleEditor } from './components/SweepRuleEditor.tsx';
import { UndoToast } from './components/UndoToast.tsx';
import { ColumnCriteriaEditor } from './components/ColumnCriteriaEditor.tsx';
import { SettingsPanel } from './components/SettingsPanel.tsx';
import { LoginPage } from './components/auth/LoginPage.tsx';
import { OAuthCallback } from './components/auth/OAuthCallback.tsx';

const useMockData = import.meta.env.VITE_USE_MOCK_DATA === 'true';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 2, // 2 minutes
      retry: 1,
    },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppRouter />
    </QueryClientProvider>
  );
}

function AppRouter() {
  const { user, loading } = useAuth();

  // Show auth callback handler
  if (!useMockData && window.location.pathname === '/auth/callback') {
    return <OAuthCallback />;
  }

  // Show login page if Supabase is configured and user is not authenticated
  if (!useMockData && !loading && !user) {
    return <LoginPage />;
  }

  // Show loading spinner while checking auth
  if (!useMockData && loading) {
    return (
      <div style={{
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-base)',
        color: 'var(--text-secondary)',
        fontSize: '14px',
      }}>
        Loading...
      </div>
    );
  }

  return <AppShell />;
}

function AppShell() {
  const tickSweepCountdowns = useStore(s => s.tickSweepCountdowns);
  const addNewEmail = useStore(s => s.addNewEmail);
  const theme = useStore(s => s.theme);
  const deselectEmail = useStore(s => s.deselectEmail);
  const selectedEmail = useStore(s => s.selectedEmail);

  // Sync Supabase data → Zustand store
  const { persistTheme, persistSweepDelay, persistColumnReorder, persistAccountReorder } = useSyncStore();

  // Handle OAuth provider redirect (e.g. /settings/accounts?connected=gmail)
  useEffect(() => {
    const path = window.location.pathname;
    const params = new URLSearchParams(window.location.search);
    if (path === '/settings/accounts' && (params.has('connected') || params.has('error'))) {
      useStore.setState({ isSettingsOpen: true, settingsSection: 'accounts' });
      // Clean up the URL
      window.history.replaceState({}, '', '/');
    }
  }, []);

  // Expose persist helpers on the store for settings panel to use
  useEffect(() => {
    useStore.setState({
      _persistTheme: persistTheme,
      _persistSweepDelay: persistSweepDelay,
      _persistColumnReorder: persistColumnReorder,
      _persistAccountReorder: persistAccountReorder,
    });
  }, [persistTheme, persistSweepDelay, persistColumnReorder, persistAccountReorder]);

  // Escape key to close email viewer (only if no context menu is open)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedEmail && !useStore.getState().contextMenu) deselectEmail();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectedEmail, deselectEmail]);

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
    }, 15000); // every 15 seconds

    return () => clearInterval(interval);
  }, [addNewEmail]);

  return (
    <>
      <TopBar />
      <DeckLayout />
      <ContextMenu />
      <SweepRuleEditor />
      <UndoToast />
      <ColumnCriteriaEditor />
      <SettingsPanel />
    </>
  );
}
