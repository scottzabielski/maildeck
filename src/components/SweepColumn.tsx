import { useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SweepCard } from './SweepCard.tsx';
import { useStore } from '../store/index.ts';
import { useRenderWindow } from '../hooks/useRenderWindow.ts';
import { isClaudeHeld } from '../lib/helpers.ts';

interface SweepColumnProps {
  columnCount?: number;
}

export function SweepColumn({ columnCount = 0 }: SweepColumnProps) {
  const sweepEmails = useStore(s => s.sweepEmails);
  const disabledAccountIds = useStore(s => s.disabledAccountIds);
  const _viewSwitchKey = useStore(s => s._viewSwitchKey);
  // Sweeps held by a Claude check go after the ones counting down.
  const filtered = useMemo(
    () => {
      const shown = sweepEmails.filter(e => !disabledAccountIds.has(e.accountId));
      return [...shown.filter(e => !isClaudeHeld(e)), ...shown.filter(e => isClaudeHeld(e))];
    },
    [sweepEmails, disabledAccountIds]
  );
  // A new rule can queue thousands of emails at once; draw them as you scroll.
  const { shown, hasMore, grow } = useRenderWindow('sweep', filtered.length, -1);
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (hasMore && el.scrollHeight - el.scrollTop - el.clientHeight <= el.clientHeight) grow();
  }, [hasMore, grow]);

  return (
    <motion.div
      key={`sweep-${_viewSwitchKey}`}
      className="column sweep"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3, delay: columnCount * 0.12 }}
    >
      <div className="column-header">
        <span className="column-icon">🧹</span>
        <span className="column-name">Sweep</span>
        <span className="column-count">{filtered.length}</span>
      </div>
      <div className="column-emails" onScroll={handleScroll}>
        <AnimatePresence initial={false}>
          {filtered.slice(0, shown).map(email => (
            <SweepCard key={email.id} email={email} />
          ))}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
