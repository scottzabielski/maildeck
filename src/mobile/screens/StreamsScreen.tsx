import { useMemo, useRef, useCallback, useLayoutEffect, useEffect, useState } from 'react';
import { Icons } from '../../components/ui/Icons.tsx';
import { useStore } from '../../store/index.ts';
import { emailMatchesSearch, inStream, sweepRuleMatch, sweepsById } from '../../lib/emailFilter.ts';
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
import { useRenderWindow } from '../../hooks/useRenderWindow.ts';
import type { MobileNav } from '../navTypes.ts';
import { isClaudeHeld } from '../../lib/helpers.ts';

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

  // === Stream filter logic (mirrors src/components/Column.tsx) ===
  // The sweep queue and rules are deps because a stream can use the "sweep" criterion.
  const columnEmails = useMemo(() => {
    if (!selectedColumn) return [] as typeof emails;
    return emails.filter(e => {
      if (disabledAccountIds.has(e.accountId)) return false;
      if (e.columnId) return e.columnId === selectedColumn.id;
      return selectedColumn.criteria.length > 0 && inStream(e, selectedColumn);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emails, selectedColumn, disabledAccountIds, sweepEmails, sweepRules]);

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
  }, [columnEmails, searchQuery, globalFilters, sweepRules, allColumns]);

  const sweeps = sweepsById(sweepEmails);

  // === Sweep view ===
  const filteredSweepEmails = useMemo(
    () => {
      // Sweeps held by a Claude check go after the ones counting down.
      const shown = sweepEmails.filter(e => !disabledAccountIds.has(e.accountId));
      return [...shown.filter(e => !isClaudeHeld(e)), ...shown.filter(e => isClaudeHeld(e))];
    },
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
        if (col.criteria.length > 0) return e.unread && inStream(e, col);
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
  const { shown, hasMore, grow } = useRenderWindow(scrollKey, isSweep ? filteredSweepEmails.length : displayEmails.length, -1);

  useLayoutEffect(() => {
    const saved = scrollPositions.get(scrollKey);
    if (saved && scrollRef.current) {
      scrollRef.current.scrollTop = saved;
    }
  }, [scrollKey]);

  // When the list isn't scrollable, draw more of the loaded emails, then fetch more pages.
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
    scrollPositions.set(scrollKey, el.scrollTop);
    const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    // Draw more rows a screen early so scrolling never reaches the end of what's drawn.
    if (hasMore && fromBottom <= el.clientHeight) grow();
    else if (!hasMore && fromBottom <= 200 && _hasNextPage && !_isFetchingNextPage) _fetchNextPage?.();
  }, [scrollKey, _fetchNextPage, _hasNextPage, _isFetchingNextPage, hasMore, grow]);

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
              filteredSweepEmails.slice(0, shown).map(email => (
                <MobileSweepListItem key={email.id} email={email} />
              ))
            )
          ) : !selectedColumn ? (
            <div className="mobile-empty">Pick a stream above to start.</div>
          ) : displayEmails.length === 0 ? (
            <div className="mobile-empty">No emails match this stream.</div>
          ) : (
            displayEmails.slice(0, shown).map(email => (
              <MobileEmailListItem
                key={email.id}
                email={email}
                accent={selectedColumn.accent}
                accounts={accounts}
                columnId={selectedColumn.id}
                sweep={sweeps.get(email.id)}
                matchedSweepRule={sweepRuleMatch(email) ?? undefined}
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
