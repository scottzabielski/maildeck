import { useStore } from '../../store/index.ts';
import { MobileSheet } from './MobileSheet.tsx';

interface MobileAccountsSheetProps {
  open: boolean;
  onClose: () => void;
}

export function MobileAccountsSheet({ open, onClose }: MobileAccountsSheetProps) {
  const accounts = useStore(s => s.accounts);
  const disabledAccountIds = useStore(s => s.disabledAccountIds);
  const toggleAccount = useStore(s => s.toggleAccount);

  return (
    <MobileSheet open={open} onClose={onClose} title="Accounts">
      <div className="mobile-sheet-list">
        {accounts.map(a => {
          const enabled = !disabledAccountIds.has(a.id);
          return (
            <button
              key={a.id}
              type="button"
              className="mobile-sheet-row"
              onClick={() => toggleAccount(a.id)}
            >
              <span
                className="mobile-sheet-row-dot"
                style={{ background: a.color }}
                aria-hidden
              />
              <span className="mobile-sheet-row-label">
                <span className="mobile-sheet-row-primary">{a.name}</span>
                <span className="mobile-sheet-row-secondary">{a.email}</span>
              </span>
              <span
                className={`mobile-toggle${enabled ? ' on' : ''}`}
                aria-label={enabled ? 'Enabled' : 'Disabled'}
              >
                <span className="mobile-toggle-knob" />
              </span>
            </button>
          );
        })}
        {accounts.length === 0 && (
          <div className="mobile-empty">No accounts connected. Open Settings → Accounts to add one.</div>
        )}
      </div>
    </MobileSheet>
  );
}
