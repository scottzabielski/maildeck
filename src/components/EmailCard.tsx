import { memo, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useStore } from '../store/index.ts';
import { formatTime, formatCountdown, getCountdownClass, claudeCheckLabel, isClaudeHeld } from '../lib/helpers.ts';
import type { RuleMatch, StreamTag } from '../lib/emailFilter.ts';
import { Icons } from './ui/Icons.tsx';
import { Countdown } from './ui/Countdown.tsx';
import type { Email, SweepEmail } from '../types/index.ts';

const txtArea = typeof document !== 'undefined' ? document.createElement('textarea') : null;
function decodeHTML(html: string): string {
  // Only entities need decoding, and most text has none.
  if (!txtArea || !html.includes('&')) return html;
  txtArea.innerHTML = html;
  return txtArea.value;
}

const isDeleteAction = (action: string) => action === 'delete' || action === 'keep_newest_delete';

interface EmailCardProps {
  email: Email;
  accent: string;
  columnId: string;
  sourceAccountId?: string;
  /** The email's entry in the sweep queue, if it has one. */
  sweep?: SweepEmail;
  matchedSweepRule?: RuleMatch;
  matchedStreams?: StreamTag[];
}

// Memoized, and reads its own selection state from the store, so a click redraws
// only the cards it changes rather than every card in every column.
export const EmailCard = memo(function EmailCard({ email, accent, columnId, sourceAccountId, sweep, matchedSweepRule, matchedStreams }: EmailCardProps) {
  const openContextMenu = useStore(s => s.openContextMenu);
  const selectEmail = useStore(s => s.selectEmail);
  const highlightEmail = useStore(s => s.highlightEmail);
  const toggleMultiSelect = useStore(s => s.toggleMultiSelect);
  const rangeSelect = useStore(s => s.rangeSelect);
  const clearMultiSelect = useStore(s => s.clearMultiSelect);
  const isExempted = useStore(s => s.exemptedEmailIds.has(email.id));
  const isHighlighted = useStore(s => s.highlightedEmail?.emailId === email.id);
  const isViewing = useStore(s => s.selectedEmail?.emailId === email.id);
  const isMultiSelected = useStore(s => s.multiSelectedIds.has(email.id));
  const sender = useMemo(() => decodeHTML(email.sender), [email.sender]);
  const subject = useMemo(() => decodeHTML(email.subject), [email.subject]);
  const snippet = useMemo(() => decodeHTML(email.snippet), [email.snippet]);

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
      // If the viewer is already open, swap to this email instead of just
      // highlighting — saves a click. Otherwise keep the highlight-only
      // behavior so the list stays browsable without committing to a viewer.
      if (useStore.getState().selectedEmail) {
        selectEmail(email.id, columnId || email.columnId, sourceAccountId || email.accountId);
      } else {
        highlightEmail(email.id, columnId || email.columnId, sourceAccountId || email.accountId);
      }
    }
  };

  const handleDoubleClick = () => {
    selectEmail(email.id, columnId || email.columnId, sourceAccountId || email.accountId);
  };

  // Effective sweep countdown: prefer the queue's due time, fall back to the rule's.
  // A sweep held by a Claude check shows its state instead; a Claude-checked
  // rule's match has no countdown until Claude has said match.
  const held = !!sweep && isClaudeHeld(sweep);
  let dueAt = held ? undefined : sweep?.dueAt;
  let sweepAction = sweep?.action || 'archive';
  if (dueAt == null && !held && matchedSweepRule && !matchedSweepRule.claude && !isExempted) {
    dueAt = email.time + matchedSweepRule.delayHours * 3_600_000;
    sweepAction = isDeleteAction(matchedSweepRule.action) ? 'delete' : 'archive';
  }
  const hasSweepRule = !!sweep || (!!matchedSweepRule && !isExempted);
  const ruleBadge = matchedSweepRule && !isExempted ? (
    <div className="email-card-sweep-row">
      <span className="email-sweep-badge rule-matched">
        <Icons.Sweep />
        {isDeleteAction(matchedSweepRule.action) ? 'Delete' : 'Archive'}
        {matchedSweepRule.claude ? ' if Claude agrees' : ' (sweep rule)'}
      </span>
    </div>
  ) : null;

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
        <span className="email-sender">{sender}</span>
        {email.starred && <span className="star-indicator">{'\u2605'}</span>}
        <span className="email-time">{formatTime(email.time)}</span>
      </div>
      <div className="email-subject">{subject}</div>
      <div className="email-snippet">{snippet}</div>
      {held && (
        <div className="email-card-sweep-row">
          <span className={`email-sweep-badge claude-${sweep.aiStatus}`} title={sweep.aiReason || undefined}>
            <Icons.Sparkle />
            {claudeCheckLabel(sweep.aiStatus!)}
          </span>
        </div>
      )}
      {dueAt != null ? (
        // Once the countdown runs out, the rule badge shows until the sweep removes the card.
        <Countdown dueAt={dueAt}>
          {seconds => seconds > 0 ? (
            <div className="email-card-sweep-row">
              <span
                className={`email-sweep-badge ${getCountdownClass(seconds)}`}
                title={sweep?.aiStatus === 'match' ? `Claude: ${sweep.aiReason}` : undefined}
              >
                <Icons.Clock />
                {sweepAction === 'delete' ? 'Delete' : 'Archive'} in {formatCountdown(seconds)}
              </span>
            </div>
          ) : ruleBadge}
        </Countdown>
      ) : !held && ruleBadge}
      {matchedStreams && matchedStreams.length > 0 && (
        <div className="email-stream-indicators">
          {matchedStreams.map(s => (
            <div key={s.id} className="email-stream-indicator" style={{ background: s.accent }} />
          ))}
        </div>
      )}
    </motion.div>
  );
});
