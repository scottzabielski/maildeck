import { create } from 'zustand';
import type {
  Account, View, Column, Criterion, Email, SweepEmail, SweepRule,
  ContextMenuState, SelectedEmailState, UndoAction,
} from '../types/index.ts';
import { fireEmailAction } from '../lib/emailActions.ts';
import { emailMatchesCriteria } from '../lib/emailFilter.ts';
import { supabase } from '../lib/supabase.ts';

// ========================================
// MOCK DATA
// ========================================
const ACCOUNTS: Account[] = [
  { id: 'scottz', name: 'ScottZ.tv', email: 'scott@scottz.tv', color: '#f25022', provider: 'Outlook' },
  { id: 'syzmail', name: 'SYZ Mail', email: 'syzmail', color: '#0078d4', provider: 'Outlook' },
  { id: 'gs-gmail', name: 'G&S gMail', email: 'gs@gmail.com', color: '#ea4335', provider: 'Gmail' },
  { id: 'szabielski', name: 'szabielski', email: 'szabielski@gmail.com', color: '#34a853', provider: 'Gmail' },
  { id: 'toluca', name: 'Toluca', email: 'szabielski@tolucabaseball.com', color: '#d97706', provider: 'Gmail' },
  { id: 'toluca-sec', name: 'Toluca Sec', email: 'secretary@tolucabaseball.com', color: '#8b5cf6', provider: 'Gmail' },
  { id: 'channel1', name: 'Channel1', email: 'scott@channel1.ai', color: '#06b6d4', provider: 'Gmail' },
];

const VIEWS: View[] = [
  { id: 'streams', name: 'Streams' },
  { id: 'inboxes', name: 'Inboxes' },
];

const COLUMNS: Column[] = [
  {
    id: 'newsletters',
    name: 'Newsletters',
    icon: '📬',
    accent: '#7c3aed',
    criteria: [
      { field: 'from', op: 'contains', value: 'substack.com' },
      { field: 'from', op: 'contains', value: 'newsletter' },
    ],
    criteriaLogic: 'or',
    enabled: true,
  },
  {
    id: 'github',
    name: 'GitHub',
    icon: '🔔',
    accent: '#16a34a',
    criteria: [
      { field: 'from', op: 'contains', value: 'github.com' },
    ],
    criteriaLogic: 'and',
    enabled: true,
  },
  {
    id: 'team',
    name: 'Team',
    icon: '👥',
    accent: '#2563eb',
    criteria: [
      { field: 'to', op: 'equals', value: 'team@company.com' },
      { field: 'label', op: 'equals', value: 'internal' },
    ],
    criteriaLogic: 'or',
    enabled: true,
  },
  {
    id: 'clients',
    name: 'Clients',
    icon: '💼',
    accent: '#d97706',
    criteria: [
      { field: 'label', op: 'equals', value: 'client' },
      { field: 'from', op: 'contains', value: 'acme.co' },
    ],
    criteriaLogic: 'or',
    enabled: true,
  },
];

const NOW = Date.now();
const mins = (m: number) => NOW - m * 60000;
const hrs = (h: number) => NOW - h * 3600000;
const days = (d: number) => NOW - d * 86400000;

const EMAILS: Email[] = [
  // Newsletters (6)
  { id: 'n1', columnId: 'newsletters', accountId: 'szabielski', sender: 'Lenny Rachitsky', subject: 'The art of product sense', snippet: 'Why the best PMs develop intuition over frameworks...', time: mins(12), unread: true, starred: false },
  { id: 'n2', columnId: 'newsletters', accountId: 'szabielski', sender: 'Dense Discovery', subject: 'Issue #287 — Design tools evolution', snippet: 'A curated newsletter of interesting links and resources...', time: mins(45), unread: true, starred: false },
  { id: 'n3', columnId: 'newsletters', accountId: 'scottz', sender: 'TLDR', subject: 'TLDR Tech 2026-02-22', snippet: 'Apple Vision Pro 2 leaked specs, OpenAI announces...', time: hrs(2), unread: true, starred: false },
  { id: 'n4', columnId: 'newsletters', accountId: 'channel1', sender: 'Stratechery', subject: 'The AI supply chain bottleneck', snippet: 'The most important constraint on AI progress isn\'t...', time: hrs(5), unread: false, starred: false },
  { id: 'n5', columnId: 'newsletters', accountId: 'szabielski', sender: 'Benedict Evans', subject: 'The AI hardware race', snippet: 'New analysis on custom silicon and the economics of...', time: hrs(18), unread: false, starred: false },
  { id: 'n6', columnId: 'newsletters', accountId: 'scottz', sender: 'Morning Brew', subject: 'Markets rally on Fed signals', snippet: 'The S&P 500 closed at another record high as investors...', time: days(1), unread: false, starred: false },

  // GitHub (5)
  { id: 'g1', columnId: 'github', accountId: 'channel1', sender: 'dependabot[bot]', subject: 'Bump vite from 5.4.2 to 5.4.7', snippet: 'Bumps vite from 5.4.2 to 5.4.7. Release notes...', time: mins(8), unread: true, starred: false },
  { id: 'g2', columnId: 'github', accountId: 'channel1', sender: 'sarah-chen', subject: 'PR #342: Refactor auth middleware', snippet: 'Ready for review. Split the monolithic auth handler into...', time: mins(34), unread: true, starred: false },
  { id: 'g3', columnId: 'github', accountId: 'szabielski', sender: 'GitHub Actions', subject: 'CI failed: main — deploy pipeline', snippet: 'Build failed at step 3/7: Type check errors in...', time: hrs(1), unread: true, starred: false },
  { id: 'g4', columnId: 'github', accountId: 'channel1', sender: 'alex-kumar', subject: 'Issue #891: Memory leak in WebSocket handler', snippet: 'Connections aren\'t being properly cleaned up when clients...', time: hrs(4), unread: false, starred: false },
  { id: 'g5', columnId: 'github', accountId: 'szabielski', sender: 'maria-rodriguez', subject: 'PR #339: Add rate limiting', snippet: 'Implemented token bucket algorithm with Redis backing...', time: days(2), unread: false, starred: false },

  // Team (6)
  { id: 't1', columnId: 'team', accountId: 'syzmail', sender: 'Emily Park', subject: 'Q1 planning kickoff — agenda', snippet: 'Hey team, here\'s the agenda for Monday\'s planning session...', time: mins(15), unread: true, starred: false },
  { id: 't2', columnId: 'team', accountId: 'syzmail', sender: 'Jordan Blake', subject: 'Design review feedback', snippet: 'Great progress on the dashboard redesign. A few notes on...', time: mins(52), unread: true, starred: false },
  { id: 't3', columnId: 'team', accountId: 'syzmail', sender: 'Rachel Kim', subject: 'Updated project timeline', snippet: 'Adjusted milestones based on yesterday\'s discussion. Key...', time: hrs(2), unread: true, starred: false },
  { id: 't4', columnId: 'team', accountId: 'syzmail', sender: 'Mike Torres', subject: 'Standup notes — Feb 21', snippet: 'Blockers: waiting on API keys from vendor. Completed: auth...', time: hrs(6), unread: false, starred: false },
  { id: 't5', columnId: 'team', accountId: 'syzmail', sender: 'Lisa Chang', subject: 'New hire onboarding checklist', snippet: 'Updated the onboarding doc with the latest tool access...', time: days(1), unread: false, starred: false },
  { id: 't6', columnId: 'team', accountId: 'toluca', sender: 'David Wu', subject: 'Team lunch — Friday poll', snippet: 'Cast your vote! Options: Thai, Mexican, Italian, Sushi...', time: days(2), unread: false, starred: false },

  // Clients (5)
  { id: 'c1', columnId: 'clients', accountId: 'scottz', sender: 'James Foster (Acme Co)', subject: 'Contract renewal discussion', snippet: 'Hi Scott, we\'d like to discuss terms for the upcoming...', time: mins(22), unread: true, starred: false },
  { id: 'c2', columnId: 'clients', accountId: 'channel1', sender: 'Nina Patel (TechStart)', subject: 'Integration timeline update', snippet: 'Our engineering team has completed phase 1 of the API...', time: hrs(1), unread: true, starred: false },
  { id: 'c3', columnId: 'clients', accountId: 'scottz', sender: 'Robert Lane (Meridian)', subject: 'Quarterly review deck', snippet: 'Attached is the QBR presentation for next week. Please...', time: hrs(3), unread: true, starred: false },
  { id: 'c4', columnId: 'clients', accountId: 'gs-gmail', sender: 'Samantha Cruz (Bolt)', subject: 'Feature request: SSO support', snippet: 'Our security team requires SAML-based SSO for enterprise...', time: hrs(8), unread: false, starred: false },
  { id: 'c5', columnId: 'clients', accountId: 'toluca-sec', sender: 'Tom Wright (GlobalFin)', subject: 'Invoice #4521 — clarification', snippet: 'Quick question about the line item for additional API...', time: days(1), unread: false, starred: false },
];

const SWEEP_EMAILS_INIT: SweepEmail[] = [
  { id: 's1', accountId: 'szabielski', sender: 'LinkedIn', subject: 'Your weekly career update', sweepSeconds: 10, exempted: false, action: 'delete' },
  { id: 's2', accountId: 'gs-gmail', sender: 'Uber Eats', subject: 'Craving something? 30% off today', sweepSeconds: 3 * 3600 + 1420, exempted: false },
  { id: 's3', accountId: 'scottz', sender: 'Mailchimp', subject: 'Your campaign stats are in', sweepSeconds: 12 * 3600 + 600, exempted: false },
  { id: 's4', accountId: 'syzmail', sender: 'Jira', subject: '[PROJ-412] moved to In Review', sweepSeconds: 2 * 86400 + 7200, exempted: false },
  { id: 's5', accountId: 'channel1', sender: 'Coursera', subject: 'Continue learning: ML Specialization', sweepSeconds: 6 * 86400 + 14400, exempted: false },
];

const SWEEP_RULES: SweepRule[] = [
  { id: 'sr1', name: 'Marketing emails', detail: 'Auto-archive after 24h', enabled: true, criteria: [{ field: 'from', op: 'contains', value: 'marketing' }], criteriaLogic: 'and', action: 'archive', delayHours: 24 },
  { id: 'sr2', name: 'Social notifications', detail: 'Auto-archive after 12h', enabled: true, criteria: [{ field: 'from', op: 'contains', value: 'notification' }], criteriaLogic: 'and', action: 'archive', delayHours: 12 },
  { id: 'sr3', name: 'Promotional offers', detail: 'Auto-delete after 6h', enabled: false, criteria: [{ field: 'subject', op: 'contains', value: 'offer' }], criteriaLogic: 'and', action: 'delete', delayHours: 6 },
  { id: 'sr4', name: 'Automated reports', detail: 'Auto-archive after 48h', enabled: true, criteria: [{ field: 'from', op: 'contains', value: 'report' }], criteriaLogic: 'and', action: 'archive', delayHours: 48 },
];

// ========================================
// STORE TYPES
// ========================================
export interface SweepRuleEditorState {
  emailId: string;
  sender: string;
  senderEmail: string;
  subject: string;
  toEmail: string;
  columnId: string | null;
  ruleId?: string;
  blank?: boolean;
}

export interface StreamEditorPrefill {
  senderEmail: string;
  sender: string;
  subject: string;
  toEmail: string;
}

export interface ColumnContextMenuState {
  x: number;
  y: number;
  columnId: string;
}

export interface StoreState {
  theme: string;
  accounts: Account[];
  emails: Email[];
  columns: Column[];
  sweepEmails: SweepEmail[];
  views: View[];
  sweepRules: SweepRule[];
  activeViewId: string;
  disabledAccountIds: Set<string>;
  isSettingsOpen: boolean;
  settingsSection: string;
  editingColumnId: string | null;
  creatingColumn: boolean;
  undoAction: UndoAction | null;
  contextMenu: ContextMenuState | null;
  columnContextMenu: ColumnContextMenuState | null;
  searchQuery: string;
  globalInboxFilter: 'none' | 'no-stream' | 'no-sweep' | 'neither';
  globalStreamNoSweep: boolean;
  soundMuted: boolean;
  sweepDelayHours: number;
  sweepRuleEditor: SweepRuleEditorState | null;
  streamEditorPrefill: StreamEditorPrefill | null;
  selectedEmail: SelectedEmailState | null;
  _pendingRemovals: Set<string>;

  setActiveView: (viewId: string) => void;
  setTheme: (theme: string) => void;
  toggleAccount: (accountId: string) => void;
  reorderAccounts: (orderedAccounts: Account[]) => void;
  reorderColumns: (orderedColumns: Column[]) => void;
  renameAccount: (accountId: string, name: string) => void;
  _persistAccountRename?: (accountId: string, name: string) => void;
  toggleSettings: () => void;
  setSettingsSection: (section: string) => void;
  openCriteriaEditor: (columnId: string) => void;
  openNewColumnEditor: () => void;
  closeCriteriaEditor: () => void;
  addColumn: (column: Omit<Column, 'id'>) => void;
  removeColumn: (columnId: string) => void;
  updateColumn: (columnId: string, updates: Partial<Omit<Column, 'id'>>) => void;
  toggleColumn: (columnId: string) => void;
  openContextMenu: (x: number, y: number, emailId: string, columnId: string) => void;
  closeContextMenu: () => void;
  openColumnContextMenu: (x: number, y: number, columnId: string) => void;
  closeColumnContextMenu: () => void;
  setSearchQuery: (query: string) => void;
  setGlobalInboxFilter: (filter: 'none' | 'no-stream' | 'no-sweep' | 'neither') => void;
  toggleGlobalStreamNoSweep: () => void;
  toggleSoundMuted: () => void;
  selectEmail: (emailId: string, sourceColumnId: string, sourceAccountId: string) => void;
  deselectEmail: () => void;
  toggleRead: (emailId: string) => void;
  toggleStar: (emailId: string) => void;
  archiveEmail: (emailId: string) => void;
  deleteEmail: (emailId: string) => void;
  moveToSweep: (emailId: string) => void;
  exemptSweepEmail: (emailId: string) => void;
  undoLastAction: () => void;
  clearUndo: () => void;
  toggleSweepRule: (ruleId: string) => void;
  setSweepDelayHours: (hours: number) => void;
  openSweepRuleEditor: (emailId: string) => void;
  openNewSweepRuleEditor: () => void;
  openSweepRuleEditorForRule: (ruleId: string) => void;
  openSweepRuleEditorForStream: (columnId: string) => void;
  closeSweepRuleEditor: () => void;
  updateSweepRule: (ruleId: string, updates: Partial<Omit<SweepRule, 'id'>>) => void;
  openStreamEditorFromEmail: (emailId: string) => void;
  openCriteriaEditorWithPrefill: (columnId: string, emailId: string) => void;
  addSweepRule: (rule: Omit<SweepRule, 'id' | 'enabled'>) => void;
  applySweepAction: (criteria: Criterion[], criteriaLogic: 'and' | 'or', action: string, delayHours: number) => void;
  addNewEmail: (email: Partial<Email> & Pick<Email, 'id' | 'columnId' | 'accountId' | 'sender' | 'subject' | 'snippet' | 'time' | 'unread'>) => void;
  removeSweepEmail: (emailId: string) => void;
  tickSweepCountdowns: () => void;

  // Persist helpers injected by useSyncStore (no-op until hydrated)
  _persistTheme?: (theme: string) => void;
  _persistSweepDelay?: (hours: number) => void;
  _persistColumnReorder?: (columns: Column[]) => void;
  _persistAccountReorder?: (accounts: Account[]) => void;
  _persistColumnCreate?: (column: Column) => void;
  _persistColumnUpdate?: (columnId: string, updates: Partial<Omit<Column, 'id'>>) => void;
  _persistColumnDelete?: (columnId: string) => void;

  // Pagination helpers injected by useSyncStore
  _fetchNextPage?: () => void;
  _hasNextPage?: boolean;
  _isFetchingNextPage?: boolean;
}

// ========================================
// ZUSTAND STORE
// ========================================
const useMockData = typeof import.meta !== 'undefined' && import.meta.env?.VITE_USE_MOCK_DATA === 'true';

function getInitialTheme(): string {
  try { return localStorage.getItem('maildeck-theme') || 'dark'; } catch { return 'dark'; }
}

export const useStore = create<StoreState>((set, get) => ({
  theme: getInitialTheme(),
  accounts: useMockData ? ACCOUNTS : [],
  emails: useMockData ? EMAILS : [],
  columns: useMockData ? COLUMNS : [],
  sweepEmails: useMockData ? SWEEP_EMAILS_INIT : [],
  views: VIEWS,
  sweepRules: useMockData ? SWEEP_RULES : [],
  activeViewId: 'streams',
  disabledAccountIds: new Set<string>(),
  isSettingsOpen: false,
  settingsSection: 'accounts',
  editingColumnId: null,
  creatingColumn: false,
  undoAction: null,
  contextMenu: null,
  columnContextMenu: null,
  searchQuery: '',
  globalInboxFilter: 'none',
  globalStreamNoSweep: false,
  soundMuted: true,
  sweepDelayHours: 24,
  sweepRuleEditor: null,
  streamEditorPrefill: null,
  selectedEmail: null,
  _pendingRemovals: new Set<string>(),

  setActiveView: (viewId) => set({ activeViewId: viewId, selectedEmail: null }),
  setTheme: (theme) => {
    try { localStorage.setItem('maildeck-theme', theme); } catch { /* noop */ }
    set({ theme });
    get()._persistTheme?.(theme);
  },
  toggleAccount: (accountId) => set(s => {
    const next = new Set(s.disabledAccountIds);
    if (next.has(accountId)) next.delete(accountId);
    else next.add(accountId);
    return { disabledAccountIds: next };
  }),
  reorderAccounts: (orderedAccounts) => {
    set({ accounts: orderedAccounts });
    get()._persistAccountReorder?.(orderedAccounts);
  },
  reorderColumns: (orderedColumns) => {
    set({ columns: orderedColumns });
    get()._persistColumnReorder?.(orderedColumns);
  },
  renameAccount: (accountId, name) => {
    set(s => ({
      accounts: s.accounts.map(a => a.id === accountId ? { ...a, name } : a),
    }));
    get()._persistAccountRename?.(accountId, name);
  },
  toggleSettings: () => set(s => ({ isSettingsOpen: !s.isSettingsOpen, settingsSection: 'accounts' })),
  setSettingsSection: (section) => set({ settingsSection: section }),
  openCriteriaEditor: (columnId) => set({ editingColumnId: columnId, creatingColumn: false }),
  openNewColumnEditor: () => set({ editingColumnId: null, creatingColumn: true }),
  closeCriteriaEditor: () => set({ editingColumnId: null, creatingColumn: false, streamEditorPrefill: null }),
  addColumn: (column) => {
    const id = `col-${Date.now()}`;
    const newCol = { ...column, id };
    set(s => ({ columns: [...s.columns, newCol], creatingColumn: false }));
    get()._persistColumnCreate?.(newCol);
  },
  removeColumn: (columnId) => {
    set(s => ({ columns: s.columns.filter(c => c.id !== columnId) }));
    get()._persistColumnDelete?.(columnId);
  },
  updateColumn: (columnId, updates) => {
    set(s => ({
      columns: s.columns.map(c => c.id === columnId ? { ...c, ...updates } : c),
    }));
    const col = get().columns.find(c => c.id === columnId);
    if (col) get()._persistColumnUpdate?.(columnId, updates);
  },
  toggleColumn: (columnId) => {
    set(s => ({
      columns: s.columns.map(c => c.id === columnId ? { ...c, enabled: !c.enabled } : c),
    }));
    const col = get().columns.find(c => c.id === columnId);
    if (col) get()._persistColumnUpdate?.(columnId, { enabled: col.enabled });
  },

  openContextMenu: (x, y, emailId, columnId) => set({ contextMenu: { x, y, emailId, columnId } }),
  closeContextMenu: () => set({ contextMenu: null }),
  openColumnContextMenu: (x, y, columnId) => set({ columnContextMenu: { x, y, columnId } }),
  closeColumnContextMenu: () => set({ columnContextMenu: null }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setGlobalInboxFilter: (filter) => set({ globalInboxFilter: filter }),
  toggleGlobalStreamNoSweep: () => set(s => ({ globalStreamNoSweep: !s.globalStreamNoSweep })),
  toggleSoundMuted: () => set(s => ({ soundMuted: !s.soundMuted })),

  selectEmail: (emailId, sourceColumnId, sourceAccountId) => {
    const viewMode = get().activeViewId;
    const email = get().emails.find(e => e.id === emailId);
    set(s => ({
      selectedEmail: { emailId, sourceColumnId, sourceAccountId, viewMode },
      emails: s.emails.map(e => e.id === emailId ? { ...e, unread: false } : e),
      contextMenu: null,
    }));
    if (email?.unread) fireEmailAction(emailId, 'mark_read');
  },
  deselectEmail: () => set({ selectedEmail: null }),

  toggleRead: (emailId) => {
    const email = get().emails.find(e => e.id === emailId);
    set(s => ({
      emails: s.emails.map(e => e.id === emailId ? { ...e, unread: !e.unread } : e),
    }));
    if (email) fireEmailAction(emailId, email.unread ? 'mark_read' : 'mark_unread');
  },

  toggleStar: (emailId) => {
    const email = get().emails.find(e => e.id === emailId);
    set(s => ({
      emails: s.emails.map(e => e.id === emailId ? { ...e, starred: !e.starred } : e),
    }));
    if (email) fireEmailAction(emailId, email.starred ? 'unstar' : 'star');
  },

  archiveEmail: (emailId) => {
    const email = get().emails.find(e => e.id === emailId);
    if (!email) return;
    const sel = get().selectedEmail;
    // Mark as read before archiving
    if (email.unread) {
      fireEmailAction(emailId, 'mark_read');
    }
    const removals = new Set(get()._pendingRemovals);
    removals.add(emailId);
    set(s => ({
      emails: s.emails.filter(e => e.id !== emailId),
      undoAction: { type: 'archive', email: { ...email, unread: false }, timestamp: Date.now() },
      selectedEmail: sel && sel.emailId === emailId ? null : s.selectedEmail,
      _pendingRemovals: removals,
    }));
    fireEmailAction(emailId, 'archive');
  },

  deleteEmail: (emailId) => {
    const email = get().emails.find(e => e.id === emailId);
    if (!email) return;
    const sel = get().selectedEmail;
    const removals = new Set(get()._pendingRemovals);
    removals.add(emailId);
    set(s => ({
      emails: s.emails.filter(e => e.id !== emailId),
      undoAction: { type: 'delete', email, timestamp: Date.now() },
      selectedEmail: sel && sel.emailId === emailId ? null : s.selectedEmail,
      _pendingRemovals: removals,
    }));
    fireEmailAction(emailId, 'delete');
  },

  moveToSweep: (emailId) => {
    const email = get().emails.find(e => e.id === emailId);
    if (!email) return;
    const delaySec = get().sweepDelayHours * 3600;
    set(s => ({
      sweepEmails: [...s.sweepEmails, { id: email.id, accountId: email.accountId, sender: email.sender, subject: email.subject, sweepSeconds: delaySec, exempted: false }].sort((a, b) => a.sweepSeconds - b.sweepSeconds),
      undoAction: { type: 'moveToSweep', email, timestamp: Date.now() },
    }));
  },

  exemptSweepEmail: (emailId) => {
    const email = get().sweepEmails.find(e => e.id === emailId);
    if (!email) return;
    // Delete from server so exempt persists across refresh
    if (supabase) {
      supabase
        .from('sweep_queue')
        .delete()
        .eq('email_id', emailId)
        .then(({ error }) => {
          if (error) console.error('Failed to exempt sweep email:', error);
        });
    }
    set(s => ({
      sweepEmails: s.sweepEmails.filter(e => e.id !== emailId),
      undoAction: { type: 'exempt', email, timestamp: Date.now() },
    }));
  },

  undoLastAction: () => {
    const action = get().undoAction;
    if (!action) return;
    if (action.type === 'exempt') {
      set(s => ({
        sweepEmails: [...s.sweepEmails, action.email as SweepEmail].sort((a, b) => a.sweepSeconds - b.sweepSeconds),
        undoAction: null,
      }));
    } else if (action.type === 'archive') {
      const removals = new Set(get()._pendingRemovals);
      removals.delete(action.email.id);
      set(s => ({
        emails: [action.email as Email, ...s.emails],
        undoAction: null,
        _pendingRemovals: removals,
      }));
      fireEmailAction(action.email.id, 'unarchive');
    } else if (action.type === 'delete') {
      const removals = new Set(get()._pendingRemovals);
      removals.delete(action.email.id);
      set(s => ({
        emails: [action.email as Email, ...s.emails],
        undoAction: null,
        _pendingRemovals: removals,
      }));
      // Note: undelete is not straightforward with providers, so we unarchive
      fireEmailAction(action.email.id, 'unarchive');
    } else if (action.type === 'moveToSweep') {
      set(s => ({
        sweepEmails: s.sweepEmails.filter(e => e.id !== action.email.id),
        undoAction: null,
      }));
    }
  },

  clearUndo: () => set({ undoAction: null }),

  toggleSweepRule: (ruleId) => set(s => ({
    sweepRules: s.sweepRules.map(r => r.id === ruleId ? { ...r, enabled: !r.enabled } : r),
  })),

  setSweepDelayHours: (hours) => {
    set({ sweepDelayHours: hours });
    get()._persistSweepDelay?.(hours);
  },

  openSweepRuleEditor: (emailId) => {
    const email = get().emails.find(e => e.id === emailId);
    if (!email) return;
    set({ sweepRuleEditor: {
      emailId,
      sender: email.sender,
      senderEmail: email.senderEmail || '',
      subject: email.subject,
      toEmail: email.toEmail || '',
      columnId: email.columnId || null,
    } });
  },
  openNewSweepRuleEditor: () => {
    set({ sweepRuleEditor: {
      emailId: '',
      sender: '',
      senderEmail: '',
      subject: '',
      toEmail: '',
      columnId: null,
      blank: true,
    } });
  },
  openSweepRuleEditorForRule: (ruleId) => {
    const rule = get().sweepRules.find(r => r.id === ruleId);
    if (!rule) return;
    set({ sweepRuleEditor: {
      emailId: '',
      sender: '',
      senderEmail: '',
      subject: '',
      toEmail: '',
      columnId: null,
      ruleId,
    } });
  },
  openSweepRuleEditorForStream: (columnId) => {
    set({ sweepRuleEditor: {
      emailId: '',
      sender: '',
      senderEmail: '',
      subject: '',
      toEmail: '',
      columnId,
    } });
  },
  closeSweepRuleEditor: () => set({ sweepRuleEditor: null }),
  updateSweepRule: (ruleId, updates) => set(s => ({
    sweepRules: s.sweepRules.map(r => r.id === ruleId ? { ...r, ...updates } : r),
  })),

  openStreamEditorFromEmail: (emailId) => {
    const email = get().emails.find(e => e.id === emailId);
    if (!email) return;
    set({
      streamEditorPrefill: {
        senderEmail: email.senderEmail || '',
        sender: email.sender,
        subject: email.subject,
        toEmail: email.toEmail || '',
      },
      creatingColumn: true,
      editingColumnId: null,
    });
  },

  openCriteriaEditorWithPrefill: (columnId, emailId) => {
    const email = get().emails.find(e => e.id === emailId);
    if (!email) return;
    set({
      streamEditorPrefill: {
        senderEmail: email.senderEmail || '',
        sender: email.sender,
        subject: email.subject,
        toEmail: email.toEmail || '',
      },
      editingColumnId: columnId,
      creatingColumn: false,
    });
  },

  addSweepRule: (rule) => set(s => ({
    sweepRules: [...s.sweepRules, { ...rule, id: `sr-${Date.now()}`, enabled: true }],
  })),

  applySweepAction: (criteria, criteriaLogic, action, delayHours) => {
    const isKeepNewest = action.startsWith('keep_newest_');
    const terminalAction = isKeepNewest ? action.replace('keep_newest_', '') : action;
    set(s => {
      const matching = s.emails.filter(e => emailMatchesCriteria(e, criteria, criteriaLogic));
      const sweepMap = new Map(s.sweepEmails.map(e => [e.id, e]));

      let toSweep = matching;
      if (isKeepNewest && matching.length > 1) {
        const sorted = [...matching].sort((a, b) => b.time - a.time);
        toSweep = sorted.slice(1);
      }

      // Build updated sweep list: replace existing items only if new rule is sooner
      const updatedSweep = [...s.sweepEmails];
      const newItems: SweepEmail[] = [];
      for (const e of toSweep) {
        const emailAgeSec = Math.floor((Date.now() - e.time) / 1000);
        const remainingSec = Math.max(0, delayHours * 3600 - emailAgeSec);
        const existing = sweepMap.get(e.id);
        if (existing) {
          // Replace only if new rule sweeps sooner
          if (remainingSec < existing.sweepSeconds) {
            const idx = updatedSweep.findIndex(s => s.id === e.id);
            if (idx !== -1) updatedSweep[idx] = { ...existing, sweepSeconds: remainingSec, action: terminalAction };
          }
        } else {
          newItems.push({ id: e.id, accountId: e.accountId, sender: e.sender, subject: e.subject, sweepSeconds: remainingSec, exempted: false, action: terminalAction });
        }
      }
      return {
        sweepEmails: [...updatedSweep, ...newItems].sort((a, b) => a.sweepSeconds - b.sweepSeconds),
      };
    });
  },

  addNewEmail: (email) => set(s => ({
    emails: [{ starred: false, ...email } as Email, ...s.emails],
  })),

  removeSweepEmail: (emailId) => {
    const sweep = get().sweepEmails.find(e => e.id === emailId);
    const action = sweep?.action === 'delete' ? 'delete' : 'archive';
    fireEmailAction(emailId, action);
    // Mark the sweep queue row as executed in Supabase so it doesn't reappear
    if (supabase) {
      supabase
        .from('sweep_queue')
        .update({ executed: true })
        .eq('email_id', emailId)
        .then(({ error }) => {
          if (error) console.error('Failed to mark sweep item executed:', error);
        });
    }
    set(s => ({
      sweepEmails: s.sweepEmails.filter(e => e.id !== emailId),
      emails: s.emails.filter(e => e.id !== emailId),
    }));
  },

  tickSweepCountdowns: () => set(s => {
    const updated = s.sweepEmails.map(e => {
      // Skip already-expiring cards
      if (e.expiring) return e;
      const next = Math.max(0, e.sweepSeconds - 1);
      if (next <= 0) {
        // Transition to expiring — mark as read
        const email = s.emails.find(em => em.id === e.id);
        if (email?.unread) fireEmailAction(e.id, 'mark_read');
        return { ...e, sweepSeconds: 0, expiring: true };
      }
      return { ...e, sweepSeconds: next };
    });
    return { sweepEmails: updated };
  }),
}));
