import type { ReactNode } from 'react';
import { Icons } from '../../components/ui/Icons.tsx';

interface MobileTopBarProps {
  /** When provided, replaces the logo + title with a back chevron + title. */
  onBack?: () => void;
  /** Screen title shown in the centre. */
  title?: ReactNode;
  /** Action slot rendered on the right side of the bar. */
  rightSlot?: ReactNode;
  /** Optional custom left slot (e.g. multi-select cancel button). */
  leftSlot?: ReactNode;
}

export function MobileTopBar({ onBack, title, rightSlot, leftSlot }: MobileTopBarProps) {
  return (
    <header className="mobile-topbar">
      <div className="mobile-topbar-left">
        {leftSlot ? (
          leftSlot
        ) : onBack ? (
          <button
            type="button"
            className="mobile-topbar-back"
            onClick={onBack}
            aria-label="Back"
          >
            <Icons.ChevronLeft />
          </button>
        ) : (
          <div className="mobile-topbar-logo" aria-hidden>
            <Icons.Mail />
          </div>
        )}
      </div>
      <div className="mobile-topbar-title">{title}</div>
      <div className="mobile-topbar-right">{rightSlot}</div>
    </header>
  );
}
