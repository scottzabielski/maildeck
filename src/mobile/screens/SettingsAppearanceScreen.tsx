import { useState, useEffect } from 'react';
import { useStore } from '../../store/index.ts';
import {
  getDeviceLayoutOverride,
  setDeviceLayoutOverride,
  type DeviceLayoutOverride,
} from '../../hooks/useDeviceLayout.ts';

export function SettingsAppearanceScreen() {
  const theme = useStore(s => s.theme);
  const setTheme = useStore(s => s.setTheme);
  const [override, setOverride] = useState<DeviceLayoutOverride>(() => getDeviceLayoutOverride());

  // Stay in sync with external override changes (e.g. desktop shell toggled it)
  useEffect(() => {
    const handler = () => setOverride(getDeviceLayoutOverride());
    window.addEventListener('maildeck:device-override-changed', handler);
    return () => window.removeEventListener('maildeck:device-override-changed', handler);
  }, []);

  const updateOverride = (value: DeviceLayoutOverride) => {
    setOverride(value);
    setDeviceLayoutOverride(value);
  };

  return (
    <div className="mobile-settings-section">
      <div className="mobile-settings-header">
        <div className="mobile-settings-header-text">Look and feel.</div>
      </div>
      <div className="mobile-settings-card">
        <div className="mobile-settings-row">
          <div className="mobile-settings-row-main">
            <div className="mobile-settings-row-primary">Theme</div>
            <div className="mobile-settings-row-secondary">Color scheme for MailDeck</div>
          </div>
          <select
            className="mobile-settings-select"
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
          >
            <option value="dark">Dark</option>
            <option value="light">Light</option>
            <option value="system">System</option>
          </select>
        </div>
        <div className="mobile-settings-row">
          <div className="mobile-settings-row-main">
            <div className="mobile-settings-row-primary">Layout</div>
            <div className="mobile-settings-row-secondary">
              {override === 'auto'
                ? 'Auto-pick mobile or desktop based on the screen'
                : override === 'mobile'
                  ? 'Always show the mobile layout'
                  : 'Always show the desktop layout'}
            </div>
          </div>
          <select
            className="mobile-settings-select"
            value={override}
            onChange={(e) => updateOverride(e.target.value as DeviceLayoutOverride)}
          >
            <option value="auto">Auto</option>
            <option value="mobile">Always mobile</option>
            <option value="desktop">Always desktop</option>
          </select>
        </div>
      </div>
    </div>
  );
}
