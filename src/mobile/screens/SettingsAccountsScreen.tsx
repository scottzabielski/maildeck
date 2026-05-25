import { useState, useRef, useEffect } from 'react';
import { Icons } from '../../components/ui/Icons.tsx';
import { useStore } from '../../store/index.ts';
import { useAuth } from '../../hooks/useAuth.ts';
import { useDeleteEmailAccount } from '../../hooks/useEmailAccounts.ts';
import { connectGmailAccount, connectOutlookAccount } from '../../lib/oauth.ts';
import type { Account } from '../../types/index.ts';

export function SettingsAccountsScreen() {
  const accounts = useStore(s => s.accounts);
  const reorderAccounts = useStore(s => s.reorderAccounts);
  const [reorderMode, setReorderMode] = useState(false);
  const [showConnect, setShowConnect] = useState(false);

  const moveUp = (idx: number) => {
    if (idx <= 0) return;
    const next = [...accounts];
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    reorderAccounts(next);
  };
  const moveDown = (idx: number) => {
    if (idx >= accounts.length - 1) return;
    const next = [...accounts];
    [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
    reorderAccounts(next);
  };

  return (
    <div className="mobile-settings-section">
      <div className="mobile-settings-header">
        <div className="mobile-settings-header-text">
          Manage connected email accounts. Add Gmail, Outlook, or any IMAP provider.
        </div>
        <button
          type="button"
          className="mobile-settings-header-action"
          onClick={() => setReorderMode(v => !v)}
        >
          {reorderMode ? 'Done' : 'Reorder'}
        </button>
      </div>
      <div className="mobile-settings-card">
        {accounts.map((a, idx) => (
          <AccountRow
            key={a.id}
            account={a}
            reorderMode={reorderMode}
            canMoveUp={idx > 0}
            canMoveDown={idx < accounts.length - 1}
            onMoveUp={() => moveUp(idx)}
            onMoveDown={() => moveDown(idx)}
          />
        ))}
        <button
          type="button"
          className="mobile-settings-add-btn"
          onClick={() => setShowConnect(true)}
        >
          <Icons.Plus /> Add account
        </button>
      </div>

      {showConnect && <ConnectAccountSheet onClose={() => setShowConnect(false)} />}
    </div>
  );
}

interface AccountRowProps {
  account: Account;
  reorderMode: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

function AccountRow({ account, reorderMode, canMoveUp, canMoveDown, onMoveUp, onMoveDown }: AccountRowProps) {
  const renameAccount = useStore(s => s.renameAccount);
  const { user } = useAuth();
  const deleteMutation = useDeleteEmailAccount();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(account.name);
  const [reconnecting, setReconnecting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.focus();
  }, [editing]);

  const commit = () => {
    const t = draft.trim();
    if (t && t !== account.name) renameAccount(account.id, t);
    else setDraft(account.name);
    setEditing(false);
  };

  const handleReconnect = async () => {
    setReconnecting(true);
    try {
      if (account.provider === 'Gmail') await connectGmailAccount();
      else await connectOutlookAccount();
    } catch { setReconnecting(false); }
  };

  const handleRemove = () => {
    if (!user?.id) return;
    if (!confirm(`Remove ${account.email}? This will delete all synced emails for this account.`)) return;
    deleteMutation.mutate({ id: account.id, userId: user.id });
    useStore.setState(s => ({
      accounts: s.accounts.filter(a => a.id !== account.id),
      emails: s.emails.filter(e => e.accountId !== account.id),
    }));
  };

  const statusLabel = account.syncStatus === 'error' ? 'error'
    : account.syncStatus === 'syncing' ? 'syncing'
    : account.syncStatus === 'never_synced' ? 'pending'
    : 'synced';

  return (
    <div className="mobile-settings-row mobile-settings-account-row">
      <span className="mobile-settings-dot" style={{ background: account.color }} aria-hidden />
      <div className="mobile-settings-account-info">
        {editing ? (
          <input
            ref={inputRef}
            type="text"
            className="mobile-settings-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') { setDraft(account.name); setEditing(false); }
            }}
          />
        ) : (
          <div
            className="mobile-settings-account-name"
            onClick={() => { setDraft(account.name); setEditing(true); }}
          >
            {account.name}
            <span className="mobile-settings-account-provider"> ({account.provider})</span>
          </div>
        )}
        <div className="mobile-settings-account-email">{account.email}</div>
        <div className="mobile-settings-account-meta">
          <span className={`mobile-settings-tag${account.syncStatus === 'error' ? ' danger' : ''}`}>
            {statusLabel}
          </span>
        </div>
      </div>
      {reorderMode ? (
        <div className="mobile-settings-reorder-controls">
          <button
            type="button"
            className="mobile-settings-reorder-btn"
            onClick={onMoveUp}
            disabled={!canMoveUp}
            aria-label="Move up"
          >
            ↑
          </button>
          <button
            type="button"
            className="mobile-settings-reorder-btn"
            onClick={onMoveDown}
            disabled={!canMoveDown}
            aria-label="Move down"
          >
            ↓
          </button>
        </div>
      ) : (
        <div className="mobile-settings-row-actions">
          {account.syncStatus === 'error' && (
            <button
              type="button"
              className="mobile-settings-row-btn"
              onClick={handleReconnect}
              disabled={reconnecting}
            >
              {reconnecting ? '…' : 'Reconnect'}
            </button>
          )}
          <button
            type="button"
            className="mobile-settings-row-btn danger"
            onClick={handleRemove}
          >
            Remove
          </button>
        </div>
      )}
    </div>
  );
}

function ConnectAccountSheet({ onClose }: { onClose: () => void }) {
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async (provider: 'gmail' | 'outlook') => {
    setConnecting(true);
    setError(null);
    try {
      if (provider === 'gmail') await connectGmailAccount();
      else await connectOutlookAccount();
    } catch (err) {
      setError((err as Error).message);
      setConnecting(false);
    }
  };

  return (
    <div className="mobile-sheet-backdrop" onClick={onClose}>
      <div className="mobile-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="mobile-sheet-header">
          <div className="mobile-sheet-grabber" aria-hidden />
          <div className="mobile-sheet-title">Connect email account</div>
          <button
            type="button"
            className="mobile-sheet-close"
            onClick={onClose}
            aria-label="Close"
          >
            <Icons.Close />
          </button>
        </div>
        <div className="mobile-sheet-body" style={{ padding: 16 }}>
          {error && <div className="mobile-error" style={{ marginBottom: 12 }}>{error}</div>}
          <button
            type="button"
            className="mobile-connect-btn"
            onClick={() => connect('gmail')}
            disabled={connecting}
            style={{ marginBottom: 10 }}
          >
            Connect Gmail
          </button>
          <button
            type="button"
            className="mobile-connect-btn"
            onClick={() => connect('outlook')}
            disabled={connecting}
          >
            Connect Outlook
          </button>
        </div>
      </div>
    </div>
  );
}
