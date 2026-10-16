import { memo } from 'react';
import { Icons } from '../../components/ui/Icons.tsx';
import { Countdown } from '../../components/ui/Countdown.tsx';
import { useStore } from '../../store/index.ts';
import { formatCountdown, getCountdownClass, claudeCheckLabel, isClaudeHeld } from '../../lib/helpers.ts';
import type { SweepEmail } from '../../types/index.ts';

interface MobileSweepListItemProps {
  email: SweepEmail;
}

export const MobileSweepListItem = memo(function MobileSweepListItem({ email }: MobileSweepListItemProps) {
  const accounts = useStore(s => s.accounts);
  const exemptSweepEmail = useStore(s => s.exemptSweepEmail);
  const approveSweepCheck = useStore(s => s.approveSweepCheck);
  const retrySweepCheck = useStore(s => s.retrySweepCheck);
  const selectEmail = useStore(s => s.selectEmail);

  const account = accounts.find(a => a.id === email.accountId);
  const isExpiring = email.expiring === true;
  const isDelete = email.action === 'delete';
  // Held by a Claude check: no countdown, nothing runs until Claude says match.
  const held = isClaudeHeld(email);
  const claudeNote = email.aiStatus === 'match' || email.aiStatus === 'unsure'
    ? email.aiReason && `Claude: ${email.aiReason}`
    : email.aiStatus === 'failed' ? email.aiReason : null;

  const handleClick = () => {
    if (isExpiring) return;
    selectEmail(email.id, 'sweep', email.accountId);
  };

  const handleExempt = (e: React.MouseEvent) => {
    e.stopPropagation();
    exemptSweepEmail(email.id);
  };

  return (
    <div
      className={`mobile-sweep-row${isExpiring ? ' expiring' : ''}`}
      onClick={handleClick}
    >
      <div className="mobile-email-row-content">
        <div className="mobile-email-row-top">
          <span className="mobile-email-sender">{email.sender}</span>
          {account && (
            <span
              className="mobile-email-account-dot"
              style={{ background: account.color }}
              aria-hidden
            />
          )}
        </div>
        <div className="mobile-email-subject">{email.subject}</div>
        {claudeNote && <div className="mobile-sweep-claude-note">{claudeNote}</div>}
        <div className="mobile-sweep-bottom">
          {held ? (
            <span className={`mobile-email-sweep-badge claude-${email.aiStatus}`}>
              <Icons.Sparkle />
              {claudeCheckLabel(email.aiStatus!)}
            </span>
          ) : (
            <Countdown dueAt={email.dueAt}>
              {seconds => (
                <span className={`mobile-email-sweep-badge ${getCountdownClass(seconds)}`}>
                  <Icons.Clock />
                  {isExpiring
                    ? (isDelete ? 'Deleting…' : 'Archiving…')
                    : <>{isDelete ? 'Delete' : 'Archive'} in {formatCountdown(seconds)}</>
                  }
                </span>
              )}
            </Countdown>
          )}
          {!isExpiring && (
            <span className="mobile-sweep-actions">
              {(email.aiStatus === 'unsure' || email.aiStatus === 'failed') && (
                <button
                  type="button"
                  className="mobile-sweep-exempt"
                  onClick={(e) => { e.stopPropagation(); approveSweepCheck(email.id); }}
                >
                  Sweep
                </button>
              )}
              {email.aiStatus === 'failed' && (
                <button
                  type="button"
                  className="mobile-sweep-exempt"
                  onClick={(e) => { e.stopPropagation(); retrySweepCheck(email.id); }}
                >
                  Retry
                </button>
              )}
              <button
                type="button"
                className="mobile-sweep-exempt"
                onClick={handleExempt}
              >
                Exempt
              </button>
            </span>
          )}
        </div>
      </div>
    </div>
  );
});
