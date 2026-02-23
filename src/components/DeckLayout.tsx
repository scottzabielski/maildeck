import { useStore } from '../store/index.ts';
import { InboxesLayout } from './InboxesLayout.tsx';
import { StreamsLayout } from './StreamsLayout.tsx';

export function DeckLayout() {
  const activeViewId = useStore(s => s.activeViewId);
  if (activeViewId === 'inboxes') return <InboxesLayout />;
  return <StreamsLayout />;
}
