import { motion } from 'framer-motion';
import { Icons } from './ui/Icons.tsx';
import { useStore } from '../store/index.ts';
import { formatCountdown, getCountdownClass } from '../lib/helpers.ts';
import type { SweepEmail } from '../types/index.ts';

interface SweepCardProps {
  email: SweepEmail;
}

export function SweepCard({ email }: SweepCardProps) {
  const { accounts, exemptSweepEmail, selectEmail } = useStore();
  const account = accounts.find(a => a.id === email.accountId);
  const cdClass = getCountdownClass(email.sweepSeconds);

  const handleClick = () => {
    selectEmail(email.id, 'sweep', email.accountId);
  };

  return (
    <motion.div
      className="sweep-card"
      layout
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 30, transition: { duration: 0.2 } }}
      transition={{ duration: 0.25 }}
      onClick={handleClick}
      style={{ cursor: 'pointer' }}
    >
      <div className="sweep-card-top">
        <span className="email-sender">{email.sender}</span>
        {account && <span className="email-account-dot" style={{ background: account.color }} />}
      </div>
      <div className="sweep-subject">{email.subject}</div>
      <div className="sweep-bottom">
        <div className={`sweep-countdown ${cdClass}`}>
          <Icons.Clock />
          {email.action === 'delete' ? 'Delete' : 'Archive'} in {formatCountdown(email.sweepSeconds)}
        </div>
        <button
          className="exempt-btn"
          onClick={(e) => { e.stopPropagation(); exemptSweepEmail(email.id); }}
        >
          Exempt
        </button>
      </div>
    </motion.div>
  );
}
