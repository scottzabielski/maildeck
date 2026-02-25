import { useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useStore } from '../store/index.ts';
import { InboxesLayout } from './InboxesLayout.tsx';
import { StreamsLayout } from './StreamsLayout.tsx';

const variants = {
  enter: { opacity: 0, x: 40 },
  center: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -40 },
};

export function DeckLayout() {
  const activeViewId = useStore(s => s.activeViewId);
  const hasMounted = useRef(false);

  // Skip entrance animation on initial mount
  const shouldAnimate = hasMounted.current;
  hasMounted.current = true;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={activeViewId}
        variants={variants}
        initial={shouldAnimate ? 'enter' : false}
        animate="center"
        exit="exit"
        transition={{ duration: 0.35, ease: 'easeOut' }}
        className="deck-view-wrapper"
      >
        {activeViewId === 'inboxes' ? <InboxesLayout /> : <StreamsLayout />}
      </motion.div>
    </AnimatePresence>
  );
}
