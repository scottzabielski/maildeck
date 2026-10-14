import {
  type AdminClient,
  type Criterion,
  SERVER_FIELDS,
  UUID_RE,
  normalizeCriteria,
  ruleCriteria,
} from '../_shared/sweepMatching.ts';

/** An error whose message is safe to show the caller (and, through the MCP, the model). */
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const badRequest = (message: string) => new ApiError(400, message);

/**
 * PostgREST couldn't parse a filter built from a rule's criteria: a value
 * saved before mcp-api validated them contains filter syntax (a comma, say).
 */
export function isFilterSyntaxError(err: unknown): boolean {
  return !!err && typeof err === 'object' && /^PGRST1\d\d$/.test(String((err as { code?: unknown }).code));
}

export const FILTER_SYNTAX_MESSAGE =
  "MailDeck can't evaluate this rule: one of its values contains a character its matcher reads as syntax (usually a comma or parenthesis). Change the rule's criteria to remove it.";

export interface Ctx {
  admin: AdminClient;
  userId: string;
}

export type Args = Record<string, unknown>;

// ---- Arguments ---------------------------------------------------------------

/** A trimmed string with control characters and runs of whitespace collapsed. */
export function optString(args: Args, key: string, max: number): string | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') throw badRequest(`${key} must be a string`);
  // deno-lint-ignore no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (s.length > max) throw badRequest(`${key} is limited to ${max} characters`);
  return s;
}

export function reqString(args: Args, key: string, max: number): string {
  const s = optString(args, key, max);
  if (!s) throw badRequest(`${key} is required`);
  return s;
}

export function optBool(args: Args, key: string): boolean | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'boolean') throw badRequest(`${key} must be true or false`);
  return v;
}

export function optInt(args: Args, key: string, min: number, max: number): number | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    throw badRequest(`${key} must be a whole number from ${min} to ${max}`);
  }
  return v;
}

export function oneOf<T extends string>(args: Args, key: string, allowed: readonly T[]): T | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string' || !allowed.includes(v as T)) {
    throw badRequest(`${key} must be one of ${allowed.join(', ')}`);
  }
  return v as T;
}

export function optUuid(args: Args, key: string): string | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string' || !UUID_RE.test(v.trim())) throw badRequest(`${key} must be an id (UUID)`);
  return v.trim().toLowerCase();
}

export function reqUuid(args: Args, key: string): string {
  const v = optUuid(args, key);
  if (!v) throw badRequest(`${key} is required`);
  return v;
}

export function uuidList(args: Args, key: string, max: number): string[] {
  const v = args[key];
  if (!Array.isArray(v) || v.length === 0) throw badRequest(`${key} must be a non-empty list of ids`);
  if (v.length > max) throw badRequest(`${key} takes at most ${max} ids`);
  const ids = v.map((x) => (typeof x === 'string' ? x.trim().toLowerCase() : ''));
  const bad = ids.find((x) => !UUID_RE.test(x));
  if (bad !== undefined) throw badRequest(`${key} must contain only ids (UUIDs)`);
  return [...new Set(ids)];
}

// ---- Criteria ----------------------------------------------------------------

export const RULE_FIELDS = ['from', 'to', 'subject', 'body', 'label', 'stream'] as const;
export const STREAM_FIELDS = ['from', 'to', 'subject', 'body', 'label', 'stream', 'sweep'] as const;
export const MATCH_OPS = ['contains', 'not_contains', 'equals', 'starts_with', 'ends_with'] as const;
export const LOGICS = ['and', 'or'] as const;

// The server matcher interpolates values into PostgREST filter strings, where
// these characters are syntax (and * is a wildcard). The UI never needs them.
const UNSAFE_VALUE = /[,()"*\\]/;

/**
 * Validates criteria from a caller. Stream references are resolved to the
 * stream's id (callers may pass an id or an exact name).
 */
export function criteriaArg(
  raw: unknown,
  fields: readonly string[],
  streams: StreamRow[],
  selfStreamId?: string,
): Criterion[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw badRequest('criteria must be a non-empty list of { field, op, value }');
  }
  if (raw.length > 10) throw badRequest('Use at most 10 criteria');
  return raw.map((c, i) => {
    if (!c || typeof c !== 'object') throw badRequest(`criteria[${i}] must be an object`);
    const { field, op, value } = c as Record<string, unknown>;
    if (typeof field !== 'string' || !fields.includes(field)) {
      throw badRequest(`criteria[${i}].field must be one of ${fields.join(', ')}`);
    }
    if (typeof value !== 'string' || !value.trim()) throw badRequest(`criteria[${i}].value is required`);
    if (field === 'stream') {
      const stream = findStream(streams, value.trim());
      if (stream.id === selfStreamId) throw badRequest("A stream can't include itself");
      return { field, op: 'equals', value: stream.id };
    }
    if (field === 'sweep') {
      const v = value.trim().toLowerCase();
      if (v !== 'has rule' && v !== 'no rule') throw badRequest(`criteria[${i}]: sweep takes "has rule" or "no rule"`);
      return { field, op: 'equals', value: v };
    }
    if (typeof op !== 'string' || !(MATCH_OPS as readonly string[]).includes(op)) {
      throw badRequest(`criteria[${i}].op must be one of ${MATCH_OPS.join(', ')}`);
    }
    // The matchers strip surrounding quotes, so strip them here too.
    const v = value.trim().replace(/^'+|'+$/g, '').trim();
    if (v.length < 2) throw badRequest(`criteria[${i}].value must be at least 2 characters`);
    if (v.length > 200) throw badRequest(`criteria[${i}].value is limited to 200 characters`);
    if (UNSAFE_VALUE.test(v)) {
      throw badRequest(
        `criteria[${i}].value can't contain , ( ) " * or \\ (MailDeck's matcher reads them as syntax). Use a distinctive part of the text without them.`,
      );
    }
    return { field, op, value: v };
  });
}

/** Canonical key for "same criteria" (the UI's duplicate check). */
export function criteriaKey(criteria: Criterion[], logic: string): string {
  const items = criteria
    .filter((c) => c.value.trim())
    .map((c) => `${c.field}|${c.op}|${c.value.trim().toLowerCase()}`)
    .sort();
  return `${logic === 'or' ? 'or' : 'and'}::${items.join('\n')}`;
}

const FIELD_LABELS: Record<string, string> = {
  from: 'From',
  to: 'To',
  subject: 'Subject',
  body: 'Body',
  snippet: 'Body',
  label: 'Label',
  sweep: 'Sweep',
};

/** Human summary, the way MailDeck's settings list shows criteria. */
export function describeCriteria(criteria: Criterion[], logic: string, streams: Map<string, StreamRow>): string {
  return criteria
    .filter((c) => c.value.trim())
    .map((c) => {
      if (c.field === 'stream') return `Stream: "${streamFor(streams, c.value)?.name ?? c.value}"`;
      return `${FIELD_LABELS[c.field] ?? c.field} ${c.op.replace('_', ' ')} "${c.value}"`;
    })
    .join(logic === 'or' ? ' OR ' : ' AND ');
}

export function criteriaView(criteria: Criterion[], streams: Map<string, StreamRow>) {
  return criteria.map((c) =>
    c.field === 'stream'
      ? { field: c.field, op: c.op, value: c.value, stream: streamFor(streams, c.value)?.name ?? '(missing stream)' }
      : { field: c.field, op: c.op, value: c.value },
  );
}

// ---- Streams -----------------------------------------------------------------

export interface StreamRow {
  id: string;
  name: string;
  icon: string;
  accent: string;
  criteria: unknown;
  criteria_logic: string;
  sort_order: number;
  is_enabled: boolean;
}

export const STREAM_COLUMNS = 'id, name, icon, accent, criteria, criteria_logic, sort_order, is_enabled';

export async function loadStreams(ctx: Ctx): Promise<StreamRow[]> {
  const { data, error } = await ctx.admin
    .from('columns')
    .select(STREAM_COLUMNS)
    .eq('user_id', ctx.userId)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return (data ?? []) as StreamRow[];
}

export const byId = <T extends { id: string }>(rows: T[]) => new Map(rows.map((r) => [r.id, r]));

/** A stream by id, or by name for references saved by older versions. */
export function streamFor(streams: Map<string, StreamRow>, ref: string): StreamRow | undefined {
  if (UUID_RE.test(ref)) return streams.get(ref.toLowerCase());
  const lower = ref.toLowerCase();
  return [...streams.values()].find((s) => s.name.toLowerCase() === lower);
}

/** Looks up a stream by id or exact (case-insensitive) name, for caller input. */
export function findStream(streams: StreamRow[], ref: string): StreamRow {
  if (UUID_RE.test(ref)) {
    const s = streams.find((x) => x.id === ref.toLowerCase());
    if (!s) throw badRequest(`No stream with id ${ref}. maildeck_list_streams lists them.`);
    return s;
  }
  const matches = streams.filter((x) => x.name.toLowerCase() === ref.toLowerCase());
  if (matches.length === 0) throw badRequest(`No stream named "${ref}". maildeck_list_streams lists them.`);
  if (matches.length > 1) throw badRequest(`Several streams are named "${ref}"; pass its id instead.`);
  return matches[0];
}

/** Criteria that refer to the stream (by id, or by name in older rules). */
export function refersToStream(criteria: Criterion[], stream: StreamRow): boolean {
  return criteria.some(
    (c) => c.field === 'stream' && (c.value.toLowerCase() === stream.id || c.value.toLowerCase() === stream.name.toLowerCase()),
  );
}

// ---- Sweep rules -------------------------------------------------------------

export interface RuleRow {
  id: string;
  name: string;
  detail: string | null;
  is_enabled: boolean;
  sender_pattern: string | null;
  criteria: unknown;
  criteria_logic: string;
  action: string;
  delay_hours: number;
  created_at: string;
  updated_at: string;
}

export const RULE_COLUMNS =
  'id, name, detail, is_enabled, sender_pattern, criteria, criteria_logic, action, delay_hours, created_at, updated_at';

export async function loadRules(ctx: Ctx): Promise<RuleRow[]> {
  const { data, error } = await ctx.admin
    .from('sweep_rules')
    .select(RULE_COLUMNS)
    .eq('user_id', ctx.userId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as RuleRow[];
}

export async function loadRule(ctx: Ctx, id: string): Promise<RuleRow> {
  const { data, error } = await ctx.admin
    .from('sweep_rules')
    .select(RULE_COLUMNS)
    .eq('id', id)
    .eq('user_id', ctx.userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiError(404, `No sweep rule ${id}. maildeck_list_sweep_rules lists them.`);
  return data as RuleRow;
}

/**
 * Reasons a rule doesn't sweep what MailDeck's UI suggests it does. The
 * server flattens a stream's conditions into the rule and can't evaluate
 * Sweep or nested Stream conditions.
 */
export function ruleProblems(rule: RuleRow, streams: Map<string, StreamRow>): string[] {
  const problems: string[] = [];
  const criteria = ruleCriteria(rule);
  const logic = rule.criteria_logic === 'or' ? 'or' : 'and';
  for (const c of criteria) {
    if (c.field !== 'stream') continue;
    const stream = streamFor(streams, c.value);
    if (!stream) {
      problems.push(`Uses a stream that no longer exists, so ${logic === 'and' ? 'it matches nothing' : 'that condition matches nothing'}.`);
      continue;
    }
    const sc = normalizeCriteria(stream.criteria);
    const unsupported = sc.find((x) => !SERVER_FIELDS.has(x.field));
    if (sc.length === 0) {
      problems.push(`Stream "${stream.name}" has no conditions, so it matches nothing here.`);
    } else if (unsupported) {
      problems.push(
        `Stream "${stream.name}" has a ${unsupported.field} condition, which the server-side sweep can't evaluate${logic === 'and' ? ', so this rule matches nothing' : ''}.`,
      );
    } else if (sc.length > 1 && (stream.criteria_logic === 'or' ? 'or' : 'and') !== logic) {
      problems.push(
        logic === 'and'
          ? `Stream "${stream.name}" matches ANY of its conditions, but this rule (AND) only sweeps mail meeting ALL of them.`
          : `Stream "${stream.name}" needs ALL of its conditions, but this rule (OR) sweeps mail meeting ANY of them, which is more than the stream shows.`,
      );
    }
  }
  if (criteria.some((c) => c.field === 'stream') && criteria.length > 1 && logic === 'and') {
    problems.push(
      "MailDeck's insert trigger skips stream conditions, so new mail is matched on the other conditions alone and can be swept even when it isn't in the stream.",
    );
  }
  return problems;
}

export async function defaultDelayHours(ctx: Ctx): Promise<number> {
  const { data } = await ctx.admin
    .from('profiles')
    .select('default_sweep_delay_hours')
    .eq('id', ctx.userId)
    .maybeSingle();
  const v = Number(data?.default_sweep_delay_hours);
  return Number.isInteger(v) && v >= 0 ? v : 24;
}

// ---- Accounts ----------------------------------------------------------------

export interface AccountRow {
  id: string;
  provider: string;
  email: string;
  display_name: string | null;
  is_enabled: boolean;
  sync_status: string;
  last_synced_at: string | null;
}

export async function loadAccounts(ctx: Ctx): Promise<AccountRow[]> {
  const { data, error } = await ctx.admin
    .from('email_accounts')
    .select('id, provider, email, display_name, is_enabled, sync_status, last_synced_at')
    .eq('user_id', ctx.userId)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return (data ?? []) as AccountRow[];
}

// ---- Misc --------------------------------------------------------------------

export async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** "Name <address>", or whichever of the two exists. */
export function senderLabel(name: string | null, email: string | null): string {
  if (name && email && name.toLowerCase() !== email.toLowerCase()) return `${name} <${email}>`;
  return email || name || '(unknown sender)';
}
