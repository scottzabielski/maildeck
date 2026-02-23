export type Account = {
  id: string;
  name: string;
  email: string;
  color: string;
  provider: string;
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
};

export type Email = {
  id: string;
  columnId: string;
  accountId: string;
  sender: string;
  senderEmail?: string;
  subject: string;
  snippet: string;
  time: number;
  unread: boolean;
  starred: boolean;
  labels?: string[];
};

export type SweepEmail = {
  id: string;
  accountId: string;
  sender: string;
  subject: string;
  sweepSeconds: number;
  exempted: boolean;
};

export type SweepRule = {
  id: string;
  name: string;
  detail: string;
  enabled: boolean;
  sender: string | null;
  action: string;
  delayHours: number;
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

export type UndoAction = {
  type: string;
  email: Email | SweepEmail;
  timestamp: number;
};
