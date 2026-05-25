import { lazy, Suspense } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuth } from './hooks/useAuth.ts';
import { useAppInfrastructure } from './hooks/useAppInfrastructure.ts';
import { useKeyboardNav } from './hooks/useKeyboardNav.ts';
import { useAutoRotateView } from './hooks/useAutoRotateView.ts';
import { useDeviceLayout } from './hooks/useDeviceLayout.ts';
import { TopBar } from './components/TopBar.tsx';
import { DeckLayout } from './components/DeckLayout.tsx';
import { ContextMenu } from './components/ContextMenu.tsx';
import { ColumnContextMenu } from './components/ColumnContextMenu.tsx';
import { SweepRuleEditor } from './components/SweepRuleEditor.tsx';
import { UndoToast } from './components/UndoToast.tsx';
import { ColumnCriteriaEditor } from './components/ColumnCriteriaEditor.tsx';
import { SettingsPanel } from './components/SettingsPanel.tsx';
import { SyncErrorBanner } from './components/SyncErrorBanner.tsx';
import { LoginPage } from './components/auth/LoginPage.tsx';
import { OAuthCallback } from './components/auth/OAuthCallback.tsx';

const MobileAppShell = lazy(() => import('./mobile/MobileAppShell.tsx'));

const useMockData = import.meta.env.VITE_USE_MOCK_DATA === 'true';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 2, // 2 minutes
      retry: 1,
    },
  },
});

const LoadingScreen = () => (
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

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppRouter />
    </QueryClientProvider>
  );
}

function AppRouter() {
  const { user, loading } = useAuth();
  const layout = useDeviceLayout();

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
    return <LoadingScreen />;
  }

  if (layout === 'mobile') {
    return (
      <Suspense fallback={<LoadingScreen />}>
        <MobileAppShell />
      </Suspense>
    );
  }

  return <AppShell />;
}

function AppShell() {
  // Keyboard navigation (arrow keys, Enter, Escape) — desktop only
  useKeyboardNav();

  // Auto-rotate between Streams and Inboxes views — desktop only
  useAutoRotateView();

  const { hydrated } = useAppInfrastructure();

  if (!hydrated) return <LoadingScreen />;

  return (
    <div className="app-shell">
      <TopBar />
      <SyncErrorBanner />
      <DeckLayout />
      <ContextMenu />
      <ColumnContextMenu />
      <SweepRuleEditor />
      <UndoToast />
      <ColumnCriteriaEditor />
      <SettingsPanel />
    </div>
  );
}
