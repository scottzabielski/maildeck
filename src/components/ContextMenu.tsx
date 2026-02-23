import { useEffect, useRef } from 'react';
import { Icons } from './ui/Icons.tsx';
import { useStore } from '../store/index.ts';

export function ContextMenu() {
  const { contextMenu, closeContextMenu, emails, toggleRead, toggleStar, archiveEmail, deleteEmail, moveToSweep, openSweepRuleEditor } = useStore();
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

  // Viewport clamping
  const menuW = 210, menuH = 230;
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
      {item(Icons.Trash, 'Delete', () => deleteEmail(email.id), true)}
      <div className="context-menu-separator" />
      {item(Icons.Sweep, 'Create Sweep Rule\u2026', () => {
        openSweepRuleEditor(contextMenu.emailId);
      })}
    </div>
  );
}
