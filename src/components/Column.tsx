import { useMemo, useCallback, useRef, useLayoutEffect, useEffect } from 'react';
import { motion, AnimatePresence, type DragControls } from 'framer-motion';
import { Icons } from './ui/Icons.tsx';
import { EmailCard } from './EmailCard.tsx';
import { useStore } from '../store/index.ts';
import { emailMatchesCriteria } from '../lib/emailFilter.ts';
import { scrollPositions } from '../lib/scrollPositions.ts';
import { registerColumn, unregisterColumn } from '../lib/columnRegistry.ts';
import type { Column as ColumnType } from '../types/index.ts';

interface ColumnProps {
  column: ColumnType;
  dragControls?: DragControls;
  columnOrder?: number;
}

export function Column({ column, dragControls, columnOrder = 0 }: ColumnProps) {
  const { emails, accounts, disabledAccountIds, openColumnContextMenu, selectedEmail, highlightedEmail, sweepEmails, sweepRules, searchQuery, globalStreamNoSweep, _fetchNextPage, _hasNextPage, _isFetchingNextPage } = useStore();
  const selectedEmailId = selectedEmail ? selectedEmail.emailId : null;
  const highlightedEmailId = highlightedEmail ? highlightedEmail.emailId : null;

  const enabledSweepRules = useMemo(
    () => sweepRules.filter(r => r.enabled),
    [sweepRules]
  );

  // Match each displayed email against enabled sweep rules → { action } for the soonest rule
  const sweepRuleMatchLookup = useMemo(() => {
    const map = new Map<string, { action: string }>();
    if (enabledSweepRules.length === 0) return map;
    for (const email of emails) {
      let bestRule: { action: string; delayHours: number } | null = null;
      for (const rule of enabledSweepRules) {
        if (emailMatchesCriteria(email, rule.criteria, rule.criteriaLogic)) {
          if (!bestRule || rule.delayHours < bestRule.delayHours) {
            bestRule = { action: rule.action, delayHours: rule.delayHours };
          }
        }
      }
      if (bestRule) map.set(email.id, { action: bestRule.action });
    }
    return map;
  }, [emails, enabledSweepRules]);

  const columnEmails = useMemo(() => {
    return emails.filter(e => {
      if (disabledAccountIds.has(e.accountId)) return false;
      if (e.columnId) return e.columnId === column.id;
      if (column.criteria.length > 0) return emailMatchesCriteria(e, column.criteria, column.criteriaLogic);
      return false;
    });
  }, [emails, column.id, column.criteria, column.criteriaLogic, disabledAccountIds]);

  const displayEmails = useMemo(() => {
    let filtered = columnEmails;
    const q = searchQuery.toLowerCase();
    if (q) {
      filtered = filtered.filter(e =>
        e.sender.toLowerCase().includes(q)
        || (e.senderEmail || '').toLowerCase().includes(q)
        || e.subject.toLowerCase().includes(q)
        || e.snippet.toLowerCase().includes(q)
      );
    }
    if (globalStreamNoSweep) {
      filtered = filtered.filter(e =>
        !enabledSweepRules.some(rule => emailMatchesCriteria(e, rule.criteria, rule.criteriaLogic))
      );
    }
    return filtered;
  }, [columnEmails, searchQuery, globalStreamNoSweep, enabledSweepRules]);

  // Register column in the column registry for keyboard navigation
  useEffect(() => {
    registerColumn({
      columnId: column.id,
      accountId: null,
      emailIds: displayEmails.map(e => e.id),
      order: columnOrder,
    });
    return () => unregisterColumn(column.id);
  }, [displayEmails, column.id, columnOrder]);

  // Build a lookup from email ID → sweep countdown seconds
  const sweepLookup = useMemo(() => {
    const map = new Map<string, { seconds: number; action: string }>();
    for (const s of sweepEmails) {
      map.set(s.id, { seconds: s.sweepSeconds, action: s.action || 'archive' });
    }
    return map;
  }, [sweepEmails]);
  const unreadCount = columnEmails.filter(e => e.unread).length;

  const scrollRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const saved = scrollPositions.get(column.id);
    if (saved && scrollRef.current) {
      scrollRef.current.scrollTop = saved;
    }
  }, [column.id]);

  // Auto-fetch more pages if the column isn't scrollable.
  // Skip when a filter is active — fetching more pages won't help since the filter hides them.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !_hasNextPage || !_fetchNextPage || globalStreamNoSweep || searchQuery) return;
    const check = () => {
      if (_isFetchingNextPage) return;
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 200;
      if (el.scrollHeight <= el.clientHeight + 10 || atBottom) {
        _fetchNextPage();
      }
    };
    check();
    const id = setInterval(check, 300);
    return () => clearInterval(id);
  }, [_hasNextPage, _isFetchingNextPage, _fetchNextPage, globalStreamNoSweep, searchQuery]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    scrollPositions.set(column.id, el.scrollTop);
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
      if (_hasNextPage && !_isFetchingNextPage) _fetchNextPage?.();
    }
  }, [column.id, _fetchNextPage, _hasNextPage, _isFetchingNextPage]);

  return (
    <motion.div
      className="column"
      style={{ '--column-accent': column.accent } as React.CSSProperties}
      layoutId={'col-' + column.id}
      layout
      transition={{ layout: { duration: 0.4, ease: [0.4, 0, 0.2, 1] } }}
    >
      <div
        className="column-header"
        style={{ borderTopColor: column.accent, cursor: dragControls ? 'grab' : undefined }}
        onPointerDown={(e) => dragControls?.start(e)}
        onContextMenu={(e) => { e.preventDefault(); openColumnContextMenu(e.clientX, e.clientY, column.id); }}
      >
        <span className="column-drag-handle"><Icons.DragHandle /></span>
        <span className="column-icon" style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: column.accent }} />
        <span className="column-name">{column.name}</span>
        <span className="column-count">{unreadCount > 0 ? unreadCount : displayEmails.length}</span>
      </div>
      <div className="column-emails" ref={scrollRef} onScroll={handleScroll}>
        <AnimatePresence initial={false}>
          {displayEmails.map(email => (
            <EmailCard
              key={email.id}
              email={email}
              accent={column.accent}
              accounts={accounts}
              columnId={column.id}
              selectedEmailId={selectedEmailId}
              highlightedEmailId={highlightedEmailId}
              sweepSeconds={sweepLookup.get(email.id)?.seconds}
              sweepAction={sweepLookup.get(email.id)?.action}
              matchedSweepRule={sweepRuleMatchLookup.get(email.id)}
            />
          ))}
        </AnimatePresence>
        {_isFetchingNextPage && !globalStreamNoSweep && !searchQuery && <div className="column-load-more" />}
      </div>
    </motion.div>
  );
}
