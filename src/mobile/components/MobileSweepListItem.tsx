import { Icons } from '../../components/ui/Icons.tsx';
import { useStore } from '../../store/index.ts';
import { formatCountdown, getCountdownClass } from '../../lib/helpers.ts';
import type { SweepEmail } from '../../types/index.ts';

interface MobileSweepListItemProps {
  email: SweepEmail;
}

export function MobileSweepListItem({ email }: MobileSweepListItemProps) {
  const accounts = useStore(s => s.accounts);
  const exemptSweepEmail = useStore(s => s.exemptSweepEmail);
  const selectEmail = useStore(s => s.selectEmail);

  const account = accounts.find(a => a.id === email.accountId);
  const cdClass = getCountdownClass(email.sweepSeconds);
  const isExpiring = email.expiring === true;
  const isDelete = email.action === 'delete';

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
        <div className="mobile-sweep-bottom">
          <span className={`mobile-email-sweep-badge ${cdClass}`}>
            <Icons.Clock />
            {isExpiring
              ? (isDelete ? 'Deleting…' : 'Archiving…')
              : <>{isDelete ? 'Delete' : 'Archive'} in {formatCountdown(email.sweepSeconds)}</>
            }
          </span>
          {!isExpiring && (
            <button
              type="button"
              className="mobile-sweep-exempt"
              onClick={handleExempt}
            >
              Exempt
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
