import { useState, useEffect, useRef } from 'react';
import { Reorder } from 'framer-motion';
import { Icons } from './ui/Icons.tsx';
import { useStore } from '../store/index.ts';
import { useAuth } from '../hooks/useAuth.ts';
import { useDeleteSweepRule } from '../hooks/useSweepRules.ts';
import { useDeleteColumn } from '../hooks/useColumns.ts';
import { useDeleteEmailAccount } from '../hooks/useEmailAccounts.ts';
import { ConnectAccountFlow } from './settings/ConnectAccountFlow.tsx';
import type { Account, Column as ColumnType, Criterion, SweepRule } from '../types/index.ts';

function ruleMatchesSearch(name: string, criteria: Criterion[], query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  if (name.toLowerCase().includes(q)) return true;
  return criteria.some(c => c.value.toLowerCase().includes(q));
}

// ========================================
// SETTINGS SECTIONS CONFIG
// ========================================
const SETTINGS_SECTIONS = [
  { id: 'accounts', name: 'Accounts', icon: '👤' },
  { id: 'columns', name: 'Streams', icon: '📋' },
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
  const { user } = useAuth();
  const deleteMutation = useDeleteEmailAccount();
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
      <button
        className="settings-account-remove"
        onClick={() => {
          if (!user?.id) return;
          if (!confirm(`Remove ${account.email}? This will delete all synced emails for this account.`)) return;
          deleteMutation.mutate({ id: account.id, userId: user.id });
          useStore.setState(s => ({
            accounts: s.accounts.filter(a => a.id !== account.id),
            emails: s.emails.filter(e => e.accountId !== account.id),
          }));
        }}
      >Remove</button>
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
function formatColumnCriteriaSummary(criteria: Criterion[], logic: 'and' | 'or'): string {
  if (!criteria || criteria.length === 0) return 'No filters';
  const joiner = logic === 'and' ? ' AND ' : ' OR ';
  const columns = useStore.getState().columns;
  return criteria.map(c => {
    if (c.field === 'stream') {
      const col = columns.find(col => col.id === c.value);
      return `Stream: "${col?.name || c.value}"`;
    }
    const fieldLabel = { from: 'From', to: 'To', subject: 'Subject', body: 'Body', label: 'Label' }[c.field] || c.field;
    const opLabel = c.op.replace('_', ' ');
    return `${fieldLabel} ${opLabel} "${c.value}"`;
  }).join(joiner);
}

function SettingsColumns({ columns }: { columns: ColumnType[] }) {
  const { reorderColumns, openCriteriaEditor, openNewColumnEditor, toggleColumn } = useStore();
  const { user } = useAuth();
  const deleteMutation = useDeleteColumn();
  const [search, setSearch] = useState('');

  const filteredColumns = search
    ? columns.filter(col => ruleMatchesSearch(col.name, col.criteria, search))
    : columns;

  const handleDelete = (columnId: string) => {
    if (!user?.id) return;
    deleteMutation.mutate({ id: columnId, userId: user.id });
    useStore.setState(s => ({
      columns: s.columns.filter(c => c.id !== columnId),
    }));
  };

  return (
    <>
      <div className="settings-content-title">Streams</div>
      <div className="settings-content-desc">Configure your deck streams, their order, and filter criteria. Drag to reorder.</div>
      <input
        className="filter-input"
        placeholder="Search streams..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        style={{ width: '100%', marginBottom: 8 }}
      />
      <Reorder.Group
        as="div"
        axis="y"
        values={filteredColumns}
        onReorder={search ? undefined as any : reorderColumns}
        className="settings-card"
      >
        {filteredColumns.map(col => (
          <Reorder.Item
            key={col.id}
            value={col}
            as="div"
            className="settings-card-row settings-account-draggable"
            whileDrag={{ scale: 1.01, boxShadow: '0 4px 16px rgba(0,0,0,0.2)', zIndex: 10 }}
          >
            <span className="drag-handle-wrap"><Icons.DragHandle /></span>
            <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: col.accent, flexShrink: 0 }} />
            <div
              style={{ flex: 1, cursor: 'pointer' }}
              onClick={() => openCriteriaEditor(col.id)}
            >
              <div className="settings-account-name">{col.name}</div>
              <div className="settings-account-email">
                {formatColumnCriteriaSummary(col.criteria, col.criteriaLogic)}
              </div>
            </div>
            <button
              className={`sweep-rule-toggle ${col.enabled !== false ? 'active' : ''}`}
              onClick={() => toggleColumn(col.id)}
            />
            <button
              className="sweep-rule-delete"
              onClick={() => handleDelete(col.id)}
              title="Delete stream"
            >
              <Icons.Close />
            </button>
          </Reorder.Item>
        ))}
        <button className="settings-add-btn" onClick={() => openNewColumnEditor()}>
          <Icons.Plus /> Add Stream
        </button>
      </Reorder.Group>
    </>
  );
}

// ========================================
// SettingsSweepRules
// ========================================
function formatCriteriaSummary(rule: SweepRule): string {
  if (!rule.criteria || rule.criteria.length === 0) return rule.name;
  const joiner = rule.criteriaLogic === 'and' ? ' AND ' : ' OR ';
  const columns = useStore.getState().columns;
  return rule.criteria.map(c => {
    if (c.field === 'stream') {
      const col = columns.find(col => col.id === c.value);
      return `Stream: "${col?.name || c.value}"`;
    }
    const fieldLabel = { from: 'From', to: 'To', subject: 'Subject', body: 'Body', label: 'Label' }[c.field] || c.field;
    const opLabel = c.op.replace('_', ' ');
    return `${fieldLabel} ${opLabel} "${c.value}"`;
  }).join(joiner);
}

function SettingsSweepRules({ sweepRules, toggleSweepRule }: { sweepRules: SweepRule[]; toggleSweepRule: (id: string) => void }) {
  const { sweepDelayHours, setSweepDelayHours, openSweepRuleEditorForRule, openNewSweepRuleEditor } = useStore();
  const { user } = useAuth();
  const deleteMutation = useDeleteSweepRule();
  const [search, setSearch] = useState('');

  const filteredRules = search
    ? sweepRules.filter(rule => ruleMatchesSearch(rule.name, rule.criteria, search))
    : sweepRules;

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
      <input
        className="filter-input"
        placeholder="Search rules..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        style={{ width: '100%', marginBottom: 8 }}
      />
      <button className="settings-add-btn" onClick={openNewSweepRuleEditor} style={{ marginBottom: 8 }}>
        <Icons.Plus /> Add Rule
      </button>
      <div className="settings-card">
        {filteredRules.map(rule => (
          <div key={rule.id} className="sweep-rule">
            <div className="sweep-rule-top">
              <span
                className="sweep-rule-name"
                style={{ cursor: 'pointer' }}
                onClick={() => openSweepRuleEditorForRule(rule.id)}
                title="Click to edit rule"
              >
                {rule.name}
                <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 6, opacity: 0.4, verticalAlign: 'middle' }}>
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              </span>
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
            <div
              className="sweep-rule-detail"
              style={{ cursor: 'pointer' }}
              onClick={() => openSweepRuleEditorForRule(rule.id)}
            >
              {formatCriteriaSummary(rule)}
            </div>
            <div className="sweep-rule-detail">{rule.detail}</div>
            <div className="sweep-rule-meta">
              <span className="sweep-rule-tag">{rule.enabled ? 'active' : 'paused'}</span>
              <span className="sweep-rule-tag">{
                rule.action === 'keep_newest_archive' ? 'keep newest (archive)' :
                rule.action === 'keep_newest_delete' ? 'keep newest (delete)' :
                rule.action
              }</span>
              <span className="sweep-rule-tag">all accounts</span>
            </div>
          </div>
        ))}
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
