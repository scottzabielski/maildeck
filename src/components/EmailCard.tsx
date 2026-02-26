import { motion } from 'framer-motion';
import { useStore } from '../store/index.ts';
import { formatTime, formatCountdown, getCountdownClass } from '../lib/helpers.ts';
import { Icons } from './ui/Icons.tsx';
import type { Email, Account } from '../types/index.ts';

interface EmailCardProps {
  email: Email;
  accent: string;
  accounts: Account[];
  columnId: string;
  sourceAccountId?: string;
  selectedEmailId: string | null;
  highlightedEmailId: string | null;
  multiSelectedIds: Set<string>;
  sweepSeconds?: number;
  sweepAction?: string;
  matchedSweepRule?: { action: string; delayHours: number };
  matchedStreams?: Array<{ id: string; accent: string }>;
}

export function EmailCard({ email, accent, accounts, columnId, sourceAccountId, selectedEmailId, highlightedEmailId, multiSelectedIds, sweepSeconds, sweepAction, matchedSweepRule, matchedStreams }: EmailCardProps) {
  const openContextMenu = useStore(s => s.openContextMenu);
  const selectEmail = useStore(s => s.selectEmail);
  const highlightEmail = useStore(s => s.highlightEmail);
  const toggleMultiSelect = useStore(s => s.toggleMultiSelect);
  const rangeSelect = useStore(s => s.rangeSelect);
  const clearMultiSelect = useStore(s => s.clearMultiSelect);
  const account = accounts.find(a => a.id === email.accountId);
  const isHighlighted = highlightedEmailId === email.id;
  const isViewing = selectedEmailId === email.id;
  const isMultiSelected = multiSelectedIds.has(email.id);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    openContextMenu(e.clientX, e.clientY, email.id, columnId || email.columnId);
  };

  const handleClick = (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      toggleMultiSelect(email.id);
    } else if (e.shiftKey) {
      e.preventDefault();
      window.getSelection()?.removeAllRanges();
      rangeSelect(email.id, columnId || email.columnId);
    } else {
      clearMultiSelect();
      highlightEmail(email.id, columnId || email.columnId, sourceAccountId || email.accountId);
    }
  };

  const handleDoubleClick = () => {
    selectEmail(email.id, columnId || email.columnId, sourceAccountId || email.accountId);
  };

  // Compute effective sweep countdown: prefer queue value, fall back to rule-based calculation
  let effectiveSweepSeconds = sweepSeconds;
  let effectiveSweepAction = sweepAction;
  if (effectiveSweepSeconds == null && matchedSweepRule) {
    const emailAgeSec = Math.floor((Date.now() - email.time) / 1000);
    effectiveSweepSeconds = Math.max(0, matchedSweepRule.delayHours * 3600 - emailAgeSec);
    effectiveSweepAction = matchedSweepRule.action === 'delete' || matchedSweepRule.action === 'keep_newest_delete' ? 'delete' : 'archive';
  }
  const hasSweep = effectiveSweepSeconds != null && effectiveSweepSeconds >= 0;
  const hasSweepRule = hasSweep || !!matchedSweepRule;

  return (
    <motion.div
      className={`email-card ${email.unread ? 'unread' : ''} ${email.starred ? 'starred' : ''}${isHighlighted ? ' highlighted' : ''}${isViewing ? ' viewing' : ''}${isMultiSelected ? ' multi-selected' : ''}${hasSweepRule ? ' has-sweep' : ''}`}
      style={{ '--column-accent': accent } as React.CSSProperties}
      layout
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20, transition: { duration: 0.2 } }}
      transition={{ duration: 0.25 }}
      onContextMenu={handleContextMenu}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      data-email-id={email.id}
    >
      <div className="email-card-top">
        <span className="email-sender">{email.sender}</span>
        {email.starred && <span className="star-indicator">{'\u2605'}</span>}
        <span className="email-time">{formatTime(email.time)}</span>
      </div>
      <div className="email-subject">{email.subject}</div>
      <div className="email-snippet">{email.snippet}</div>
      {hasSweep && (
        <div className="email-card-sweep-row">
          <span className={`email-sweep-badge ${getCountdownClass(effectiveSweepSeconds)}`}>
            <Icons.Clock />
            {effectiveSweepAction === 'delete' ? 'Delete' : 'Archive'} in {formatCountdown(effectiveSweepSeconds)}
          </span>
        </div>
      )}
      {matchedStreams && matchedStreams.length > 0 && (
        <div className="email-stream-indicators">
          {matchedStreams.map(s => (
            <div key={s.id} className="email-stream-indicator" style={{ background: s.accent }} />
          ))}
        </div>
      )}
    </motion.div>
  );
}
