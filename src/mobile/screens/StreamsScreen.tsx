import { useMemo, useRef, useCallback, useLayoutEffect, useEffect, useState } from 'react';
import { Icons } from '../../components/ui/Icons.tsx';
import { useStore } from '../../store/index.ts';
import { emailMatchesCriteria, beginCriteriaMatch, endCriteriaMatch } from '../../lib/emailFilter.ts';
import { scrollPositions } from '../../lib/scrollPositions.ts';
import { MobileTopBar } from '../components/MobileTopBar.tsx';
import { MobileSegmentedPicker, type SegmentedPickerOption } from '../components/MobileSegmentedPicker.tsx';
import { MobileEmailListItem } from '../components/MobileEmailListItem.tsx';
import { MobileSweepListItem } from '../components/MobileSweepListItem.tsx';
import { MobileSearchOverlay } from '../components/MobileSearchOverlay.tsx';
import { MobileFiltersSheet } from '../components/MobileFiltersSheet.tsx';
import { MobileMultiSelectBar } from '../components/MobileMultiSelectBar.tsx';
import { usePullToRefresh } from '../hooks/usePullToRefresh.ts';
import { useSyncAccount } from '../../hooks/useEmails.ts';
import type { MobileNav } from '../navTypes.ts';

const SWEEP_ID = '__sweep__';

interface StreamsScreenProps {
  nav: MobileNav;
}

export function StreamsScreen({ nav: _nav }: StreamsScreenProps) {
  const emails = useStore(s => s.emails);
  const accounts = useStore(s => s.accounts);
  const disabledAccountIds = useStore(s => s.disabledAccountIds);
  const allColumns = useStore(s => s.columns);
  const sweepEmails = useStore(s => s.sweepEmails);
  const sweepRules = useStore(s => s.sweepRules);
  const searchQuery = useStore(s => s.searchQuery);
  const globalFilters = useStore(s => s.globalFilters);
  const _fetchNextPage = useStore(s => s._fetchNextPage);
  const _hasNextPage = useStore(s => s._hasNextPage);
  const _isFetchingNextPage = useStore(s => s._isFetchingNextPage);
  const mobileStreamSelected = useStore(s => s.mobileStreamSelected);
  const setMobileStreamSelected = useStore(s => s.setMobileStreamSelected);
  const toggleSettings = useStore(s => s.toggleSettings);
  const openNewColumnEditor = useStore(s => s.openNewColumnEditor);

  const enabledColumns = useMemo(
    () => allColumns.filter(c => c.enabled !== false),
    [allColumns],
  );

  // Default selection: first enabled stream, then Sweep
  useEffect(() => {
    if (mobileStreamSelected == null) {
      const first = enabledColumns[0];
      if (first) setMobileStreamSelected(first.id);
      else setMobileStreamSelected(SWEEP_ID);
      return;
    }
    if (mobileStreamSelected !== SWEEP_ID && !enabledColumns.some(c => c.id === mobileStreamSelected)) {
      const first = enabledColumns[0];
      setMobileStreamSelected(first ? first.id : SWEEP_ID);
    }
  }, [mobileStreamSelected, enabledColumns, setMobileStreamSelected]);

  const selectedColumn = mobileStreamSelected && mobileStreamSelected !== SWEEP_ID
    ? enabledColumns.find(c => c.id === mobileStreamSelected) ?? null
    : null;
  const isSweep = mobileStreamSelected === SWEEP_ID;

  const enabledSweepRules = useMemo(
    () => sweepRules.filter(r => r.enabled),
    [sweepRules],
  );

  // === Stream filter logic (mirrors src/components/Column.tsx) ===
  const columnEmails = useMemo(() => {
    if (!selectedColumn) return [] as typeof emails;
    beginCriteriaMatch();
    const result = emails.filter(e => {
      if (disabledAccountIds.has(e.accountId)) return false;
      if (e.columnId) return e.columnId === selectedColumn.id;
      if (selectedColumn.criteria.length > 0) {
        return emailMatchesCriteria(e, selectedColumn.criteria, selectedColumn.criteriaLogic);
      }
      return false;
    });
    endCriteriaMatch();
    return result;
  }, [emails, selectedColumn, disabledAccountIds]);

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
    if (globalFilters.has('no-sweep')) {
      beginCriteriaMatch();
      filtered = filtered.filter(e =>
        !enabledSweepRules.some(rule => emailMatchesCriteria(e, rule.criteria, rule.criteriaLogic))
      );
      endCriteriaMatch();
    }
    if (globalFilters.has('unread')) filtered = filtered.filter(e => e.unread);
    if (globalFilters.has('read')) filtered = filtered.filter(e => !e.unread);
    if (globalFilters.has('starred')) filtered = filtered.filter(e => e.starred);
    return filtered;
  }, [columnEmails, searchQuery, globalFilters, enabledSweepRules]);

  const sweepLookup = useMemo(() => {
    const map = new Map<string, { seconds: number; action: string }>();
    for (const s of sweepEmails) map.set(s.id, { seconds: s.sweepSeconds, action: s.action || 'archive' });
    return map;
  }, [sweepEmails]);

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

  // === Sweep view ===
  const filteredSweepEmails = useMemo(
    () => sweepEmails.filter(e => !disabledAccountIds.has(e.accountId)),
    [sweepEmails, disabledAccountIds],
  );

  // === Picker options ===
  const pickerOptions: SegmentedPickerOption[] = useMemo(() => {
    const opts: SegmentedPickerOption[] = [
      { id: SWEEP_ID, label: '🧹 Sweep', count: filteredSweepEmails.length },
    ];
    for (const col of enabledColumns) {
      const unread = emails.filter(e => {
        if (disabledAccountIds.has(e.accountId)) return false;
        if (e.columnId) return e.columnId === col.id && e.unread;
        if (col.criteria.length > 0) return emailMatchesCriteria(e, col.criteria, col.criteriaLogic) && e.unread;
        return false;
      }).length;
      opts.push({ id: col.id, label: col.name, color: col.accent, count: unread });
    }
    return opts;
  }, [enabledColumns, emails, disabledAccountIds, filteredSweepEmails.length]);

  const selectedSegmentId = mobileStreamSelected ?? SWEEP_ID;

  // === Scroll position persistence ===
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollKey = `mobile-stream-${selectedSegmentId}`;

  useLayoutEffect(() => {
    const saved = scrollPositions.get(scrollKey);
    if (saved && scrollRef.current) {
      scrollRef.current.scrollTop = saved;
    }
  }, [scrollKey]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !_hasNextPage || !_fetchNextPage || globalFilters.size > 0 || searchQuery || displayEmails.length === 0) return;
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
  }, [_hasNextPage, _isFetchingNextPage, _fetchNextPage, globalFilters, searchQuery, displayEmails.length]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    scrollPositions.set(scrollKey, el.scrollTop);
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
      if (_hasNextPage && !_isFetchingNextPage) _fetchNextPage?.();
    }
  }, [scrollKey, _fetchNextPage, _hasNextPage, _isFetchingNextPage]);

  const syncMutation = useSyncAccount();
  const handleRefresh = useCallback(async () => {
    const targets = accounts.filter(a => !disabledAccountIds.has(a.id)).map(a => a.id);
    if (targets.length === 0) return;
    try {
      await Promise.all(targets.map(id => syncMutation.mutateAsync({ accountId: id, mode: 'incremental' })));
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('Pull-to-refresh sync failed:', e);
    }
  }, [accounts, disabledAccountIds, syncMutation]);

  const { pullDistance, refreshing, armed } = usePullToRefresh({
    containerRef: scrollRef,
    onRefresh: handleRefresh,
  });

  const title = isSweep ? 'Sweep' : selectedColumn ? selectedColumn.name : 'Streams';

  const [searchOpen, setSearchOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterActive = globalFilters.size > 0;
  const multiCount = useStore(s => s.multiSelectedIds.size);

  // Visible IDs for "Select all visible" affordance in multi-select bar
  const visibleIds = isSweep
    ? filteredSweepEmails.map(e => e.id)
    : displayEmails.map(e => e.id);

  return (
    <div className="mobile-screen">
      {multiCount > 0 ? (
        <MobileMultiSelectBar visibleEmailIds={visibleIds} />
      ) : searchOpen ? (
        <MobileSearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
      ) : (
      <>
      <MobileTopBar
        title={title}
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
        selectedId={selectedSegmentId}
        onSelect={(id) => setMobileStreamSelected(id)}
        trailing={
          <button
            type="button"
            className="mobile-picker-chip-add"
            onClick={openNewColumnEditor}
            aria-label="New stream"
          >
            <Icons.Plus />
          </button>
        }
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
          {isSweep ? (
            filteredSweepEmails.length === 0 ? (
              <div className="mobile-empty">Nothing scheduled for sweep.</div>
            ) : (
              filteredSweepEmails.map(email => (
                <MobileSweepListItem key={email.id} email={email} />
              ))
            )
          ) : !selectedColumn ? (
            <div className="mobile-empty">Pick a stream above to start.</div>
          ) : displayEmails.length === 0 ? (
            <div className="mobile-empty">No emails match this stream.</div>
          ) : (
            displayEmails.map(email => (
              <MobileEmailListItem
                key={email.id}
                email={email}
                accent={selectedColumn.accent}
                accounts={accounts}
                columnId={selectedColumn.id}
                sweepSeconds={sweepLookup.get(email.id)?.seconds}
                sweepAction={sweepLookup.get(email.id)?.action}
                matchedSweepRule={sweepRuleMatchLookup.get(email.id)}
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
