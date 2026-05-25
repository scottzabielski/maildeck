import { useEffect, useMemo } from 'react';
import { useStore } from '../store/index.ts';
import { useAppInfrastructure } from '../hooks/useAppInfrastructure.ts';
import { MobileBottomTabs } from './components/MobileBottomTabs.tsx';
import { useMobileNavStack } from './hooks/useMobileNavStack.ts';
import type { MobileFrame, MobileNav } from './navTypes.ts';
import { InboxesScreen } from './screens/InboxesScreen.tsx';
import { StreamsScreen } from './screens/StreamsScreen.tsx';
import { EmailScreen } from './screens/EmailScreen.tsx';
import { SettingsScreen } from './screens/SettingsScreen.tsx';
import { ColumnEditorScreen } from './screens/ColumnEditorScreen.tsx';
import { SweepRuleEditorScreen } from './screens/SweepRuleEditorScreen.tsx';
import { UndoToast } from '../components/UndoToast.tsx';
import { SyncErrorBanner } from '../components/SyncErrorBanner.tsx';
import './styles/mobile.css';

export default function MobileAppShell() {
  useEffect(() => {
    document.body.classList.add('is-mobile');
    return () => { document.body.classList.remove('is-mobile'); };
  }, []);

  const { hydrated } = useAppInfrastructure();
  const activeViewId = useStore(s => s.activeViewId);
  const selectedEmailId = useStore(s => s.selectedEmail?.emailId ?? null);
  const isSettingsOpen = useStore(s => s.isSettingsOpen);
  const editingColumnId = useStore(s => s.editingColumnId);
  const creatingColumn = useStore(s => s.creatingColumn);
  const sweepRuleEditor = useStore(s => s.sweepRuleEditor);

  const columnEditorOpen = !!editingColumnId || creatingColumn;
  const sweepEditorOpen = !!sweepRuleEditor;

  const initialFrame: MobileFrame = useMemo(
    () => ({ type: activeViewId === 'streams' ? 'streams' : 'inboxes' }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const nav: MobileNav = useMobileNavStack<MobileFrame>(initialFrame);

  const handleTabPress = (viewId: string) => {
    nav.reset({ type: viewId === 'streams' ? 'streams' : 'inboxes' });
  };

  useEffect(() => {
    if (nav.depth === 1) {
      const expected: MobileFrame['type'] = activeViewId === 'streams' ? 'streams' : 'inboxes';
      if (nav.top.type !== expected) {
        nav.reset({ type: expected });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeViewId]);

  // Selecting an email pushes the email screen; clearing it pops back.
  useEffect(() => {
    if (selectedEmailId && nav.top.type !== 'email') {
      nav.push({ type: 'email' });
    } else if (!selectedEmailId && nav.top.type === 'email') {
      nav.pop();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEmailId]);

  if (!hydrated) {
    return (
      <div className="mobile-shell">
        <div className="mobile-shell-body">
          <div className="mobile-placeholder">
            <div className="mobile-placeholder-subtitle">Loading…</div>
          </div>
        </div>
      </div>
    );
  }

  // Hide bottom tabs on screens deeper than the root (email viewer, editors)
  const showTabs = nav.depth === 1;

  return (
    <div className="mobile-shell">
      <SyncErrorBanner />
      <div className="mobile-shell-body">{renderScreen(nav.top, nav)}</div>
      {showTabs && <MobileBottomTabs onTabPress={handleTabPress} />}
      {isSettingsOpen && <SettingsScreen />}
      {columnEditorOpen && <ColumnEditorScreen />}
      {sweepEditorOpen && <SweepRuleEditorScreen />}
      <UndoToast />
    </div>
  );
}

function renderScreen(frame: MobileFrame, nav: MobileNav) {
  switch (frame.type) {
    case 'streams':
      return <StreamsScreen nav={nav} />;
    case 'email':
      return <EmailScreen nav={nav} />;
    case 'inboxes':
    default:
      return <InboxesScreen nav={nav} />;
  }
}
