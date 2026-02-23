import { useMemo } from 'react';
import { AnimatePresence } from 'framer-motion';
import { SweepCard } from './SweepCard.tsx';
import { useStore } from '../store/index.ts';

export function SweepColumn() {
  const sweepEmails = useStore(s => s.sweepEmails);
  const disabledAccountIds = useStore(s => s.disabledAccountIds);
  const filtered = useMemo(
    () => sweepEmails.filter(e => !disabledAccountIds.has(e.accountId)),
    [sweepEmails, disabledAccountIds]
  );

  return (
    <div className="column sweep">
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
    </div>
  );
}
