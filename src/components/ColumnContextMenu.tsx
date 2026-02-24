import { useEffect, useRef, useState } from 'react';
import { Icons } from './ui/Icons.tsx';
import { useStore } from '../store/index.ts';

export function ColumnContextMenu() {
  const { columnContextMenu, closeColumnContextMenu, columns, removeColumn, updateColumn, openCriteriaEditor, openSweepRuleEditorForStream } = useStore();
  const menuRef = useRef<HTMLDivElement>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!columnContextMenu) {
      setRenaming(false);
      return;
    }
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) closeColumnContextMenu();
    };
    const handleEscape = (e: KeyboardEvent) => { if (e.key === 'Escape') closeColumnContextMenu(); };
    const handleScroll = () => closeColumnContextMenu();
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEscape);
    document.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEscape);
      document.removeEventListener('scroll', handleScroll, true);
    };
  }, [columnContextMenu, closeColumnContextMenu]);

  useEffect(() => {
    if (renaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [renaming]);

  if (!columnContextMenu) return null;

  const column = columns.find(c => c.id === columnContextMenu.columnId);
  if (!column) return null;

  const menuW = 200, menuH = 140;
  const x = Math.min(columnContextMenu.x, window.innerWidth - menuW - 8);
  const y = Math.min(columnContextMenu.y, window.innerHeight - menuH - 8);

  const handleRenameStart = () => {
    setRenameValue(column.name);
    setRenaming(true);
  };

  const handleRenameCommit = () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== column.name) {
      updateColumn(column.id, { name: trimmed });
    }
    setRenaming(false);
    closeColumnContextMenu();
  };

  const item = (Icon: React.FC, label: string, onClick: () => void, danger?: boolean, keepOpen?: boolean) => (
    <div
      className={`context-menu-item${danger ? ' danger' : ''}`}
      onClick={() => { onClick(); if (!keepOpen) closeColumnContextMenu(); }}
    >
      <Icon />
      <span>{label}</span>
    </div>
  );

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{ left: x, top: y }}
    >
      {renaming ? (
        <div className="context-menu-rename">
          <input
            ref={inputRef}
            className="context-menu-rename-input"
            value={renameValue}
            onChange={e => setRenameValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleRenameCommit();
              if (e.key === 'Escape') { setRenaming(false); closeColumnContextMenu(); }
            }}
            onBlur={handleRenameCommit}
          />
        </div>
      ) : (
        <>
          {item(Icons.Edit, 'Rename', handleRenameStart, false, true)}
          {item(Icons.Filter, 'Edit Criteria\u2026', () => openCriteriaEditor(column.id))}
          {item(Icons.Sweep, 'Create Sweep Rule\u2026', () => openSweepRuleEditorForStream(column.id))}
          <div className="context-menu-separator" />
          {item(Icons.Trash, 'Delete Stream', () => removeColumn(column.id), true)}
        </>
      )}
    </div>
  );
}
