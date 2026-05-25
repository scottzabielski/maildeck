import { useStore } from '../../store/index.ts';

export function SettingsNotificationsScreen() {
  const soundVolume = useStore(s => s.soundVolume);
  const setSoundVolume = useStore(s => s.setSoundVolume);

  const muted = soundVolume === 0;

  return (
    <div className="mobile-settings-section">
      <div className="mobile-settings-header">
        <div className="mobile-settings-header-text">
          Sound effects when sweep actions fire. Push notifications coming later.
        </div>
      </div>
      <div className="mobile-settings-card">
        <div className="mobile-settings-row">
          <div className="mobile-settings-row-main">
            <div className="mobile-settings-row-primary">Sweep sound</div>
            <div className="mobile-settings-row-secondary">{muted ? 'Muted' : `Volume ${Math.round(soundVolume * 100)}%`}</div>
          </div>
          <span
            className={`mobile-toggle${!muted ? ' on' : ''}`}
            onClick={() => setSoundVolume(muted ? 0.6 : 0)}
            role="switch"
            aria-checked={!muted}
          >
            <span className="mobile-toggle-knob" />
          </span>
        </div>
        {!muted && (
          <div className="mobile-settings-row">
            <div className="mobile-settings-row-main">
              <div className="mobile-settings-row-primary">Volume</div>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={soundVolume}
              onChange={(e) => setSoundVolume(parseFloat(e.target.value))}
              style={{ width: 140 }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
