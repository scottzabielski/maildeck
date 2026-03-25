import { useEffect, useRef } from 'react';
import { Icons } from './ui/Icons.tsx';
import { useStore } from '../store/index.ts';

export function ContextMenu() {
  const { contextMenu, closeContextMenu, emails, columns, sweepEmails, toggleRead, toggleStar, archiveEmail, deleteEmail, moveToSweep, exemptSweepEmail, openSweepRuleEditor, openStreamEditorFromEmail, openCriteriaEditorWithPrefill, multiSelectedIds, archiveSelected, deleteSelected, markSelectedRead, markSelectedUnread } = useStore();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) closeContextMenu();
    };
    const handleEscape = (e: KeyboardEvent) => { if (e.key === 'Escape') closeContextMenu(); };
    const handleScroll = () => closeContextMenu();
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEscape);
    document.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEscape);
      document.removeEventListener('scroll', handleScroll, true);
    };
  }, [contextMenu, closeContextMenu]);

  if (!contextMenu) return null;

  const email = emails.find(e => e.id === contextMenu.emailId);
  if (!email) return null;

  const isBulk = multiSelectedIds.size > 0 && multiSelectedIds.has(contextMenu.emailId);
  const bulkCount = multiSelectedIds.size;

  // Viewport clamping
  const menuW = 210, menuH = isBulk ? 140 : 230;
  const x = Math.min(contextMenu.x, window.innerWidth - menuW - 8);
  const y = Math.min(contextMenu.y, window.innerHeight - menuH - 8);

  const item = (Icon: React.FC, label: string, onClick: () => void, danger?: boolean) => (
    <div
      className={`context-menu-item${danger ? ' danger' : ''}`}
      onClick={() => { onClick(); closeContextMenu(); }}
    >
      <Icon />
      <span>{label}</span>
    </div>
  );

  if (isBulk) {
    // Determine majority read state for bulk toggle
    const selectedEmails = emails.filter(e => multiSelectedIds.has(e.id));
    const unreadCount = selectedEmails.filter(e => e.unread).length;
    const majorityUnread = unreadCount > selectedEmails.length / 2;

    return (
      <div
        ref={menuRef}
        className="context-menu"
        style={{ left: x, top: y }}
      >
        {item(
          majorityUnread ? Icons.EnvelopeOpen : Icons.Envelope,
          majorityUnread ? `Mark ${bulkCount} as read` : `Mark ${bulkCount} as unread`,
          () => majorityUnread ? markSelectedRead() : markSelectedUnread()
        )}
        {item(Icons.Archive, `Archive ${bulkCount} emails`, () => archiveSelected())}
        {item(Icons.Trash, `Delete ${bulkCount} emails`, () => deleteSelected(), true)}
      </div>
    );
  }

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{ left: x, top: y }}
    >
      {item(email.unread ? Icons.EnvelopeOpen : Icons.Envelope, email.unread ? 'Mark as read' : 'Mark as unread', () => toggleRead(email.id))}
      {item(Icons.Star, email.starred ? 'Unstar' : 'Star', () => toggleStar(email.id))}
      {item(Icons.Archive, 'Archive', () => archiveEmail(email.id))}
      {item(Icons.Sweep, 'Move to Sweep', () => moveToSweep(email.id))}
      {sweepEmails.some(s => s.id === email.id) && item(Icons.Sweep, 'Exempt from Sweep', () => exemptSweepEmail(email.id))}
      {item(Icons.Trash, 'Delete', () => deleteEmail(email.id), true)}
      <div className="context-menu-separator" />
      {item(Icons.Sweep, 'Create Sweep Rule\u2026', () => {
        openSweepRuleEditor(contextMenu.emailId);
      })}
      {item(Icons.Plus, 'Create Stream\u2026', () => {
        openStreamEditorFromEmail(contextMenu.emailId);
      })}
      {columns.filter(c => c.enabled).length > 0 && (
        <div className="context-menu-submenu-wrapper">
          <div className="context-menu-item">
            <Icons.Filter />
            <span>Add to Stream</span>
            <Icons.ChevronRight />
          </div>
          <div className="context-menu-submenu">
            {columns.filter(c => c.enabled).map(col => (
              <div
                key={col.id}
                className="context-menu-item"
                onClick={() => {
                  openCriteriaEditorWithPrefill(col.id, contextMenu.emailId);
                  closeContextMenu();
                }}
              >
                <span className="context-menu-stream-dot" style={{ background: col.accent }} />
                <span>{col.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
