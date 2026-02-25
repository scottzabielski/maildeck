import { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SweepCard } from './SweepCard.tsx';
import { useStore } from '../store/index.ts';

interface SweepColumnProps {
  columnCount?: number;
}

export function SweepColumn({ columnCount = 0 }: SweepColumnProps) {
  const sweepEmails = useStore(s => s.sweepEmails);
  const disabledAccountIds = useStore(s => s.disabledAccountIds);
  const _viewSwitchKey = useStore(s => s._viewSwitchKey);
  const filtered = useMemo(
    () => sweepEmails.filter(e => !disabledAccountIds.has(e.accountId)),
    [sweepEmails, disabledAccountIds]
  );

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
      <div className="column-emails">
        <AnimatePresence initial={false}>
          {filtered.map(email => (
            <SweepCard key={email.id} email={email} />
          ))}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
