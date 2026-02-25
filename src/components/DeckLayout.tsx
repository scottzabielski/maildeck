import { AnimatePresence, motion } from 'framer-motion';
import { useStore } from '../store/index.ts';
import { InboxesLayout } from './InboxesLayout.tsx';
import { StreamsLayout } from './StreamsLayout.tsx';

export function DeckLayout() {
  const activeViewId = useStore(s => s.activeViewId);

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={activeViewId}
        initial={{ opacity: 1 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="deck-view-wrapper"
      >
        {activeViewId === 'inboxes' ? <InboxesLayout /> : <StreamsLayout />}
      </motion.div>
    </AnimatePresence>
  );
}
