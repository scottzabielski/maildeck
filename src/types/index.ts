export type Account = {
  id: string;
  name: string;
  email: string;
  color: string;
  provider: string;
  syncStatus?: 'idle' | 'syncing' | 'error' | 'never_synced';
  lastSyncedAt?: string | null;
};

export type View = {
  id: string;
  name: string;
};

export type Criterion = {
  field: string;
  op: string;
  value: string;
};

export type Column = {
  id: string;
  name: string;
  icon: string;
  accent: string;
  criteria: Criterion[];
  criteriaLogic: 'and' | 'or';
  enabled: boolean;
};

export type Email = {
  id: string;
  columnId: string;
  accountId: string;
  sender: string;
  senderEmail?: string;
  toEmail?: string;
  subject: string;
  snippet: string;
  time: number;
  unread: boolean;
  starred: boolean;
  labels?: string[];
  /** Came from a mailing list (List-Unsubscribe, List-Id or Precedence headers); null when not known. */
  isBulk?: boolean | null;
};

/** A Claude-checked sweep's state: waiting, cleared to sweep, unsure (held for review), or failed. */
export type ClaudeCheckStatus = 'pending' | 'match' | 'unsure' | 'failed';

export type SweepEmail = {
  id: string;
  accountId: string;
  sender: string;
  subject: string;
  /** When the sweep runs (epoch ms). */
  dueAt: number;
  exempted: boolean;
  action?: string;
  expiring?: boolean;
  /** Set when the rule that queued it has a Claude check. */
  aiStatus?: ClaudeCheckStatus;
  /** Claude's reason, or why the check failed. */
  aiReason?: string | null;
};

/** A sweep rule's Claude check: a plain-English description each match is checked against. */
export type ClaudeCheck = {
  enabled: boolean;
  instruction: string;
  model: string;
  allowDelete: boolean;
};

export type SweepRule = {
  id: string;
  name: string;
  detail: string;
  enabled: boolean;
  criteria: Criterion[];
  criteriaLogic: 'and' | 'or';
  action: string;
  delayHours: number;
  aiCheck?: ClaudeCheck;
};

export type ContextMenuState = {
  x: number;
  y: number;
  emailId: string;
  columnId: string;
};

export type SelectedEmailState = {
  emailId: string;
  sourceColumnId: string;
  sourceAccountId: string;
  viewMode: string;
};

export type HighlightedEmailState = {
  emailId: string;
  columnId: string;
  accountId: string;
};

export type UndoAction = {
  type: string;
  email: Email | Email[] | SweepEmail;
  timestamp: number;
};

export type SuggestionKind = 'duplicate' | 'merge' | 'absorb' | 'redundant' | 'rename' | 'conflict';

export type ProposedRule = {
  name?: string;
  detail?: string;
  criteria?: Criterion[];
  criteriaLogic?: 'and' | 'or';
  action?: string;
  delayHours?: number;
};

export type Suggestion = {
  hash: string;
  kind: SuggestionKind;
  ruleIds: string[];
  proposedRule?: ProposedRule;
  keepRuleId?: string;
  rationale: string;
  confidence: 'high' | 'medium' | 'low';
  source: 'deterministic' | 'llm';
};
