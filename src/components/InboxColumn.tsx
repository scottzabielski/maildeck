import { useMemo, useCallback, useState, useRef, useEffect, useLayoutEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { EmailCard } from './EmailCard.tsx';
import { Icons } from './ui/Icons.tsx';
import { useStore } from '../store/index.ts';
import { emailMatchesCriteria } from '../lib/emailFilter.ts';
import { scrollPositions, filterModes } from '../lib/scrollPositions.ts';

type FilterMode = 'none' | 'no-stream' | 'no-sweep' | 'neither';

interface InboxColumnProps {
  accountId: string | null;
}

export function InboxColumn({ accountId }: InboxColumnProps) {
  const { emails, accounts, disabledAccountIds, selectedEmail, sweepEmails, columns, sweepRules, searchQuery, globalInboxFilter, _fetchNextPage, _hasNextPage, _isFetchingNextPage } = useStore();
  const selectedEmailId = selectedEmail ? selectedEmail.emailId : null;

  const filterKey = accountId || 'all-inboxes';
  const [filterMode, setFilterModeRaw] = useState<FilterMode>(
    () => (filterModes.get(filterKey) as FilterMode) || 'none'
  );
  const setFilterMode = useCallback((update: FilterMode | ((prev: FilterMode) => FilterMode)) => {
    setFilterModeRaw(prev => {
      const next = typeof update === 'function' ? update(prev) : update;
      filterModes.set(filterKey, next);
      return next;
    });
  }, [filterKey]);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const filterBtnRef = useRef<HTMLButtonElement>(null);
  const filterMenuRef = useRef<HTMLDivElement>(null);

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

  // Per-column filter overrides global; if local is 'none', fall back to global
  const effectiveFilter = filterMode !== 'none' ? filterMode : globalInboxFilter;

  const displayEmails = useMemo(() => {
    if (effectiveFilter === 'none') return columnEmails;

    return columnEmails.filter(email => {
      const inStream = matchedStreamsMap.has(email.id);
      const hasSweep = enabledSweepRules.some(rule =>
        emailMatchesCriteria(email, rule.criteria, rule.criteriaLogic)
      );

      if (effectiveFilter === 'no-stream') return !inStream;
      if (effectiveFilter === 'no-sweep') return !hasSweep;
      // 'neither'
      return !inStream && !hasSweep;
    });
  }, [columnEmails, effectiveFilter, matchedStreamsMap, enabledSweepRules]);

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
  // Uses an interval to keep checking since each page load may not add enough filtered matches.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !_hasNextPage || !_fetchNextPage) return;
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
  }, [_hasNextPage, _isFetchingNextPage, _fetchNextPage]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    scrollPositions.set(scrollKey, el.scrollTop);
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
      if (_hasNextPage && !_isFetchingNextPage) _fetchNextPage?.();
    }
  }, [scrollKey, _fetchNextPage, _hasNextPage, _isFetchingNextPage]);

  const handleFilterClick = useCallback(() => {
    if (filterMenuOpen) {
      setFilterMenuOpen(false);
      return;
    }
    setFilterMode(prev => prev === 'none' ? 'neither' : 'none');
  }, [filterMenuOpen]);

  const handleFilterMouseDown = useCallback(() => {
    longPressTimer.current = setTimeout(() => {
      setFilterMenuOpen(true);
    }, 500);
  }, []);

  const handleFilterMouseUp = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const handleFilterMouseLeave = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const handleSelectFilterMode = useCallback((mode: FilterMode) => {
    setFilterMode(prev => prev === mode ? 'none' : mode);
    setFilterMenuOpen(false);
  }, []);

  // Close menu on outside click
  useEffect(() => {
    if (!filterMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (
        filterMenuRef.current && !filterMenuRef.current.contains(e.target as Node) &&
        filterBtnRef.current && !filterBtnRef.current.contains(e.target as Node)
      ) {
        setFilterMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [filterMenuOpen]);

  const filterActive = effectiveFilter !== 'none';

  return (
    <motion.div
      className="column"
      style={{ '--column-accent': accent } as React.CSSProperties}
      layoutId={layoutKey}
      layout
      transition={{ layout: { duration: 0.4, ease: [0.4, 0, 0.2, 1] } }}
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
        <div style={{ position: 'relative', marginLeft: 'auto' }}>
          <button
            ref={filterBtnRef}
            className={`inbox-filter-btn${filterActive ? ' active' : ''}`}
            onClick={handleFilterClick}
            onMouseDown={handleFilterMouseDown}
            onMouseUp={handleFilterMouseUp}
            onMouseLeave={handleFilterMouseLeave}
            title={filterActive ? `Filter: ${effectiveFilter}` : 'Filter uncategorized'}
          >
            <Icons.FilterLines />
          </button>
          {filterMenuOpen && (
            <div ref={filterMenuRef} className="inbox-filter-menu">
              <button
                className={`inbox-filter-menu-item${filterMode === 'no-stream' ? ' active' : ''}`}
                onClick={() => handleSelectFilterMode('no-stream')}
              >
                No stream
              </button>
              <button
                className={`inbox-filter-menu-item${filterMode === 'no-sweep' ? ' active' : ''}`}
                onClick={() => handleSelectFilterMode('no-sweep')}
              >
                No sweep rule
              </button>
              <button
                className={`inbox-filter-menu-item${filterMode === 'neither' ? ' active' : ''}`}
                onClick={() => handleSelectFilterMode('neither')}
              >
                Neither
              </button>
            </div>
          )}
        </div>
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
              sweepSeconds={sweepLookup.get(email.id)?.seconds}
              sweepAction={sweepLookup.get(email.id)?.action}
              matchedStreams={matchedStreamsMap.get(email.id)}
            />
          ))}
        </AnimatePresence>
        {_isFetchingNextPage && <div className="column-load-more" />}
      </div>
    </motion.div>
  );
}
