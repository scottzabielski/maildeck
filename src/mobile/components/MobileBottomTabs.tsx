import { useStore } from '../../store/index.ts';

interface MobileBottomTabsProps {
  onTabPress?: (viewId: string) => void;
}

export function MobileBottomTabs({ onTabPress }: MobileBottomTabsProps) {
  const views = useStore(s => s.views);
  const activeViewId = useStore(s => s.activeViewId);
  const setActiveView = useStore(s => s.setActiveView);

  const handlePress = (id: string) => {
    setActiveView(id);
    onTabPress?.(id);
  };

  return (
    <nav className="mobile-bottom-tabs" role="tablist">
      {views.map(v => {
        const active = v.id === activeViewId;
        return (
          <button
            key={v.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={`mobile-bottom-tab${active ? ' active' : ''}`}
            onClick={() => handlePress(v.id)}
          >
            <span className="mobile-bottom-tab-icon" aria-hidden>
              {v.id === 'inboxes' ? <InboxesIcon /> : <StreamsIcon />}
            </span>
            <span className="mobile-bottom-tab-label">{v.name}</span>
          </button>
        );
      })}
    </nav>
  );
}

function InboxesIcon() {
  return (
    <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </svg>
  );
}

function StreamsIcon() {
  return (
    <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x={3} y={4} width={4} height={16} rx={1} />
      <rect x={10} y={4} width={4} height={16} rx={1} />
      <rect x={17} y={4} width={4} height={16} rx={1} />
    </svg>
  );
}
