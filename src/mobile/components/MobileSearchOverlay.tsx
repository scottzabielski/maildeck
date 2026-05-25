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
      <div className="mobile-search-hint">
        {searchQuery
          ? <>Showing results across your current view.</>
          : <>Type to search across emails in the current view.</>
        }
      </div>
    </div>
  );
}
