import { useEffect, type ReactNode } from 'react';
import { Icons } from '../../components/ui/Icons.tsx';

interface MobileSheetProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  /** When true, the sheet uses the full screen height (used for search overlay). */
  fullHeight?: boolean;
}

export function MobileSheet({ open, onClose, title, children, fullHeight = false }: MobileSheetProps) {
  // Close on Escape (keyboards on tablets / external keyboards)
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="mobile-sheet-backdrop" onClick={onClose}>
      <div
        className={`mobile-sheet${fullHeight ? ' full' : ''}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="mobile-sheet-header">
          <div className="mobile-sheet-grabber" aria-hidden />
          <div className="mobile-sheet-title">{title}</div>
          <button
            type="button"
            className="mobile-sheet-close"
            onClick={onClose}
            aria-label="Close"
          >
            <Icons.Close />
          </button>
        </div>
        <div className="mobile-sheet-body">{children}</div>
      </div>
    </div>
  );
}
