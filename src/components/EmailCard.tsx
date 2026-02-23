import { motion } from 'framer-motion';
import { useStore } from '../store/index.ts';
import { formatTime } from '../lib/helpers.ts';
import type { Email, Account } from '../types/index.ts';

interface EmailCardProps {
  email: Email;
  accent: string;
  accounts: Account[];
  columnId: string;
  sourceAccountId?: string;
  selectedEmailId: string | null;
}

export function EmailCard({ email, accent, accounts, columnId, sourceAccountId, selectedEmailId }: EmailCardProps) {
  const openContextMenu = useStore(s => s.openContextMenu);
  const selectEmail = useStore(s => s.selectEmail);
  const account = accounts.find(a => a.id === email.accountId);
  const isSelected = selectedEmailId === email.id;

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    openContextMenu(e.clientX, e.clientY, email.id, columnId || email.columnId);
  };

  const handleClick = () => {
    selectEmail(email.id, columnId || email.columnId, sourceAccountId || email.accountId);
  };

  return (
    <motion.div
      className={`email-card ${email.unread ? 'unread' : ''} ${email.starred ? 'starred' : ''}${isSelected ? ' selected' : ''}`}
      style={{ '--column-accent': accent } as React.CSSProperties}
      layout
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20, transition: { duration: 0.2 } }}
      transition={{ duration: 0.25 }}
      onContextMenu={handleContextMenu}
      onClick={handleClick}
    >
      <div className="email-card-top">
        <span className="email-sender">{email.sender}</span>
        {email.starred && <span className="star-indicator">{'\u2605'}</span>}
        {account && <span className="email-account-dot" style={{ background: account.color }} />}
        <span className="email-time">{formatTime(email.time)}</span>
      </div>
      <div className="email-subject">{email.subject}</div>
      <div className="email-snippet">{email.snippet}</div>
    </motion.div>
  );
}
