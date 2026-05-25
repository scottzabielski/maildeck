import { useState } from 'react';
import { Icons } from '../../components/ui/Icons.tsx';
import { useStore } from '../../store/index.ts';
import { MobileTopBar } from '../components/MobileTopBar.tsx';
import { SettingsAccountsScreen } from './SettingsAccountsScreen.tsx';
import { SettingsColumnsScreen } from './SettingsColumnsScreen.tsx';
import { SettingsSweepScreen } from './SettingsSweepScreen.tsx';
import { SettingsAppearanceScreen } from './SettingsAppearanceScreen.tsx';
import { SettingsNotificationsScreen } from './SettingsNotificationsScreen.tsx';

type SettingsSubScreen =
  | 'root'
  | 'accounts'
  | 'columns'
  | 'sweep'
  | 'appearance'
  | 'notifications';

const SECTIONS: Array<{ id: SettingsSubScreen; name: string; icon: string; desc: string }> = [
  { id: 'accounts', name: 'Accounts', icon: '👤', desc: 'Manage connected email accounts' },
  { id: 'columns', name: 'Streams', icon: '📋', desc: 'Filter columns and ordering' },
  { id: 'sweep', name: 'Sweep Rules', icon: '🧹', desc: 'Auto-archive and auto-delete rules' },
  { id: 'notifications', name: 'Notifications', icon: '🔔', desc: 'Alerts and sounds' },
  { id: 'appearance', name: 'Appearance', icon: '🎨', desc: 'Theme and layout' },
];

export function SettingsScreen() {
  const toggleSettings = useStore(s => s.toggleSettings);
  const settingsSection = useStore(s => s.settingsSection);
  const setSettingsSection = useStore(s => s.setSettingsSection);

  // Pick the initial sub-screen from the store's `settingsSection` if it's
  // valid — that's how the desktop SettingsPanel decides which section opens.
  const initialSub: SettingsSubScreen =
    SECTIONS.some(s => s.id === settingsSection)
      ? (settingsSection as SettingsSubScreen)
      : 'root';

  const [sub, setSub] = useState<SettingsSubScreen>(initialSub);

  const close = () => {
    toggleSettings();
    setSettingsSection('accounts'); // reset for next open
    setSub('root');
  };

  const navigate = (next: SettingsSubScreen) => {
    setSub(next);
    if (next !== 'root') setSettingsSection(next);
  };

  if (sub === 'root') {
    return (
      <div className="mobile-settings-overlay">
        <div className="mobile-screen">
          <MobileTopBar
            title="Settings"
            leftSlot={
              <button
                type="button"
                className="mobile-topbar-icon-btn"
                onClick={close}
                aria-label="Close settings"
              >
                <Icons.Close />
              </button>
            }
          />
          <div className="mobile-settings-list">
            {SECTIONS.map(s => (
              <button
                key={s.id}
                type="button"
                className="mobile-settings-row"
                onClick={() => navigate(s.id)}
              >
                <span className="mobile-settings-row-icon" aria-hidden>{s.icon}</span>
                <span className="mobile-settings-row-text">
                  <span className="mobile-settings-row-name">{s.name}</span>
                  <span className="mobile-settings-row-desc">{s.desc}</span>
                </span>
                <Icons.ChevronRight />
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  let content: React.ReactNode = null;
  let title: string = '';
  switch (sub) {
    case 'accounts':
      title = 'Accounts';
      content = <SettingsAccountsScreen />;
      break;
    case 'columns':
      title = 'Streams';
      content = <SettingsColumnsScreen />;
      break;
    case 'sweep':
      title = 'Sweep Rules';
      content = <SettingsSweepScreen />;
      break;
    case 'appearance':
      title = 'Appearance';
      content = <SettingsAppearanceScreen />;
      break;
    case 'notifications':
      title = 'Notifications';
      content = <SettingsNotificationsScreen />;
      break;
  }

  return (
    <div className="mobile-settings-overlay">
      <div className="mobile-screen">
        <MobileTopBar
          onBack={() => navigate('root')}
          title={title}
          rightSlot={
            <button
              type="button"
              className="mobile-topbar-icon-btn"
              onClick={close}
              aria-label="Close settings"
            >
              <Icons.Close />
            </button>
          }
        />
        <div className="mobile-settings-body">{content}</div>
      </div>
    </div>
  );
}
