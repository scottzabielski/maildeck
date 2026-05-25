import type { ReactNode } from 'react';

export interface SegmentedPickerOption {
  id: string;
  label: ReactNode;
  /** Optional left-edge color dot (e.g. account color, stream accent). */
  color?: string;
  /** Optional unread/total count rendered as a small badge. */
  count?: number;
}

interface MobileSegmentedPickerProps {
  options: SegmentedPickerOption[];
  selectedId: string;
  onSelect: (id: string) => void;
  /** Optional trailing chips rendered after the options (e.g. "+ Add"). */
  trailing?: ReactNode;
}

export function MobileSegmentedPicker({
  options,
  selectedId,
  onSelect,
  trailing,
}: MobileSegmentedPickerProps) {
  return (
    <div className="mobile-picker" role="tablist">
      {options.map(opt => {
        const active = opt.id === selectedId;
        return (
          <button
            key={opt.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={`mobile-picker-chip${active ? ' active' : ''}`}
            onClick={() => onSelect(opt.id)}
          >
            {opt.color && (
              <span
                className="mobile-picker-chip-dot"
                style={{ background: opt.color }}
                aria-hidden
              />
            )}
            <span className="mobile-picker-chip-label">{opt.label}</span>
            {opt.count != null && opt.count > 0 && (
              <span className="mobile-picker-chip-count">{opt.count}</span>
            )}
          </button>
        );
      })}
      {trailing}
    </div>
  );
}
