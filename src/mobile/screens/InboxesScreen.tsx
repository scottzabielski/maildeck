import { useMemo, useRef, useCallback, useLayoutEffect, useEffect, useState } from 'react';
import { Icons } from '../../components/ui/Icons.tsx';
import { useStore } from '../../store/index.ts';
import { emailMatchesCriteria, beginCriteriaMatch, endCriteriaMatch } from '../../lib/emailFilter.ts';
import { scrollPositions } from '../../lib/scrollPositions.ts';
import { useSyncAccount } from '../../hooks/useEmails.ts';
import { MobileTopBar } from '../components/MobileTopBar.tsx';
import { MobileSegmentedPicker, type SegmentedPickerOption } from '../components/MobileSegmentedPicker.tsx';
import { MobileEmailListItem } from '../components/MobileEmailListItem.tsx';
import { MobileSearchOverlay } from '../components/MobileSearchOverlay.tsx';
import { MobileFiltersSheet } from '../components/MobileFiltersSheet.tsx';
import { MobileMultiSelectBar } from '../components/MobileMultiSelectBar.tsx';
import { usePullToRefresh } from '../hooks/usePullToRefresh.ts';
import type { MobileNav } from '../navTypes.ts';

interface InboxesScreenProps {
  nav: MobileNav;
}

export function InboxesScreen({ nav: _nav }: InboxesScreenProps) {
  const emails = useStore(s => s.emails);
  const accounts = useStore(s => s.accounts);
  const disabledAccountIds = useStore(s => s.disabledAccountIds);
  const sweepEmails = useStore(s => s.sweepEmails);
  const columns = useStore(s => s.columns);
  const sweepRules = useStore(s => s.sweepRules);
  const searchQuery = useStore(s => s.searchQuery);
  const globalFilters = useStore(s => s.globalFilters);
  const _fetchNextPage = useStore(s => s._fetchNextPage);
  const _hasNextPage = useStore(s => s._hasNextPage);
  const _isFetchingNextPage = useStore(s => s._isFetchingNextPage);
  const toggleAccount = useStore(s => s.toggleAccount);
  const toggleSettings = useStore(s => s.toggleSettings);

  const enabledAccounts = useMemo(
    () => accounts.filter(a => !disabledAccountIds.has(a.id)),
    [accounts, disabledAccountIds],
  );

  // Picker is now a multi-toggle: list always shows the union of enabled
  // accounts. No single-account focused view, no mobileInboxSelected.
  const accent = enabledAccounts.length === 1 ? enabledAccounts[0].color : '#3b82f6';

  // === Filter logic ===
  const columnEmails = useMemo(() => {
    const q = searchQuery.toLowerCase();
    let filtered = emails.filter(e => !disabledAccountIds.has(e.accountId));
    if (q) {
      filtered = filtered.filter(e =>
        e.sender.toLowerCase().includes(q)
        || (e.senderEmail || '').toLowerCase().includes(q)
        || e.subject.toLowerCase().includes(q)
        || e.snippet.toLowerCase().includes(q)
      );
    }
    return [...filtered].sort((a, b) => b.time - a.time);
  }, [emails, disabledAccountIds, searchQuery]);

  const sweepLookup = useMemo(() => {
    const map = new Map<string, { seconds: number; action: string }>();
    for (const s of sweepEmails) {
      map.set(s.id, { seconds: s.sweepSeconds, action: s.action || 'archive' });
    }
    return map;
  }, [sweepEmails]);

  const enabledStreams = useMemo(
    () => columns.filter(c => c.enabled !== false && c.criteria.length > 0),
    [columns],
  );

  const enabledSweepRules = useMemo(
    () => sweepRules.filter(r => r.enabled),
    [sweepRules],
  );

  const sweepRuleMatchLookup = useMemo(() => {
    const map = new Map<string, { action: string; delayHours: number }>();
    if (enabledSweepRules.length === 0) return map;
    beginCriteriaMatch();
    for (const email of columnEmails) {
      let bestRule: { action: string; delayHours: number } | null = null;
      for (const rule of enabledSweepRules) {
        if (emailMatchesCriteria(email, rule.criteria, rule.criteriaLogic)) {
          if (!bestRule || rule.delayHours < bestRule.delayHours) {
            bestRule = { action: rule.action, delayHours: rule.delayHours };
          }
        }
      }
      if (bestRule) map.set(email.id, bestRule);
    }
    endCriteriaMatch();
    return map;
  }, [columnEmails, enabledSweepRules]);

  const matchedStreamsMap = useMemo(() => {
    const map = new Map<string, Array<{ id: string; accent: string }>>();
    beginCriteriaMatch();
    for (const email of columnEmails) {
      const matched: Array<{ id: string; accent: string }> = [];
      for (const col of enabledStreams) {
        if (emailMatchesCriteria(email, col.criteria, col.criteriaLogic)) {
          matched.push({ id: col.id, accent: col.accent });
        }
      }
      if (matched.length > 0) map.set(email.id, matched);
    }
    endCriteriaMatch();
    return map;
  }, [columnEmails, enabledStreams]);

  const displayEmails = useMemo(() => {
    if (globalFilters.size === 0) return columnEmails;
    const needsSweepCheck = globalFilters.has('no-sweep');
    if (needsSweepCheck) beginCriteriaMatch();
    const result = columnEmails.filter(email => {
      if (globalFilters.has('no-stream') && matchedStreamsMap.has(email.id)) return false;
      if (needsSweepCheck && enabledSweepRules.some(rule =>
        emailMatchesCriteria(email, rule.criteria, rule.criteriaLogic)
      )) return false;
      if (globalFilters.has('unread') && !email.unread) return false;
      if (globalFilters.has('read') && email.unread) return false;
      if (globalFilters.has('starred') && !email.starred) return false;
      return true;
    });
    if (needsSweepCheck) endCriteriaMatch();
    return result;
  }, [columnEmails, globalFilters, matchedStreamsMap, enabledSweepRules]);

  // === Segmented picker options ===
  // Picker is a multi-toggle. "All" mass-toggles every account; per-account
  // chips toggle just that one. Disabled chips are shown but visually dimmed
  // (via the existing .mobile-picker-chip non-active state).
  const allEnabled = disabledAccountIds.size === 0 && accounts.length > 0;
  const pickerOptions: SegmentedPickerOption[] = useMemo(() => {
    const allCount = emails.filter(e => !disabledAccountIds.has(e.accountId) && e.unread).length;
    const opts: SegmentedPickerOption[] = [
      { id: '__all__', label: 'All', count: allCount },
    ];
    for (const a of accounts) {
      const unread = emails.filter(e => e.accountId === a.id && e.unread).length;
      opts.push({ id: a.id, label: a.name, color: a.color, count: unread });
    }
    return opts;
  }, [emails, accounts, disabledAccountIds]);

  // Render chips' active state: All is active when nothing's disabled; each
  // account chip is active when its account is enabled.
  const activeIds = useMemo(() => {
    const ids = new Set<string>();
    if (allEnabled) ids.add('__all__');
    for (const a of accounts) if (!disabledAccountIds.has(a.id)) ids.add(a.id);
    return ids;
  }, [accounts, disabledAccountIds, allEnabled]);

  const handlePickerSelect = (id: string) => {
    if (id === '__all__') {
      // Mass toggle: if anything's disabled, enable all; else disable all.
      if (disabledAccountIds.size === 0) {
        useStore.setState({ disabledAccountIds: new Set(accounts.map(a => a.id)) });
      } else {
        useStore.setState({ disabledAccountIds: new Set() });
      }
    } else {
      toggleAccount(id);
    }
  };

  // === Scroll position persistence ===
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollKey = 'mobile-inbox-list';

  useLayoutEffect(() => {
    const saved = scrollPositions.get(scrollKey);
    if (saved && scrollRef.current) {
      scrollRef.current.scrollTop = saved;
    }
  }, [scrollKey]);

  // Auto-fetch more pages if the list isn't scrollable (filter narrows results)
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

  const syncMutation = useSyncAccount();
  const handleRefresh = useCallback(async () => {
    const targets = enabledAccounts.map(a => a.id);
    if (targets.length === 0) return;
    try {
      await Promise.all(targets.map(id => syncMutation.mutateAsync({ accountId: id, mode: 'incremental' })));
    } catch (e) {
      // Mock mode raises; surface in console but don't crash the gesture.
      // eslint-disable-next-line no-console
      console.warn('Pull-to-refresh sync failed:', e);
    }
  }, [enabledAccounts, syncMutation]);

  const { pullDistance, refreshing, armed } = usePullToRefresh({
    containerRef: scrollRef,
    onRefresh: handleRefresh,
  });

  const [searchOpen, setSearchOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const multiCount = useStore(s => s.multiSelectedIds.size);

  const filterActive = globalFilters.size > 0;

  return (
    <div className="mobile-screen">
      {multiCount > 0 ? (
        <MobileMultiSelectBar visibleEmailIds={displayEmails.map(e => e.id)} />
      ) : searchOpen ? (
        <MobileSearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
      ) : (
      <>
      <MobileTopBar
        title={
          enabledAccounts.length === 0
            ? 'Inboxes'
            : enabledAccounts.length === 1
              ? enabledAccounts[0].name
              : disabledAccountIds.size === 0
                ? 'All Inboxes'
                : `${enabledAccounts.length} Inboxes`
        }
        rightSlot={
          <>
            <button
              type="button"
              className="mobile-topbar-icon-btn"
              onClick={() => setSearchOpen(true)}
              aria-label="Search"
            >
              <Icons.Search />
            </button>
            <button
              type="button"
              className={`mobile-topbar-icon-btn${filterActive ? ' active-accent' : ''}`}
              onClick={() => setFiltersOpen(true)}
              aria-label="Filter"
            >
              <Icons.FilterLines />
            </button>
            <button
              type="button"
              className="mobile-topbar-icon-btn"
              onClick={toggleSettings}
              aria-label="Settings"
            >
              <Icons.Settings />
            </button>
          </>
        }
      />
      <MobileSegmentedPicker
        options={pickerOptions}
        activeIds={activeIds}
        onSelect={handlePickerSelect}
      />
      </>
      )}
      <MobileFiltersSheet open={filtersOpen} onClose={() => setFiltersOpen(false)} />
      <div className="mobile-list-wrap">
        <PullIndicator pullDistance={pullDistance} refreshing={refreshing} armed={armed} />
        <div className="mobile-list" ref={scrollRef} onScroll={handleScroll} style={{
          // While pulling or refreshing, push the list down so the indicator
          // has its own band above the first row instead of sitting over it.
          transform: refreshing ? 'translateY(44px)' : pullDistance > 0 ? `translateY(${pullDistance}px)` : undefined,
          transition: pullDistance === 0 && !refreshing ? 'transform 0.2s ease-out' : 'none',
        }}>
          {displayEmails.length === 0 ? (
            <div className="mobile-empty">No emails to show.</div>
          ) : (
            displayEmails.map(email => (
              <MobileEmailListItem
                key={email.id}
                email={email}
                accent={accent}
                accounts={accounts}
                columnId={'all-inboxes'}
                sweepSeconds={sweepLookup.get(email.id)?.seconds}
                sweepAction={sweepLookup.get(email.id)?.action}
                matchedSweepRule={sweepRuleMatchLookup.get(email.id)}
                matchedStreams={matchedStreamsMap.get(email.id)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function PullIndicator({ pullDistance, refreshing, armed }: { pullDistance: number; refreshing: boolean; armed: boolean }) {
  if (!refreshing && pullDistance === 0) return null;
  const opacity = refreshing ? 1 : Math.min(1, pullDistance / 60);
  const rotation = refreshing ? 0 : Math.min(180, pullDistance * 3);
  return (
    <div className="mobile-pull-indicator" style={{ opacity, top: refreshing ? 18 : Math.max(8, pullDistance / 2 - 12) }}>
      <span className={`mobile-pull-spinner${refreshing ? ' spinning' : ''}${armed ? ' armed' : ''}`} style={{ transform: refreshing ? undefined : `rotate(${rotation}deg)` }} />
    </div>
  );
}

