import { useState, useEffect, useRef } from 'react';
import { Reorder } from 'framer-motion';
import { Icons } from './ui/Icons.tsx';
import { useStore } from '../store/index.ts';
import { useAuth } from '../hooks/useAuth.ts';
import { useDeleteSweepRule } from '../hooks/useSweepRules.ts';
import { ConnectAccountFlow } from './settings/ConnectAccountFlow.tsx';
import type { Account, Column as ColumnType, SweepRule } from '../types/index.ts';

// ========================================
// SETTINGS SECTIONS CONFIG
// ========================================
const SETTINGS_SECTIONS = [
  { id: 'accounts', name: 'Accounts', icon: '👤' },
  { id: 'columns', name: 'Columns', icon: '📋' },
  { id: 'sweep', name: 'Sweep Rules', icon: '🧹' },
  { id: 'notifications', name: 'Notifications', icon: '🔔' },
  { id: 'appearance', name: 'Appearance', icon: '🎨' },
  { id: 'shortcuts', name: 'Shortcuts', icon: '⌨️' },
];

// ========================================
// SettingsAccountRow
// ========================================
function SettingsAccountRow({ account }: { account: Account }) {
  const renameAccount = useStore(s => s.renameAccount);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(account.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.focus();
  }, [editing]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== account.name) renameAccount(account.id, trimmed);
    else setDraft(account.name);
    setEditing(false);
  };

  return (
    <>
      <span className="drag-handle-wrap"><Icons.DragHandle /></span>
      <span className="settings-account-dot" style={{ background: account.color }} />
      <div className="settings-account-info">
        {editing ? (
          <input
            ref={inputRef}
            className="settings-account-name-input"
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
            className="settings-account-name editable"
            onClick={() => { setDraft(account.name); setEditing(true); }}
          >
            {account.name}
            <span className="settings-account-provider"> ({account.provider})</span>
          </div>
        )}
        <div className="settings-account-email">{account.email}</div>
      </div>
      <span className="settings-account-status">synced</span>
      <button className="settings-account-remove">Remove</button>
    </>
  );
}

// ========================================
// SettingsAccounts
// ========================================
function SettingsAccounts({ accounts }: { accounts: Account[] }) {
  const reorderAccounts = useStore(s => s.reorderAccounts);
  const [showConnect, setShowConnect] = useState(false);

  return (
    <>
      <div className="settings-content-title">Accounts</div>
      <div className="settings-content-desc">Manage connected email accounts. Add Gmail, Outlook, or any IMAP provider. Drag to reorder.</div>
      <Reorder.Group
        as="div"
        axis="y"
        values={accounts}
        onReorder={reorderAccounts}
        className="settings-card"
      >
        {accounts.map(a => (
          <Reorder.Item
            key={a.id}
            value={a}
            as="div"
            className="settings-card-row settings-account-draggable"
            whileDrag={{ scale: 1.01, boxShadow: '0 4px 16px rgba(0,0,0,0.2)', zIndex: 10 }}
          >
            <SettingsAccountRow account={a} />
          </Reorder.Item>
        ))}
        <button className="settings-add-btn" onClick={() => setShowConnect(true)}>
          <Icons.Plus /> Add Account
        </button>
      </Reorder.Group>
      {showConnect && <ConnectAccountFlow onClose={() => setShowConnect(false)} />}
    </>
  );
}

// ========================================
// SettingsColumns
// ========================================
function SettingsColumns({ columns }: { columns: ColumnType[] }) {
  return (
    <>
      <div className="settings-content-title">Columns</div>
      <div className="settings-content-desc">Configure your deck columns, their order, and filter criteria.</div>
      <div className="settings-card">
        {columns.map(col => (
          <div key={col.id} className="settings-card-row" style={{ cursor: 'pointer' }}>
            <span style={{ fontSize: '15px', width: '20px', textAlign: 'center' }}>{col.icon}</span>
            <div style={{ flex: 1 }}>
              <div className="settings-account-name">{col.name}</div>
              <div className="settings-account-email">
                {col.criteria.length} filter rule{col.criteria.length !== 1 ? 's' : ''}
              </div>
            </div>
            <span style={{ width: '10px', height: '10px', borderRadius: '2px', background: col.accent }} />
            <Icons.ChevronRight />
          </div>
        ))}
        <button className="settings-add-btn">
          <Icons.Plus /> Add Column
        </button>
      </div>
    </>
  );
}

// ========================================
// SettingsSweepRules
// ========================================
function formatCriteriaSummary(rule: SweepRule): string {
  if (!rule.criteria || rule.criteria.length === 0) return rule.name;
  const joiner = rule.criteriaLogic === 'and' ? ' AND ' : ' OR ';
  return rule.criteria.map(c => {
    const fieldLabel = { from: 'From', to: 'To', subject: 'Subject', body: 'Body', label: 'Label' }[c.field] || c.field;
    const opLabel = c.op.replace('_', ' ');
    return `${fieldLabel} ${opLabel} "${c.value}"`;
  }).join(joiner);
}

function SettingsSweepRules({ sweepRules, toggleSweepRule }: { sweepRules: SweepRule[]; toggleSweepRule: (id: string) => void }) {
  const { sweepDelayHours, setSweepDelayHours } = useStore();
  const { user } = useAuth();
  const deleteMutation = useDeleteSweepRule();

  const handleDelete = (ruleId: string) => {
    if (!user?.id) return;
    deleteMutation.mutate({ id: ruleId, userId: user.id });
    // Also remove from in-memory store immediately
    useStore.setState(s => ({
      sweepRules: s.sweepRules.filter(r => r.id !== ruleId),
    }));
  };
  return (
    <>
      <div className="settings-content-title">Sweep Rules</div>
      <div className="settings-content-desc">Automatically archive emails that match these rules after a set time.</div>
      <div className="settings-card">
        <div className="settings-option">
          <div className="settings-option-info">
            <div className="settings-option-label">Default sweep delay</div>
            <div className="settings-option-desc">How long emails stay in Sweep before being archived</div>
          </div>
          <select
            className="settings-select"
            value={String(sweepDelayHours)}
            onChange={(e) => setSweepDelayHours(Number(e.target.value))}
          >
            <option value="1">1 hour</option>
            <option value="6">6 hours</option>
            <option value="12">12 hours</option>
            <option value="24">24 hours</option>
            <option value="48">2 days</option>
            <option value="168">7 days</option>
          </select>
        </div>
      </div>
      <div className="settings-content-title" style={{ marginTop: '20px' }}>Rules</div>
      <div className="settings-card">
        {sweepRules.map(rule => (
          <div key={rule.id} className="sweep-rule">
            <div className="sweep-rule-top">
              <span className="sweep-rule-name">{rule.name}</span>
              <button
                className={`sweep-rule-toggle ${rule.enabled ? 'active' : ''}`}
                onClick={() => toggleSweepRule(rule.id)}
              />
              <button
                className="sweep-rule-delete"
                onClick={() => handleDelete(rule.id)}
                title="Delete rule"
              >
                <Icons.Close />
              </button>
            </div>
            <div className="sweep-rule-detail">
              {formatCriteriaSummary(rule)}
            </div>
            <div className="sweep-rule-detail">{rule.detail}</div>
            <div className="sweep-rule-meta">
              <span className="sweep-rule-tag">{rule.enabled ? 'active' : 'paused'}</span>
              <span className="sweep-rule-tag">{rule.action}</span>
              <span className="sweep-rule-tag">all accounts</span>
            </div>
          </div>
        ))}
        <button className="settings-add-btn">
          <Icons.Plus /> Add Rule
        </button>
      </div>
    </>
  );
}

// ========================================
// SettingsNotifications
// ========================================
function SettingsNotifications() {
  return (
    <>
      <div className="settings-content-title">Notifications</div>
      <div className="settings-content-desc">Control how and when you get notified about new emails.</div>
      <div className="settings-card">
        <div className="settings-option">
          <div className="settings-option-info">
            <div className="settings-option-label">Desktop notifications</div>
            <div className="settings-option-desc">Show system notifications for new emails</div>
          </div>
          <button className="sweep-rule-toggle active" />
        </div>
        <div className="settings-option">
          <div className="settings-option-info">
            <div className="settings-option-label">Sound</div>
            <div className="settings-option-desc">Play a sound when new emails arrive</div>
          </div>
          <button className="sweep-rule-toggle" />
        </div>
        <div className="settings-option">
          <div className="settings-option-info">
            <div className="settings-option-label">Notify for</div>
            <div className="settings-option-desc">Which columns trigger notifications</div>
          </div>
          <select className="settings-select" defaultValue="all">
            <option value="all">All columns</option>
            <option value="team">Team & Clients only</option>
            <option value="none">None</option>
          </select>
        </div>
      </div>
    </>
  );
}

// ========================================
// SettingsAppearance
// ========================================
function SettingsAppearance() {
  const { theme, setTheme } = useStore();
  return (
    <>
      <div className="settings-content-title">Appearance</div>
      <div className="settings-content-desc">Customize the look and feel of MailDeck.</div>
      <div className="settings-card">
        <div className="settings-option">
          <div className="settings-option-info">
            <div className="settings-option-label">Theme</div>
            <div className="settings-option-desc">Choose your preferred color scheme</div>
          </div>
          <select
            className="settings-select"
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
          >
            <option value="dark">Dark</option>
            <option value="light">Light</option>
            <option value="system">System</option>
          </select>
        </div>
        <div className="settings-option">
          <div className="settings-option-info">
            <div className="settings-option-label">Column width</div>
            <div className="settings-option-desc">Default width for deck columns</div>
          </div>
          <select className="settings-select" defaultValue="340">
            <option value="300">Narrow (300px)</option>
            <option value="340">Default (340px)</option>
            <option value="400">Wide (400px)</option>
          </select>
        </div>
        <div className="settings-option">
          <div className="settings-option-info">
            <div className="settings-option-label">Font size</div>
            <div className="settings-option-desc">Base font size for the interface</div>
          </div>
          <select className="settings-select" defaultValue="14">
            <option value="12">Compact (12px)</option>
            <option value="14">Default (14px)</option>
            <option value="16">Comfortable (16px)</option>
          </select>
        </div>
      </div>
    </>
  );
}

// ========================================
// SettingsShortcuts
// ========================================
function SettingsShortcuts() {
  const shortcuts = [
    { key: '⌘ K', desc: 'Command palette' },
    { key: '⌘ 1-5', desc: 'Jump to column' },
    { key: '⌘ ,', desc: 'Open settings' },
    { key: 'J / K', desc: 'Navigate emails' },
    { key: 'E', desc: 'Archive email' },
    { key: 'R', desc: 'Reply' },
    { key: '⌘ ⇧ F', desc: 'Search all' },
    { key: 'X', desc: 'Exempt from sweep' },
  ];
  return (
    <>
      <div className="settings-content-title">Keyboard Shortcuts</div>
      <div className="settings-content-desc">Navigate MailDeck without touching the mouse.</div>
      <div className="settings-card">
        {shortcuts.map((s, i) => (
          <div key={i} className="settings-option">
            <div className="settings-option-label" style={{ flex: 1 }}>{s.desc}</div>
            <span className="sweep-rule-tag" style={{ fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' }}>
              {s.key}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

// ========================================
// SettingsPanel (main export)
// ========================================
export function SettingsPanel() {
  const { isSettingsOpen, toggleSettings, settingsSection, setSettingsSection, accounts, columns, sweepRules, toggleSweepRule } = useStore();
  if (!isSettingsOpen) return null;

  let content;
  switch (settingsSection) {
    case 'accounts': content = <SettingsAccounts accounts={accounts} />; break;
    case 'columns': content = <SettingsColumns columns={columns} />; break;
    case 'sweep': content = <SettingsSweepRules sweepRules={sweepRules} toggleSweepRule={toggleSweepRule} />; break;
    case 'notifications': content = <SettingsNotifications />; break;
    case 'appearance': content = <SettingsAppearance />; break;
    case 'shortcuts': content = <SettingsShortcuts />; break;
    default: content = <SettingsAccounts accounts={accounts} />;
  }

  return (
    <div className="settings-screen">
      <div className="settings-topbar">
        <button className="settings-back-btn" onClick={toggleSettings}>
          <Icons.ChevronLeft />
          Back to Deck
        </button>
        <div className="topbar-divider" />
        <span className="settings-topbar-title">Settings</span>
      </div>
      <div className="settings-layout">
        <nav className="settings-nav">
          <div className="settings-nav-label">Settings</div>
          {SETTINGS_SECTIONS.map(s => (
            <button
              key={s.id}
              className={`settings-nav-item ${settingsSection === s.id ? 'active' : ''}`}
              onClick={() => setSettingsSection(s.id)}
            >
              <span className="settings-nav-icon">{s.icon}</span>
              {s.name}
            </button>
          ))}
        </nav>
        <div className="settings-content">{content}</div>
      </div>
    </div>
  );
}
