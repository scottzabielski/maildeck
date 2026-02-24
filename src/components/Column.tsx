import { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Icons } from './ui/Icons.tsx';
import { EmailCard } from './EmailCard.tsx';
import { useStore } from '../store/index.ts';
import { emailMatchesCriteria } from '../lib/emailFilter.ts';
import type { Column as ColumnType } from '../types/index.ts';

interface ColumnProps {
  column: ColumnType;
}

export function Column({ column }: ColumnProps) {
  const { emails, accounts, disabledAccountIds, openCriteriaEditor, selectedEmail, sweepEmails } = useStore();
  const selectedEmailId = selectedEmail ? selectedEmail.emailId : null;
  const columnEmails = useMemo(
    () => emails.filter(e => {
      if (disabledAccountIds.has(e.accountId)) return false;
      // Mock data uses hardcoded columnId; real data uses criteria matching
      if (e.columnId) return e.columnId === column.id;
      if (column.criteria.length > 0) return emailMatchesCriteria(e, column.criteria, column.criteriaLogic);
      return false;
    }),
    [emails, column.id, column.criteria, column.criteriaLogic, disabledAccountIds]
  );
  // Build a lookup from email ID → sweep countdown seconds
  const sweepLookup = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of sweepEmails) {
      map.set(s.id, s.sweepSeconds);
    }
    return map;
  }, [sweepEmails]);
  const unreadCount = columnEmails.filter(e => e.unread).length;

  return (
    <motion.div
      className="column"
      style={{ '--column-accent': column.accent } as React.CSSProperties}
      layoutId={'col-' + column.id}
      layout
      transition={{ layout: { duration: 0.4, ease: [0.4, 0, 0.2, 1] } }}
    >
      <div className="column-header" style={{ borderTopColor: column.accent }}>
        <span className="column-drag-handle"><Icons.DragHandle /></span>
        <span className="column-icon" style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: column.accent }} />
        <span className="column-name">{column.name}</span>
        <span className="column-count">{unreadCount > 0 ? unreadCount : columnEmails.length}</span>
        <button
          className="column-filter-btn"
          onClick={() => openCriteriaEditor(column.id)}
        >
          <Icons.Filter />
        </button>
      </div>
      <div className="column-emails">
        <AnimatePresence initial={false}>
          {columnEmails.map(email => (
            <EmailCard
              key={email.id}
              email={email}
              accent={column.accent}
              accounts={accounts}
              columnId={column.id}
              selectedEmailId={selectedEmailId}
              sweepSeconds={sweepLookup.get(email.id)}
            />
          ))}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
