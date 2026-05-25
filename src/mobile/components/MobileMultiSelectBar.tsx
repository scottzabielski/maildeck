import { Icons } from '../../components/ui/Icons.tsx';
import { useStore } from '../../store/index.ts';

interface MobileMultiSelectBarProps {
  /**
   * IDs visible in the current view, used by the "Select all visible" affordance.
   */
  visibleEmailIds: string[];
}

export function MobileMultiSelectBar({ visibleEmailIds }: MobileMultiSelectBarProps) {
  const multiSelectedIds = useStore(s => s.multiSelectedIds);
  const emails = useStore(s => s.emails);
  const clearMultiSelect = useStore(s => s.clearMultiSelect);
  const archiveSelected = useStore(s => s.archiveSelected);
  const deleteSelected = useStore(s => s.deleteSelected);
  const markSelectedRead = useStore(s => s.markSelectedRead);
  const markSelectedUnread = useStore(s => s.markSelectedUnread);

  const count = multiSelectedIds.size;

  // Determine majority read state for the read/unread toggle
  const selected = emails.filter(e => multiSelectedIds.has(e.id));
  const unreadCount = selected.filter(e => e.unread).length;
  const majorityUnread = unreadCount > selected.length / 2;

  const selectAllVisible = () => {
    useStore.setState(s => {
      const next = new Set(s.multiSelectedIds);
      for (const id of visibleEmailIds) next.add(id);
      return { multiSelectedIds: next };
    });
  };

  return (
    <header className="mobile-topbar mobile-multi-bar">
      <div className="mobile-topbar-left">
        <button
          type="button"
          className="mobile-topbar-icon-btn"
          onClick={clearMultiSelect}
          aria-label="Cancel"
        >
          <Icons.Close />
        </button>
      </div>
      <button
        type="button"
        className="mobile-topbar-title mobile-multi-count"
        onClick={selectAllVisible}
      >
        {count} selected · Select all
      </button>
      <div className="mobile-topbar-right">
        <button
          type="button"
          className="mobile-topbar-icon-btn"
          onClick={() => (majorityUnread ? markSelectedRead() : markSelectedUnread())}
          aria-label={majorityUnread ? 'Mark as read' : 'Mark as unread'}
        >
          {majorityUnread ? <Icons.EnvelopeOpen /> : <Icons.Envelope />}
        </button>
        <button
          type="button"
          className="mobile-topbar-icon-btn"
          onClick={archiveSelected}
          aria-label="Archive"
        >
          <Icons.Archive />
        </button>
        <button
          type="button"
          className="mobile-topbar-icon-btn danger"
          onClick={deleteSelected}
          aria-label="Delete"
        >
          <Icons.Trash />
        </button>
      </div>
    </header>
  );
}
