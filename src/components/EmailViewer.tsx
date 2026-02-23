import { useState } from 'react';
import { motion } from 'framer-motion';
import { Icons } from './ui/Icons.tsx';
import { useStore } from '../store/index.ts';

export function EmailViewer() {
  const { selectedEmail, emails, accounts, deselectEmail, toggleStar, toggleRead, archiveEmail, deleteEmail } = useStore();
  const [copied, setCopied] = useState(false);

  if (!selectedEmail) return null;
  const email = emails.find(e => e.id === selectedEmail.emailId);
  if (!email) return null;
  const account = accounts.find(a => a.id === email.accountId);

  const fullBody = `${email.snippet}\n\nLorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.\n\nDuis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.\n\nBest regards,\n${email.sender}`;

  const timestamp = new Date(email.time).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });

  const handleCopySubject = () => {
    navigator.clipboard.writeText(email.subject).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const avatarLetter = email.sender.charAt(0).toUpperCase();
  const avatarBg = account ? account.color : 'var(--blue)';

  return (
    <motion.div
      className="email-viewer"
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
      key={email.id}
    >
      {/* Header bar */}
      <div className="email-viewer-header">
        <button className="email-viewer-back" onClick={deselectEmail}>
          <Icons.ChevronLeft />
          Back
        </button>
        <div className="email-viewer-actions">
          <button
            className={`email-viewer-action${email.starred ? ' starred' : ''}`}
            onClick={() => toggleStar(email.id)}
            title={email.starred ? 'Unstar' : 'Star'}
          >
            <Icons.Star />
          </button>
          <button
            className="email-viewer-action"
            onClick={() => archiveEmail(email.id)}
            title="Archive"
          >
            <Icons.Archive />
          </button>
          <button
            className="email-viewer-action"
            onClick={() => toggleRead(email.id)}
            title={email.unread ? 'Mark as read' : 'Mark as unread'}
          >
            {email.unread ? <Icons.EnvelopeOpen /> : <Icons.Envelope />}
          </button>
          <button
            className="email-viewer-action danger"
            onClick={() => deleteEmail(email.id)}
            title="Delete"
          >
            <Icons.Trash />
          </button>
        </div>
      </div>
      {/* Meta section */}
      <div className="email-viewer-meta">
        <div className="email-viewer-subject">
          <span className="email-viewer-subject-text">{email.subject}</span>
          <button
            className={`email-viewer-copy-btn${copied ? ' copied' : ''}`}
            onClick={handleCopySubject}
            title={copied ? 'Copied!' : 'Copy subject to clipboard'}
          >
            {copied ? <Icons.Check /> : <Icons.Copy />}
          </button>
        </div>
        <div className="email-viewer-sender-row">
          <div className="email-viewer-avatar" style={{ background: avatarBg }}>
            {avatarLetter}
          </div>
          <div className="email-viewer-sender-info">
            <div className="email-viewer-sender-name">
              {email.sender}
              {account && (
                <span
                  className="email-viewer-account-badge"
                  style={{ background: account.color }}
                >
                  {account.name}
                </span>
              )}
            </div>
            <div className="email-viewer-timestamp">{timestamp}</div>
          </div>
        </div>
      </div>
      {/* Body */}
      <div className="email-viewer-body">
        <div className="email-viewer-body-text">
          {fullBody.split('\n\n').map((para, i) => (
            <p key={i}>{para}</p>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
