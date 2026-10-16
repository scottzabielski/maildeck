import { memo, useMemo, useCallback, useRef, useState, useEffect, useLayoutEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useShallow } from 'zustand/react/shallow';
import { EmailCard } from './EmailCard.tsx';
import { Icons } from './ui/Icons.tsx';
import { useStore } from '../store/index.ts';
import { useSyncAccount } from '../hooks/useEmails.ts';
import { useRenderWindow } from '../hooks/useRenderWindow.ts';
import { emailMatchesSearch, streamTags, sweepRuleMatch, sweepsById } from '../lib/emailFilter.ts';
import { scrollPositions } from '../lib/scrollPositions.ts';
import { registerColumn, unregisterColumn } from '../lib/columnRegistry.ts';

interface InboxColumnProps {
  accountId: string | null;
  columnOrder?: number;
}

export const InboxColumn = memo(function InboxColumn({ accountId, columnOrder = 0 }: InboxColumnProps) {
  const { emails, accounts, disabledAccountIds, sweepEmails, columns, sweepRules, exemptedEmailIds, searchQuery, globalFilters, _fetchNextPage, _hasNextPage, _isFetchingNextPage, _viewSwitchKey } = useStore(useShallow(s => ({
    emails: s.emails,
    accounts: s.accounts,
    disabledAccountIds: s.disabledAccountIds,
    sweepEmails: s.sweepEmails,
    columns: s.columns,
    sweepRules: s.sweepRules,
    exemptedEmailIds: s.exemptedEmailIds,
    searchQuery: s.searchQuery,
    globalFilters: s.globalFilters,
    _fetchNextPage: s._fetchNextPage,
    _hasNextPage: s._hasNextPage,
    _isFetchingNextPage: s._isFetchingNextPage,
    _viewSwitchKey: s._viewSwitchKey,
  })));
  const registryColumnId = accountId || 'all-inboxes';
  // The keyboard highlight when it's in this column: arrow keys can move it past the cards drawn so far.
  const highlightedId = useStore(s => s.highlightedEmail?.columnId === registryColumnId ? s.highlightedEmail.emailId : null);
  const syncMutation = useSyncAccount();
  const [syncing, setSyncing] = useState(false);

  const columnEmails = useMemo(() => {
    const q = searchQuery.toLowerCase();
    let filtered;
    if (accountId) {
      filtered = emails.filter(e => e.accountId === accountId && !disabledAccountIds.has(e.accountId));
    } else {
      filtered = emails.filter(e => !disabledAccountIds.has(e.accountId));
    }
    if (q) {
      filtered = filtered.filter(e => emailMatchesSearch(e, q));
    }
    return [...filtered].sort((a, b) => b.time - a.time);
  }, [emails, accountId, disabledAccountIds, searchQuery]);

  // The stream and sweep filters read the streams, the sweep queue, the active
  // rules and the exemption set, so the list re-filters when any of those change.
  const displayEmails = useMemo(() => {
    if (globalFilters.size === 0) return columnEmails;
    return columnEmails.filter(email => {
      if (globalFilters.has('no-stream') && streamTags(email)) return false;
      if (globalFilters.has('no-sweep') && sweepRuleMatch(email)) return false;
      if (globalFilters.has('unread') && !email.unread) return false;
      if (globalFilters.has('read') && email.unread) return false;
      if (globalFilters.has('starred') && !email.starred) return false;
      return true;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnEmails, globalFilters, columns, sweepEmails, sweepRules, exemptedEmailIds]);

  // Register column in the column registry for keyboard navigation
  useEffect(() => {
    registerColumn({
      columnId: registryColumnId,
      accountId,
      emailIds: displayEmails.map(e => e.id),
      order: columnOrder,
    });
    return () => unregisterColumn(registryColumnId);
  }, [displayEmails, registryColumnId, accountId, columnOrder]);

  const account = accountId ? accounts.find(a => a.id === accountId) : null;
  const accent = account ? account.color : '#3b82f6';
  const handleRefresh = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const targets = accountId ? [accountId] : accounts.map(a => a.id);
      await Promise.all(
        targets.map(id => syncMutation.mutateAsync({ accountId: id, mode: 'incremental' }))
      );
    } catch (e) {
      console.error('Refresh sync error:', e);
    } finally {
      setSyncing(false);
    }
  }, [syncing, accountId, accounts, syncMutation]);

  const icon = account
    ? <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: account.color }} />
    : <button className={`column-refresh-btn${syncing ? ' syncing' : ''}`} onClick={handleRefresh} title="Refresh all inboxes"><Icons.Refresh /></button>;
  const name = account ? account.name : 'All Inboxes';
  const unreadCount = useMemo(() => displayEmails.filter(e => e.unread).length, [displayEmails]);
  const layoutKey = accountId ? 'inbox-' + accountId : 'inbox-all';
  const sweeps = sweepsById(sweepEmails);

  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollKey = accountId || 'all-inboxes';
  const highlightIndex = useMemo(
    () => (highlightedId ? displayEmails.findIndex(e => e.id === highlightedId) : -1),
    [displayEmails, highlightedId]
  );
  const { shown, hasMore, grow } = useRenderWindow(scrollKey, displayEmails.length, highlightIndex);

  useLayoutEffect(() => {
    const saved = scrollPositions.get(scrollKey);
    if (saved && scrollRef.current) {
      scrollRef.current.scrollTop = saved;
    }
  }, [scrollKey]);

  // When the column isn't scrollable (filter narrows results), draw more of the
  // loaded emails, then fetch more pages.
  // Skip when search is active — fetching more pages won't help since search filters them.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || searchQuery) return;
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
  }, [_hasNextPage, _isFetchingNextPage, _fetchNextPage, searchQuery, hasMore, grow]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    scrollPositions.set(scrollKey, el.scrollTop);
    const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    // Draw more cards a screen early so scrolling never reaches the end of what's drawn.
    if (hasMore && fromBottom <= el.clientHeight) grow();
    else if (!hasMore && fromBottom <= 200 && _hasNextPage && !_isFetchingNextPage) _fetchNextPage?.();
  }, [scrollKey, _fetchNextPage, _hasNextPage, _isFetchingNextPage, hasMore, grow]);

  return (
    <motion.div
      key={`${layoutKey}-${_viewSwitchKey}`}
      className="column"
      style={{ '--column-accent': accent } as React.CSSProperties}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3, ease: 'easeOut', delay: columnOrder * 0.12 }}
    >
      <div className="column-header" style={{ borderTopColor: 'transparent' }}>
        <span className="column-icon">{icon}</span>
        <span className="column-name">
          {name}
          {account && (
            <span style={{ display: 'block', fontSize: '0.7rem', opacity: 0.6, fontWeight: 400 }}>
              {account.email}
            </span>
          )}
        </span>
        <span className="column-count">{unreadCount > 0 ? unreadCount : displayEmails.length}</span>
      </div>
      <div className="column-emails" ref={scrollRef} onScroll={handleScroll}>
        <AnimatePresence initial={false}>
          {displayEmails.slice(0, shown).map(email => (
            <EmailCard
              key={email.id}
              email={email}
              accent={accent}
              columnId={accountId || 'all-inboxes'}
              sourceAccountId={accountId || undefined}
              sweep={sweeps.get(email.id)}
              matchedSweepRule={sweepRuleMatch(email) ?? undefined}
              matchedStreams={streamTags(email)}
            />
          ))}
        </AnimatePresence>
        {_isFetchingNextPage && !searchQuery && displayEmails.length > 0 && <div className="column-load-more" />}
      </div>
    </motion.div>
  );
});
