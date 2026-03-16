import { useState } from 'react';
import { useStore } from '../store/index.ts';
import { connectGmailAccount, connectOutlookAccount } from '../lib/oauth.ts';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export function SyncErrorBanner() {
  const accounts = useStore(s => s.accounts);
  const [dismissed, setDismissed] = useState(false);
  const [reconnecting, setReconnecting] = useState<string | null>(null);

  const staleErrorAccounts = accounts.filter(a => {
    if (a.syncStatus !== 'error') return false;
    if (!a.lastSyncedAt) return true;
    return Date.now() - new Date(a.lastSyncedAt).getTime() > ONE_DAY_MS;
  });

  if (dismissed || staleErrorAccounts.length === 0) return null;

  const handleReconnect = async (account: typeof staleErrorAccounts[0]) => {
    setReconnecting(account.id);
    try {
      if (account.provider === 'Gmail') {
        await connectGmailAccount();
      } else {
        await connectOutlookAccount();
      }
    } catch {
      setReconnecting(null);
    }
  };

  const names = staleErrorAccounts.map(a => a.name).join(', ');

  return (
    <div className="sync-error-banner">
      <span className="sync-error-banner-text">
        {staleErrorAccounts.length === 1
          ? `${names} needs to be reconnected`
          : `${staleErrorAccounts.length} accounts need to be reconnected: ${names}`}
      </span>
      <div className="sync-error-banner-actions">
        {staleErrorAccounts.map(a => (
          <button
            key={a.id}
            className="sync-error-banner-btn"
            disabled={reconnecting === a.id}
            onClick={() => handleReconnect(a)}
          >
            {reconnecting === a.id ? 'Redirecting...' : `Reconnect ${a.name}`}
          </button>
        ))}
        <button className="sync-error-banner-dismiss" onClick={() => setDismissed(true)}>
          &times;
        </button>
      </div>
    </div>
  );
}
