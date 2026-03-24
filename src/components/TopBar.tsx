import { useRef, useState, useCallback, useEffect } from 'react';
import { Reorder } from 'framer-motion';
import { Icons } from './ui/Icons.tsx';
import { useStore } from '../store/index.ts';
import { useSyncAccount } from '../hooks/useEmails.ts';

function VolumeControl({ volume, onChange }: { volume: number; onChange: (v: number) => void }) {
  const prevVolumeRef = useRef(0.6);
  const isMuted = volume === 0;
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleToggle = useCallback(() => {
    if (isMuted) {
      onChange(prevVolumeRef.current || 0.6);
    } else {
      prevVolumeRef.current = volume;
      onChange(0);
    }
  }, [isMuted, volume, onChange]);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div style={{ position: 'relative' }}>
      <button
        ref={btnRef}
        className={`topbar-mute-btn${isMuted ? ' muted' : ''}`}
        onClick={() => setOpen(prev => !prev)}
        title={isMuted ? 'Unmute sound effects' : 'Mute sound effects'}
      >
        {isMuted ? <Icons.VolumeOff /> : <Icons.Volume />}
      </button>
      {open && (
        <div ref={menuRef} className="topbar-volume-menu">
          <button
            className="topbar-volume-mute-btn"
            onClick={handleToggle}
          >
            {isMuted ? <Icons.VolumeOff /> : <Icons.Volume />}
          </button>
          <input
            type="range"
            className="topbar-volume-slider"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={e => onChange(parseFloat(e.target.value))}
            title={`Volume: ${Math.round(volume * 100)}%`}
          />
          <span className="topbar-volume-label">{Math.round(volume * 100)}%</span>
        </div>
      )}
    </div>
  );
}

export function TopBar() {
  const { views, activeViewId, setActiveView, accounts, disabledAccountIds, toggleAccount, toggleSettings, reorderAccounts, searchQuery, setSearchQuery, globalFilters, toggleGlobalFilter, soundVolume, setSoundVolume, autoRotateView, autoRotateProgress, toggleAutoRotateView } = useStore();
  const draggedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const syncMutation = useSyncAccount();
  const [syncing, setSyncing] = useState(false);

  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setSearchQuery('');
      inputRef.current?.blur();
    }
  }, [setSearchQuery]);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        menuBtnRef.current && !menuBtnRef.current.contains(e.target as Node)
      ) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen]);

  const filterActive = globalFilters.size > 0;

  const handleFilterClick = useCallback(() => {
    setMenuOpen(prev => !prev);
  }, []);

  const handleRefresh = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      await Promise.all(
        accounts.map(a => syncMutation.mutateAsync({ accountId: a.id, mode: 'incremental' }))
      );
    } catch (e) {
      console.error('Refresh sync error:', e);
    } finally {
      setSyncing(false);
    }
  }, [syncing, accounts, syncMutation]);

  return (
    <div className="topbar">
      <div className="topbar-logo">
        <Icons.Mail />
        MailDeck
      </div>
      <div className="topbar-divider" />
      <div className="view-switcher">
        {views.map(v => (
          <button
            key={v.id}
            className={`view-tab ${v.id === activeViewId ? 'active' : ''}`}
            onClick={() => setActiveView(v.id)}
          >
            {v.name}
          </button>
        ))}
      </div>
      <button
        className={`topbar-refresh-btn${syncing ? ' syncing' : ''}`}
        onClick={handleRefresh}
        title="Refresh all inboxes"
        disabled={syncing}
      >
        <Icons.Refresh />
      </button>
      <div style={{ position: 'relative' }}>
        <button
          ref={menuBtnRef}
          className={`topbar-filter-btn${filterActive ? ' active' : ''}`}
          onClick={handleFilterClick}
          title={filterActive ? `Filter: ${[...globalFilters].join(', ')}` : 'Filter emails'}
        >
          <Icons.FilterLines />
        </button>
        {menuOpen && (
          <div ref={menuRef} className="topbar-filter-menu">
            <button
              className={`topbar-filter-menu-item${!filterActive ? ' active' : ''}`}
              onClick={() => { useStore.setState({ globalFilters: new Set() }); setMenuOpen(false); }}
            >
              All Messages
            </button>
            <div className="topbar-filter-menu-separator" />
            <button
              className={`topbar-filter-menu-item${globalFilters.has('unread') ? ' active' : ''}`}
              onClick={() => toggleGlobalFilter('unread')}
            >
              {globalFilters.has('unread') && <span className="filter-check">&#10003;</span>}
              Unread
            </button>
            <button
              className={`topbar-filter-menu-item${globalFilters.has('read') ? ' active' : ''}`}
              onClick={() => toggleGlobalFilter('read')}
            >
              {globalFilters.has('read') && <span className="filter-check">&#10003;</span>}
              Read
            </button>
            <button
              className={`topbar-filter-menu-item${globalFilters.has('starred') ? ' active' : ''}`}
              onClick={() => toggleGlobalFilter('starred')}
            >
              {globalFilters.has('starred') && <span className="filter-check">&#10003;</span>}
              Starred
            </button>
            <div className="topbar-filter-menu-separator" />
            <button
              className={`topbar-filter-menu-item${globalFilters.has('no-stream') ? ' active' : ''}`}
              onClick={() => toggleGlobalFilter('no-stream')}
            >
              {globalFilters.has('no-stream') && <span className="filter-check">&#10003;</span>}
              No Stream
            </button>
            <button
              className={`topbar-filter-menu-item${globalFilters.has('no-sweep') ? ' active' : ''}`}
              onClick={() => toggleGlobalFilter('no-sweep')}
            >
              {globalFilters.has('no-sweep') && <span className="filter-check">&#10003;</span>}
              No Sweep Rule
            </button>
          </div>
        )}
      </div>
      <div className={`topbar-search${searchQuery ? ' active' : ''}`}>
        <Icons.Search />
        <input
          ref={inputRef}
          type="text"
          className="topbar-search-input"
          placeholder="Search emails..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          onKeyDown={handleSearchKeyDown}
        />
        {searchQuery && (
          <button className="topbar-search-clear" onClick={() => { setSearchQuery(''); inputRef.current?.focus(); }}>
            <Icons.Close />
          </button>
        )}
      </div>
      <Reorder.Group
        as="div"
        axis="x"
        values={accounts}
        onReorder={reorderAccounts}
        className="account-badges"
      >
        {accounts.map(a => (
          <Reorder.Item
            key={a.id}
            value={a}
            as="button"
            className={`account-badge${disabledAccountIds.has(a.id) ? ' disabled' : ''}${a.syncStatus === 'error' ? ' sync-error' : ''}`}
            onClick={() => {
              if (draggedRef.current) {
                draggedRef.current = false;
                return;
              }
              toggleAccount(a.id);
            }}
            onDragStart={() => { draggedRef.current = true; }}
            whileDrag={{ scale: 1.05, boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }}
          >
            <span className="account-dot" style={{ background: a.color }} />
            {a.name}
          </Reorder.Item>
        ))}
      </Reorder.Group>
      <VolumeControl volume={soundVolume} onChange={setSoundVolume} />
      <button
        className={`topbar-rotate-btn${autoRotateView ? ' active' : ''}`}
        onClick={toggleAutoRotateView}
        title={autoRotateView ? 'Stop auto-rotate' : 'Auto-rotate views'}
      >
        {autoRotateView ? (() => {
          const C = 2 * Math.PI * 7;
          const filled = (autoRotateProgress / 60) * C;
          return (
            <svg width={16} height={16} viewBox="0 0 20 20">
              <circle cx="10" cy="10" r="7" fill="none" stroke="var(--text-secondary)" strokeWidth="2" opacity="0.2" />
              <circle cx="10" cy="10" r="7" fill="none" stroke="var(--blue)" strokeWidth="2"
                strokeDasharray={`${filled} ${C - filled}`}
                strokeDashoffset={C / 4}
                strokeLinecap="round"
                style={{ transition: 'stroke-dasharray 1s linear' }}
              />
            </svg>
          );
        })() : <Icons.Rotate />}
      </button>
      <button className="settings-btn" onClick={toggleSettings}>
        <Icons.Settings />
      </button>
    </div>
  );
}
