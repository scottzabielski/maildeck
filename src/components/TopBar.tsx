import { useRef, useState, useCallback, useEffect } from 'react';
import { Reorder } from 'framer-motion';
import { Icons } from './ui/Icons.tsx';
import { useStore } from '../store/index.ts';

type FilterMode = 'none' | 'no-stream' | 'no-sweep' | 'neither';

export function TopBar() {
  const { views, activeViewId, setActiveView, accounts, disabledAccountIds, toggleAccount, toggleSettings, reorderAccounts, searchQuery, setSearchQuery, globalInboxFilter, setGlobalInboxFilter, globalStreamNoSweep, toggleGlobalStreamNoSweep, soundMuted, toggleSoundMuted } = useStore();
  const draggedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setSearchQuery('');
      inputRef.current?.blur();
    }
  }, [setSearchQuery]);

  const handleSelectFilter = useCallback((mode: FilterMode) => {
    setGlobalInboxFilter(globalInboxFilter === mode ? 'none' : mode);
    setMenuOpen(false);
  }, [globalInboxFilter, setGlobalInboxFilter]);

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

  const isInboxes = activeViewId === 'inboxes';
  const filterActive = isInboxes ? globalInboxFilter !== 'none' : globalStreamNoSweep;

  const handleFilterClick = useCallback(() => {
    if (isInboxes) {
      setMenuOpen(prev => !prev);
    } else {
      toggleGlobalStreamNoSweep();
    }
  }, [isInboxes, toggleGlobalStreamNoSweep]);

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
      <div style={{ position: 'relative' }}>
        <button
          ref={menuBtnRef}
          className={`topbar-filter-btn${filterActive ? ' active' : ''}`}
          onClick={handleFilterClick}
          title={isInboxes ? 'Filter all inboxes' : (globalStreamNoSweep ? 'Showing: no sweep rule' : 'Filter: no sweep rule')}
        >
          <Icons.FilterLines />
        </button>
        {isInboxes && menuOpen && (
          <div ref={menuRef} className="topbar-filter-menu">
            <button
              className={`topbar-filter-menu-item${globalInboxFilter === 'no-stream' ? ' active' : ''}`}
              onClick={() => handleSelectFilter('no-stream')}
            >
              No stream
            </button>
            <button
              className={`topbar-filter-menu-item${globalInboxFilter === 'no-sweep' ? ' active' : ''}`}
              onClick={() => handleSelectFilter('no-sweep')}
            >
              No sweep rule
            </button>
            <button
              className={`topbar-filter-menu-item${globalInboxFilter === 'neither' ? ' active' : ''}`}
              onClick={() => handleSelectFilter('neither')}
            >
              Neither
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
            className={`account-badge ${disabledAccountIds.has(a.id) ? 'disabled' : ''}`}
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
      <button
        className={`topbar-mute-btn${soundMuted ? ' muted' : ''}`}
        onClick={toggleSoundMuted}
        title={soundMuted ? 'Unmute sound effects' : 'Mute sound effects'}
      >
        {soundMuted ? <Icons.VolumeOff /> : <Icons.Volume />}
      </button>
      <button className="settings-btn" onClick={toggleSettings}>
        <Icons.Settings />
      </button>
    </div>
  );
}
