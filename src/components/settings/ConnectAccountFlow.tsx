import { useState } from 'react';
import { connectGmailAccount, connectOutlookAccount } from '../../lib/oauth.ts';

/**
 * Provider picker modal for connecting a new email account.
 * Shown when user clicks "Add Account" in Settings > Accounts.
 */
export function ConnectAccountFlow({ onClose }: { onClose: () => void }) {
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async (provider: 'gmail' | 'outlook') => {
    setConnecting(true);
    setError(null);
    try {
      if (provider === 'gmail') {
        await connectGmailAccount();
      } else {
        await connectOutlookAccount();
      }
      // Browser will redirect — no need to close
    } catch (err) {
      setError((err as Error).message);
      setConnecting(false);
    }
  };

  return (
    <div className="connect-account-overlay" onClick={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}>
      <div className="connect-account-modal">
        <div className="connect-account-header">
          <span className="connect-account-title">Connect Email Account</span>
          <button className="connect-account-close" onClick={onClose}>&times;</button>
        </div>
        <div className="connect-account-body">
          <p className="connect-account-desc">
            Choose a provider to connect your email account. You'll be redirected to sign in and grant access.
          </p>
          {error && (
            <div className="connect-account-error">{error}</div>
          )}
          <button
            className="connect-account-btn connect-account-gmail"
            onClick={() => connect('gmail')}
            disabled={connecting}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.02 10.02 0 001 12c0 1.61.39 3.14 1.07 4.49l3.77-2.4z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Connect Gmail
          </button>
          <button
            className="connect-account-btn connect-account-outlook"
            onClick={() => connect('outlook')}
            disabled={connecting}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
              <path d="M11.5 2v8.5H2V2h9.5z" fill="#F25022"/>
              <path d="M22 2v8.5h-9.5V2H22z" fill="#7FBA00"/>
              <path d="M11.5 13.5V22H2v-8.5h9.5z" fill="#00A4EF"/>
              <path d="M22 13.5V22h-9.5v-8.5H22z" fill="#FFB900"/>
            </svg>
            Connect Outlook
          </button>
        </div>
      </div>
    </div>
  );
}
