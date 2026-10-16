import { memo, useMemo, useCallback, useRef, useLayoutEffect, useEffect } from 'react';
import { motion, AnimatePresence, type DragControls } from 'framer-motion';
import { useShallow } from 'zustand/react/shallow';
import { Icons } from './ui/Icons.tsx';
import { EmailCard } from './EmailCard.tsx';
import { useStore } from '../store/index.ts';
import { useRenderWindow } from '../hooks/useRenderWindow.ts';
import { emailMatchesSearch, inStream, sweepRuleMatch, sweepsById } from '../lib/emailFilter.ts';
import { scrollPositions } from '../lib/scrollPositions.ts';
import { registerColumn, unregisterColumn } from '../lib/columnRegistry.ts';
import type { Column as ColumnType } from '../types/index.ts';

interface ColumnProps {
  column: ColumnType;
  dragControls?: DragControls;
  columnOrder?: number;
}

export const Column = memo(function Column({ column, dragControls, columnOrder = 0 }: ColumnProps) {
  const { emails, columns, disabledAccountIds, sweepEmails, sweepRules, exemptedEmailIds, searchQuery, globalFilters, _fetchNextPage, _hasNextPage, _isFetchingNextPage, _viewSwitchKey } = useStore(useShallow(s => ({
    emails: s.emails,
    columns: s.columns,
    disabledAccountIds: s.disabledAccountIds,
    sweepEmails: s.sweepEmails,
    sweepRules: s.sweepRules,
    exemptedEmailIds: s.exemptedEmailIds,
    searchQuery: s.searchQuery,
    globalFilters: s.globalFilters,
    _fetchNextPage: s._fetchNextPage,
    _hasNextPage: s._hasNextPage,
    _isFetchingNextPage: s._isFetchingNextPage,
    _viewSwitchKey: s._viewSwitchKey,
  })));
  const openColumnContextMenu = useStore(s => s.openColumnContextMenu);
  // The keyboard highlight when it's in this column: arrow keys can move it past the cards drawn so far.
  const highlightedId = useStore(s => s.highlightedEmail?.columnId === column.id ? s.highlightedEmail.emailId : null);

  // columns, sweepEmails, sweepRules and exemptedEmailIds are in the dep list
  // because a stream column may use the "stream" or "sweep" criterion fields,
  // which read the other streams, the sweep queue, the active rules and the
  // exemption set. Without them, the column wouldn't re-filter when any of those change.
  const columnEmails = useMemo(() => emails.filter(e => {
    if (disabledAccountIds.has(e.accountId)) return false;
    if (e.columnId) return e.columnId === column.id;
    return column.criteria.length > 0 && inStream(e, column);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [emails, column, disabledAccountIds, columns, sweepEmails, sweepRules, exemptedEmailIds]);

  // The "no-sweep" filter reads the rules (and any streams they name).
  const displayEmails = useMemo(() => {
    let filtered = columnEmails;
    const q = searchQuery.toLowerCase();
    if (q) filtered = filtered.filter(e => emailMatchesSearch(e, q));
    if (globalFilters.has('no-sweep')) filtered = filtered.filter(e => !sweepRuleMatch(e));
    if (globalFilters.has('unread')) filtered = filtered.filter(e => e.unread);
    if (globalFilters.has('read')) filtered = filtered.filter(e => !e.unread);
    if (globalFilters.has('starred')) filtered = filtered.filter(e => e.starred);
    return filtered;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnEmails, searchQuery, globalFilters, sweepRules, columns]);

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

  const sweeps = sweepsById(sweepEmails);
  const unreadCount = useMemo(() => columnEmails.filter(e => e.unread).length, [columnEmails]);
  const highlightIndex = useMemo(
    () => (highlightedId ? displayEmails.findIndex(e => e.id === highlightedId) : -1),
    [displayEmails, highlightedId]
  );
  const { shown, hasMore, grow } = useRenderWindow(column.id, displayEmails.length, highlightIndex);

  const scrollRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const saved = scrollPositions.get(column.id);
    if (saved && scrollRef.current) {
      scrollRef.current.scrollTop = saved;
    }
  }, [column.id]);

  // When the column isn't scrollable, draw more of the loaded emails, then fetch more pages.
  // Skip when a filter is active, search is active, or column is empty (no matches won't improve with older pages).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || globalFilters.size > 0 || searchQuery || displayEmails.length === 0) return;
    if (!hasMore && (!_hasNextPage || !_fetchNextPage)) return;
    const check = () => {
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 200;
      if (el.scrollHeight > el.clientHeight + 10 && !atBottom) return;
      if (hasMore) grow();
      else if (!_isFetchingNextPage) _fetchNextPage?.();
    };
    check();
    const id = setInterval(check, 300);
    return () => clearInterval(id);
  }, [_hasNextPage, _isFetchingNextPage, _fetchNextPage, globalFilters, searchQuery, displayEmails.length, hasMore, grow]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    scrollPositions.set(column.id, el.scrollTop);
    const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    // Draw more cards a screen early so scrolling never reaches the end of what's drawn.
    if (hasMore && fromBottom <= el.clientHeight) grow();
    else if (!hasMore && fromBottom <= 200 && _hasNextPage && !_isFetchingNextPage) _fetchNextPage?.();
  }, [column.id, _fetchNextPage, _hasNextPage, _isFetchingNextPage, hasMore, grow]);

  return (
    <motion.div
      key={`col-${column.id}-${_viewSwitchKey}`}
      className="column"
      style={{ '--column-accent': column.accent } as React.CSSProperties}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3, ease: 'easeOut', delay: columnOrder * 0.12 }}
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
          {displayEmails.slice(0, shown).map(email => (
            <EmailCard
              key={email.id}
              email={email}
              accent={column.accent}
              columnId={column.id}
              sweep={sweeps.get(email.id)}
              matchedSweepRule={sweepRuleMatch(email) ?? undefined}
            />
          ))}
        </AnimatePresence>
        {_isFetchingNextPage && globalFilters.size === 0 && !searchQuery && displayEmails.length > 0 && <div className="column-load-more" />}
      </div>
    </motion.div>
  );
});
