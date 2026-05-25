import { useStore } from '../../store/index.ts';
import { MobileSheet } from './MobileSheet.tsx';

interface MobileFiltersSheetProps {
  open: boolean;
  onClose: () => void;
}

const FILTER_GROUPS: Array<{ id: string; label: string; group?: 'read' | 'tag' }> = [
  { id: 'unread', label: 'Unread', group: 'read' },
  { id: 'read', label: 'Read', group: 'read' },
  { id: 'starred', label: 'Starred', group: 'tag' },
  { id: 'no-stream', label: 'No Stream', group: 'tag' },
  { id: 'no-sweep', label: 'No Sweep Rule', group: 'tag' },
];

export function MobileFiltersSheet({ open, onClose }: MobileFiltersSheetProps) {
  const globalFilters = useStore(s => s.globalFilters);
  const toggleGlobalFilter = useStore(s => s.toggleGlobalFilter);

  const clearAll = () => {
    useStore.setState({ globalFilters: new Set() });
  };

  return (
    <MobileSheet open={open} onClose={onClose} title="Filter">
      <div className="mobile-sheet-list">
        <button
          type="button"
          className={`mobile-sheet-row${globalFilters.size === 0 ? ' active' : ''}`}
          onClick={clearAll}
        >
          <span>All Messages</span>
          {globalFilters.size === 0 && <span className="mobile-sheet-check">✓</span>}
        </button>
        <div className="mobile-sheet-separator" />
        {FILTER_GROUPS.map(f => {
          const active = globalFilters.has(f.id);
          return (
            <button
              key={f.id}
              type="button"
              className={`mobile-sheet-row${active ? ' active' : ''}`}
              onClick={() => toggleGlobalFilter(f.id)}
            >
              <span>{f.label}</span>
              {active && <span className="mobile-sheet-check">✓</span>}
            </button>
          );
        })}
      </div>
    </MobileSheet>
  );
}
