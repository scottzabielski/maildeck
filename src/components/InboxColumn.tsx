import { useMemo, useCallback, useRef, useEffect, useLayoutEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { EmailCard } from './EmailCard.tsx';
import { useStore } from '../store/index.ts';
import { emailMatchesCriteria } from '../lib/emailFilter.ts';
import { scrollPositions } from '../lib/scrollPositions.ts';
import { registerColumn, unregisterColumn } from '../lib/columnRegistry.ts';

interface InboxColumnProps {
  accountId: string | null;
  columnOrder?: number;
}

export function InboxColumn({ accountId, columnOrder = 0 }: InboxColumnProps) {
  const { emails, accounts, disabledAccountIds, selectedEmail, highlightedEmail, multiSelectedIds, sweepEmails, columns, sweepRules, searchQuery, globalFilters, _fetchNextPage, _hasNextPage, _isFetchingNextPage, _viewSwitchKey } = useStore();
  const selectedEmailId = selectedEmail ? selectedEmail.emailId : null;
  const highlightedEmailId = highlightedEmail ? highlightedEmail.emailId : null;

  const columnEmails = useMemo(() => {
    const q = searchQuery.toLowerCase();
    let filtered;
    if (accountId) {
      filtered = emails.filter(e => e.accountId === accountId && !disabledAccountIds.has(e.accountId));
    } else {
      filtered = emails.filter(e => !disabledAccountIds.has(e.accountId));
    }
    if (q) {
      filtered = filtered.filter(e =>
        e.sender.toLowerCase().includes(q)
        || (e.senderEmail || '').toLowerCase().includes(q)
        || e.subject.toLowerCase().includes(q)
        || e.snippet.toLowerCase().includes(q)
      );
    }
    return [...filtered].sort((a, b) => b.time - a.time);
  }, [emails, accountId, disabledAccountIds, searchQuery]);

  const sweepLookup = useMemo(() => {
    const map = new Map<string, { seconds: number; action: string }>();
    for (const s of sweepEmails) {
      map.set(s.id, { seconds: s.sweepSeconds, action: s.action || 'archive' });
    }
    return map;
  }, [sweepEmails]);

  const enabledStreams = useMemo(
    () => columns.filter(c => c.enabled !== false && c.criteria.length > 0),
    [columns]
  );

  const enabledSweepRules = useMemo(
    () => sweepRules.filter(r => r.enabled),
    [sweepRules]
  );

  // Match each displayed email against enabled sweep rules → { action } for the soonest rule
  const sweepRuleMatchLookup = useMemo(() => {
    const map = new Map<string, { action: string }>();
    if (enabledSweepRules.length === 0) return map;
    for (const email of columnEmails) {
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
  }, [columnEmails, enabledSweepRules]);

  const matchedStreamsMap = useMemo(() => {
    const map = new Map<string, Array<{ id: string; accent: string }>>();
    for (const email of columnEmails) {
      const matched: Array<{ id: string; accent: string }> = [];
      for (const col of enabledStreams) {
        if (emailMatchesCriteria(email, col.criteria, col.criteriaLogic)) {
          matched.push({ id: col.id, accent: col.accent });
        }
      }
      if (matched.length > 0) {
        map.set(email.id, matched);
      }
    }
    return map;
  }, [columnEmails, enabledStreams]);

  const displayEmails = useMemo(() => {
    if (globalFilters.size === 0) return columnEmails;

    return columnEmails.filter(email => {
      if (globalFilters.has('no-stream') && matchedStreamsMap.has(email.id)) return false;
      if (globalFilters.has('no-sweep') && enabledSweepRules.some(rule =>
        emailMatchesCriteria(email, rule.criteria, rule.criteriaLogic)
      )) return false;
      if (globalFilters.has('unread') && !email.unread) return false;
      if (globalFilters.has('read') && email.unread) return false;
      if (globalFilters.has('starred') && !email.starred) return false;
      return true;
    });
  }, [columnEmails, globalFilters, matchedStreamsMap, enabledSweepRules]);

  // Register column in the column registry for keyboard navigation
  const registryColumnId = accountId || 'all-inboxes';
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
  const icon = account
    ? <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: account.color }} />
    : '📥';
  const name = account ? account.name : 'All Inboxes';
  const unreadCount = displayEmails.filter(e => e.unread).length;
  const layoutKey = accountId ? 'inbox-' + accountId : 'inbox-all';

  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollKey = accountId || 'all-inboxes';

  useLayoutEffect(() => {
    const saved = scrollPositions.get(scrollKey);
    if (saved && scrollRef.current) {
      scrollRef.current.scrollTop = saved;
    }
  }, [scrollKey]);

  // Auto-fetch more pages if the column isn't scrollable (filter narrows results).
  // Skip when search is active — fetching more pages won't help since search filters them.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !_hasNextPage || !_fetchNextPage || searchQuery) return;
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
  }, [_hasNextPage, _isFetchingNextPage, _fetchNextPage, searchQuery]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    scrollPositions.set(scrollKey, el.scrollTop);
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
      if (_hasNextPage && !_isFetchingNextPage) _fetchNextPage?.();
    }
  }, [scrollKey, _fetchNextPage, _hasNextPage, _isFetchingNextPage]);

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
          {displayEmails.map(email => (
            <EmailCard
              key={email.id}
              email={email}
              accent={accent}
              accounts={accounts}
              columnId={accountId || 'all-inboxes'}
              sourceAccountId={accountId || undefined}
              selectedEmailId={selectedEmailId}
              highlightedEmailId={highlightedEmailId}
              multiSelectedIds={multiSelectedIds}
              sweepSeconds={sweepLookup.get(email.id)?.seconds}
              sweepAction={sweepLookup.get(email.id)?.action}
              matchedSweepRule={sweepRuleMatchLookup.get(email.id)}
              matchedStreams={matchedStreamsMap.get(email.id)}
            />
          ))}
        </AnimatePresence>
        {_isFetchingNextPage && !searchQuery && <div className="column-load-more" />}
      </div>
    </motion.div>
  );
}
