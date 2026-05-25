import { useEffect, useRef } from 'react';
import { Icons } from '../../components/ui/Icons.tsx';
import { useStore } from '../../store/index.ts';

interface MobileSearchOverlayProps {
  open: boolean;
  onClose: () => void;
}

export function MobileSearchOverlay({ open, onClose }: MobileSearchOverlayProps) {
  const searchQuery = useStore(s => s.searchQuery);
  const setSearchQuery = useStore(s => s.setSearchQuery);
  const accounts = useStore(s => s.accounts);
  const disabledAccountIds = useStore(s => s.disabledAccountIds);
  const toggleAccount = useStore(s => s.toggleAccount);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      // Focus after mount so iOS shows the keyboard
      const id = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(id);
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className="mobile-search-overlay">
      <div className="mobile-search-bar">
        <button
          type="button"
          className="mobile-search-back"
          onClick={onClose}
          aria-label="Close search"
        >
          <Icons.ChevronLeft />
        </button>
        <div className="mobile-search-input-wrap">
          <Icons.Search />
          <input
            ref={inputRef}
            type="search"
            className="mobile-search-input"
            placeholder="Search emails…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
          />
          {searchQuery && (
            <button
              type="button"
              className="mobile-search-clear"
              onClick={() => { setSearchQuery(''); inputRef.current?.focus(); }}
              aria-label="Clear search"
            >
              <Icons.Close />
            </button>
          )}
        </div>
      </div>

      {/* Account toggle strip. Tap "All" to mass-enable/disable every account;
          tap an individual chip to toggle just that one. Disabled chips are
          dimmed. Filters the live search results below. */}
      {accounts.length > 0 && (
        <div className="mobile-search-accounts">
          <button
            type="button"
            className={`mobile-search-account${disabledAccountIds.size === 0 ? ' on' : ''}`}
            onClick={() => {
              if (disabledAccountIds.size === 0) {
                useStore.setState({ disabledAccountIds: new Set(accounts.map(a => a.id)) });
              } else {
                useStore.setState({ disabledAccountIds: new Set() });
              }
            }}
            aria-pressed={disabledAccountIds.size === 0}
            title={disabledAccountIds.size === 0 ? 'Hide all' : 'Show all'}
          >
            <span className="mobile-search-account-name">All</span>
          </button>
          {accounts.map(a => {
            const enabled = !disabledAccountIds.has(a.id);
            return (
              <button
                key={a.id}
                type="button"
                className={`mobile-search-account${enabled ? ' on' : ''}`}
                onClick={() => toggleAccount(a.id)}
                aria-pressed={enabled}
                title={enabled ? `Hide ${a.name}` : `Show ${a.name}`}
              >
                <span
                  className="mobile-search-account-dot"
                  style={{ background: a.color }}
                  aria-hidden
                />
                <span className="mobile-search-account-name">{a.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
