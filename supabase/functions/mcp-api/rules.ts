import {
  type Criterion,
  SERVER_FIELDS,
  applySweepRule,
  normalizeCriteria,
  planSweepRule,
  ruleCriteria,
} from '../_shared/sweepMatching.ts';
import {
  ApiError,
  type Args,
  type Ctx,
  FILTER_SYNTAX_MESSAGE,
  LOGICS,
  RULE_COLUMNS,
  RULE_FIELDS,
  type RuleRow,
  type StreamRow,
  badRequest,
  byId,
  criteriaArg,
  criteriaKey,
  criteriaView,
  defaultDelayHours,
  describeCriteria,
  isFilterSyntaxError,
  loadAccounts,
  loadRule,
  loadRules,
  loadStreams,
  oneOf,
  optBool,
  optInt,
  optString,
  optUuid,
  reqUuid,
  ruleProblems,
  senderLabel,
  sha256Hex,
  streamFor,
} from './common.ts';

export const ACTIONS = ['archive', 'delete', 'keep_newest_archive', 'keep_newest_delete'] as const;
const MAX_DELAY_HOURS = 720;

/** What a rule matches and does: what a preview describes and a confirm token covers. */
interface RuleDef {
  criteria: Criterion[];
  logic: 'and' | 'or';
  action: string;
  delay_hours: number;
}

const isKeepNewest = (action: string) => action.startsWith('keep_newest_');

function currentDef(rule: RuleRow): RuleDef {
  return {
    criteria: ruleCriteria(rule),
    logic: rule.criteria_logic === 'or' ? 'or' : 'and',
    action: rule.action,
    delay_hours: rule.delay_hours,
  };
}

const defKey = (d: RuleDef) =>
  JSON.stringify([d.criteria.map((c) => [c.field, c.op, c.value]), d.logic, d.action, d.delay_hours]);

/** Binds a preview to the exact definition it described and, for edits, the rule being edited. */
const definitionHash = (d: RuleDef, ruleId?: string) => sha256Hex(JSON.stringify([ruleId ?? null, defKey(d)]));

/**
 * The rule definition from args, layered over the existing rule for edits.
 * A stream condition must be the rule's only condition and use only fields
 * the server can evaluate. The rule takes the stream's logic, because the
 * server flattens the stream's conditions into the rule.
 */
async function ruleDefinition(ctx: Ctx, args: Args, existing: RuleRow | null, streams: StreamRow[]): Promise<RuleDef> {
  const base = existing ? currentDef(existing) : null;
  const action = oneOf(args, 'action', ACTIONS) ?? base?.action ?? 'archive';

  let criteria: Criterion[];
  if (args.criteria !== undefined) criteria = criteriaArg(args.criteria, RULE_FIELDS, streams);
  else if (base) criteria = base.criteria;
  else throw badRequest('criteria is required');
  let logic = oneOf(args, 'logic', LOGICS) ?? base?.logic ?? 'and';

  if (args.criteria !== undefined || args.logic !== undefined) {
    const ref = criteria.find((c) => c.field === 'stream');
    if (ref) {
      if (criteria.length > 1) {
        throw badRequest(
          "A stream has to be a sweep rule's only condition (MailDeck matches new mail without it otherwise). Put the stream's conditions in the rule directly instead.",
        );
      }
      const stream = streamFor(byId(streams), ref.value);
      if (!stream) throw badRequest('That stream no longer exists. maildeck_list_streams lists the current ones.');
      const sc = normalizeCriteria(stream.criteria);
      if (sc.length === 0) throw badRequest(`Stream "${stream.name}" has no conditions to sweep by.`);
      const unsupported = sc.find((c) => !SERVER_FIELDS.has(c.field));
      if (unsupported) {
        throw badRequest(
          `Stream "${stream.name}" has a ${unsupported.field} condition, which MailDeck's server-side sweep can't evaluate. Put its other conditions in the rule directly instead.`,
        );
      }
      logic = stream.criteria_logic === 'or' ? 'or' : 'and';
    }
  }

  let delay = 0;
  if (!isKeepNewest(action)) {
    delay = optInt(args, 'delay_hours', 0, MAX_DELAY_HOURS) ??
      (base && !isKeepNewest(base.action) ? base.delay_hours : await defaultDelayHours(ctx));
  }
  return { criteria, logic, action, delay_hours: delay };
}

/** The rule's one-line description, worded like MailDeck's editor. */
function detailFor(d: RuleDef): string {
  if (isKeepNewest(d.action)) return `Keep newest, ${d.action.replace('keep_newest_', '')} rest immediately`;
  return d.action === 'delete' ? `Auto-delete after ${d.delay_hours}h` : `Auto-archive after ${d.delay_hours}h`;
}

function findDuplicate(rules: RuleRow[], d: RuleDef, exceptId?: string): RuleRow | undefined {
  const key = criteriaKey(d.criteria, d.logic);
  return rules.find((r) => r.id !== exceptId && criteriaKey(ruleCriteria(r), r.criteria_logic) === key);
}

function duplicateError(dup: RuleRow): ApiError {
  return new ApiError(
    409,
    `Rule "${dup.name}" (${dup.id}) already has these criteria. Change that one with maildeck_update_sweep_rule instead.`,
  );
}

async function checkExpectedHash(args: Args, d: RuleDef, ruleId?: string): Promise<void> {
  const expected = optString(args, 'expect_hash', 128);
  if (expected && expected !== await definitionHash(d, ruleId)) {
    throw new ApiError(
      409,
      'This rule differs from the one previewed: its criteria, logic, action or delay, or the saved rule, changed since. Preview it again.',
    );
  }
}

function ruleView(rule: RuleRow, streams: Map<string, StreamRow>) {
  const d = currentDef(rule);
  return {
    id: rule.id,
    name: rule.name,
    enabled: rule.is_enabled,
    action: rule.action,
    delay_hours: rule.delay_hours,
    logic: d.logic,
    criteria: criteriaView(d.criteria, streams),
    summary: describeCriteria(d.criteria, d.logic, streams),
    ...(rule.detail ? { detail: rule.detail } : {}),
    created_at: rule.created_at,
    updated_at: rule.updated_at,
  };
}

/** Pending sweeps for one rule: how many, how many are already due, and the next one after that. */
async function queueSummary(ctx: Ctx, ruleId: string) {
  const nowIso = new Date().toISOString();
  const pendingRows = () =>
    ctx.admin
      .from('sweep_queue')
      .select('email_id', { count: 'exact', head: true })
      .eq('user_id', ctx.userId)
      .eq('sweep_rule_id', ruleId)
      .eq('executed', false);
  const [pending, due, next] = await Promise.all([
    pendingRows(),
    pendingRows().lte('scheduled_at', nowIso),
    ctx.admin
      .from('sweep_queue')
      .select('scheduled_at')
      .eq('user_id', ctx.userId)
      .eq('sweep_rule_id', ruleId)
      .eq('executed', false)
      .gt('scheduled_at', nowIso)
      .order('scheduled_at', { ascending: true })
      .limit(1),
  ]);
  for (const r of [pending, due, next]) if (r.error) throw r.error;
  return {
    pending: pending.count ?? 0,
    due_now: due.count ?? 0,
    ...(next.data?.length ? { next_sweep_at: next.data[0].scheduled_at as string } : {}),
  };
}

/** Email ids the rule has queued and not swept yet. */
async function pendingEmailIds(ctx: Ctx, ruleId: string): Promise<string[]> {
  const ids: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await ctx.admin
      .from('sweep_queue')
      .select('email_id')
      .eq('user_id', ctx.userId)
      .eq('sweep_rule_id', ruleId)
      .eq('executed', false)
      .order('email_id')
      .range(offset, offset + 999);
    if (error) throw error;
    ids.push(...(data ?? []).map((r: { email_id: string }) => r.email_id));
    if (!data || data.length < 1000) return ids;
  }
}

/** Queues a saved rule's matches. If MailDeck can't evaluate the rule it stays saved, and the reason comes back. */
async function applySaved(ctx: Ctx, row: RuleRow): Promise<{ queued: number; queue_error?: string }> {
  try {
    return { queued: await applySweepRule(ctx.admin, ctx.userId, row) };
  } catch (err) {
    if (isFilterSyntaxError(err)) return { queued: 0, queue_error: FILTER_SYNTAX_MESSAGE };
    throw err;
  }
}

/** Removes the rule's pending sweeps. Emails other rules match are re-queued by the hourly backfill. */
async function cancelPending(ctx: Ctx, ruleId: string): Promise<number> {
  const { count, error } = await ctx.admin
    .from('sweep_queue')
    .delete({ count: 'exact' })
    .eq('user_id', ctx.userId)
    .eq('sweep_rule_id', ruleId)
    .eq('executed', false);
  if (error) throw error;
  return count ?? 0;
}

interface PreviewEmail {
  id: string;
  received_at: string;
  sender_name: string | null;
  sender_email: string | null;
  subject: string;
  account_id: string;
}

const PREVIEW_COLUMNS = 'id, received_at, sender_name, sender_email, subject, account_id';

/**
 * What saving this definition would do to mail already in the inbox, using
 * the same planner apply-sweep-rule uses. For an edit (ruleId), the rule's
 * current pending sweeps count as cleared, since saving re-queues them.
 */
async function previewDefinition(ctx: Ctx, d: RuleDef, ruleId: string | undefined, streams: Map<string, StreamRow>) {
  const rule = {
    id: ruleId ?? 'preview',
    criteria: d.criteria,
    criteria_logic: d.logic,
    action: d.action,
    delay_hours: d.delay_hours,
    sender_pattern: null,
  };
  const [plan, accounts, inbox, currentPending] = await Promise.all([
    planSweepRule<PreviewEmail>(ctx.admin, ctx.userId, rule, { columns: PREVIEW_COLUMNS, ignorePendingOf: ruleId }),
    loadAccounts(ctx),
    ctx.admin
      .from('emails')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', ctx.userId)
      .eq('is_archived', false)
      .eq('is_deleted', false),
    ruleId ? pendingEmailIds(ctx, ruleId) : Promise.resolve([] as string[]),
  ]);
  if (inbox.error) throw inbox.error;
  const accountEmail = new Map(accounts.map((a) => [a.id, a.email]));
  const inboxTotal = inbox.count ?? 0;
  const head = {
    rule: {
      criteria: criteriaView(d.criteria, streams),
      logic: d.logic,
      action: d.action,
      delay_hours: d.delay_hours,
      summary: describeCriteria(d.criteria, d.logic, streams),
    },
    inbox_total: inboxTotal,
  };
  if (!plan) {
    return {
      ...head,
      matches: 0,
      would_queue: 0,
      due_now: 0,
      ...(ruleId ? { cancels: currentPending.length } : {}),
      warnings: [
        "This rule matches nothing: one of its conditions can't be evaluated on the server (a missing or empty stream, or a Sweep condition).",
      ],
    };
  }

  const now = Date.now();
  const sweepsAt = (e: PreviewEmail) => plan.scheduledAt.get(e.id)!;
  const eligibleIds = new Set(plan.eligible.map((e) => e.id));
  const later = plan.eligible
    .filter((e) => Date.parse(sweepsAt(e)) > now)
    .sort((a, b) => Date.parse(sweepsAt(a)) - Date.parse(sweepsAt(b)));
  const emailView = (e: PreviewEmail) => ({
    sender: senderLabel(e.sender_name, e.sender_email),
    subject: e.subject,
    received_at: e.received_at,
    account: accountEmail.get(e.account_id) ?? e.account_id,
  });

  const senders = new Map<string, { sender: string; count: number }>();
  const perAccount = new Map<string, number>();
  for (const e of plan.eligible) {
    const key = (e.sender_email || e.sender_name || '').toLowerCase();
    const s = senders.get(key) ?? { sender: senderLabel(e.sender_name, e.sender_email), count: 0 };
    s.count++;
    senders.set(key, s);
    perAccount.set(e.account_id, (perAccount.get(e.account_id) ?? 0) + 1);
  }

  const warnings: string[] = [];
  if (d.criteria.every((c) => c.op === 'not_contains')) {
    warnings.push('Every condition is "not contains", so this matches nearly everything else.');
  }
  if (inboxTotal >= 20 && plan.matches.length > inboxTotal / 2) {
    warnings.push(`Matches ${Math.round((100 * plan.matches.length) / inboxTotal)}% of the inbox.`);
  }
  if (d.criteria.some((c) => c.field === 'stream')) {
    warnings.push("New mail for a stream-based rule is queued by MailDeck's hourly backfill, not the instant trigger.");
  }

  return {
    ...head,
    matches: plan.matches.length,
    would_queue: plan.eligible.length,
    due_now: plan.eligible.length - later.length,
    ...(later.length ? { next_sweep_at: sweepsAt(later[0]) } : {}),
    ...(plan.replaced.size ? { moves_up: [...plan.replaced.keys()].filter((id) => eligibleIds.has(id)).length } : {}),
    ...(plan.keptPending.size ? { already_queued_sooner: plan.keptPending.size } : {}),
    ...(plan.done.size ? { already_swept_or_exempted: plan.done.size } : {}),
    ...(plan.keeper ? { keeps: emailView(plan.keeper) } : {}),
    ...(ruleId ? { cancels: currentPending.filter((id) => !eligibleIds.has(id)).length } : {}),
    top_senders: [...senders.values()].sort((a, b) => b.count - a.count).slice(0, 10),
    by_account: [...perAccount]
      .map(([id, count]) => ({ account: accountEmail.get(id) ?? id, count }))
      .sort((a, b) => b.count - a.count),
    samples: [...plan.eligible]
      .sort((a, b) => Date.parse(b.received_at) - Date.parse(a.received_at))
      .slice(0, 10)
      .map((e) => ({ ...emailView(e), sweeps_at: sweepsAt(e) })),
    ...(warnings.length ? { warnings } : {}),
  };
}

// ---- Ops ---------------------------------------------------------------------

export async function listRules(ctx: Ctx, args: Args) {
  const query = optString(args, 'query', 100)?.toLowerCase();
  const [rules, streams, stats, delay] = await Promise.all([
    loadRules(ctx),
    loadStreams(ctx),
    ctx.admin.rpc('mcp_sweep_rule_stats', { p_user_id: ctx.userId }),
    defaultDelayHours(ctx),
  ]);
  if (stats.error) throw stats.error;
  const streamsById = byId(streams);
  type Stats = { rule_id: string; pending: number; next_sweep_at: string | null; swept_7d: number; swept_30d: number; last_swept_at: string | null };
  const statsByRule = new Map(((stats.data ?? []) as Stats[]).map((s) => [s.rule_id, s]));

  const groups = new Map<string, RuleRow[]>();
  for (const r of rules) {
    const key = criteriaKey(ruleCriteria(r), r.criteria_logic);
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const sameCriteria = [...groups.values()].filter((g) => g.length > 1);

  const views = rules.map((r) => {
    const s = statsByRule.get(r.id);
    const problems = ruleProblems(r, streamsById);
    return {
      ...ruleView(r, streamsById),
      pending: Number(s?.pending ?? 0),
      ...(s?.next_sweep_at ? { next_sweep_at: s.next_sweep_at } : {}),
      swept_7d: Number(s?.swept_7d ?? 0),
      swept_30d: Number(s?.swept_30d ?? 0),
      ...(s?.last_swept_at ? { last_swept_at: s.last_swept_at } : {}),
      ...(problems.length ? { problems } : {}),
    };
  });
  const shown = query
    ? views.filter((v) => v.name.toLowerCase().includes(query) || v.summary.toLowerCase().includes(query))
    : views;

  return {
    default_delay_hours: delay,
    total: rules.length,
    enabled: rules.filter((r) => r.is_enabled).length,
    ...(query ? { matching_query: shown.length } : {}),
    rules: shown,
    ...(sameCriteria.length
      ? { same_criteria: sameCriteria.map((g) => g.map((r) => ({ id: r.id, name: r.name, action: r.action }))) }
      : {}),
  };
}

export async function previewRule(ctx: Ctx, args: Args) {
  const ruleId = optUuid(args, 'rule_id');
  const [streams, rules, existing] = await Promise.all([
    loadStreams(ctx),
    loadRules(ctx),
    ruleId ? loadRule(ctx, ruleId) : Promise.resolve(null),
  ]);
  const d = await ruleDefinition(ctx, args, existing, streams);
  const preview = await previewDefinition(ctx, d, ruleId, byId(streams));
  const dup = findDuplicate(rules, d, ruleId);
  const warnings = [
    ...(preview.warnings ?? []),
    ...(dup ? [`Rule "${dup.name}" (${dup.id}) already has these criteria, so saving this would be refused.`] : []),
  ];
  return {
    ...(existing
      ? {
        rule_id: existing.id,
        name: existing.name,
        enabled: existing.is_enabled,
        changes_definition: defKey(d) !== defKey(currentDef(existing)),
      }
      : {}),
    ...preview,
    ...(warnings.length ? { warnings } : { warnings: undefined }),
    definition_hash: await definitionHash(d, ruleId),
  };
}

export async function createRule(ctx: Ctx, args: Args) {
  const [streams, rules] = await Promise.all([loadStreams(ctx), loadRules(ctx)]);
  const d = await ruleDefinition(ctx, args, null, streams);
  const dup = findDuplicate(rules, d);
  if (dup) throw duplicateError(dup);
  await checkExpectedHash(args, d);

  const streamsById = byId(streams);
  const enabled = optBool(args, 'enabled') ?? true;
  const name = optString(args, 'name', 60) || describeCriteria(d.criteria, d.logic, streamsById).slice(0, 120) || 'Untitled rule';
  const { data, error } = await ctx.admin
    .from('sweep_rules')
    .insert({
      user_id: ctx.userId,
      name,
      detail: detailFor(d),
      is_enabled: enabled,
      sender_pattern: null,
      criteria: d.criteria,
      criteria_logic: d.logic,
      action: d.action,
      delay_hours: d.delay_hours,
    })
    .select(RULE_COLUMNS)
    .single();
  if (error) throw error;
  const row = data as RuleRow;

  // Queue matching mail already in the inbox, as the editor does after saving.
  const applied = enabled ? await applySaved(ctx, row) : { queued: 0 };
  return { rule: ruleView(row, streamsById), ...applied, ...(await queueSummary(ctx, row.id)) };
}

export async function updateRule(ctx: Ctx, args: Args) {
  const ruleId = reqUuid(args, 'rule_id');
  const [existing, streams, rules] = await Promise.all([loadRule(ctx, ruleId), loadStreams(ctx), loadRules(ctx)]);
  const streamsById = byId(streams);
  const d = await ruleDefinition(ctx, args, existing, streams);
  const matchChanged = defKey(d) !== defKey(currentDef(existing));
  if (matchChanged) {
    const dup = findDuplicate(rules, d, ruleId);
    if (dup) throw duplicateError(dup);
  }
  await checkExpectedHash(args, d, ruleId);

  const name = optString(args, 'name', 60);
  if (name !== undefined && !name) throw badRequest("name can't be empty");
  const enabled = optBool(args, 'enabled') ?? existing.is_enabled;
  const keepPending = optBool(args, 'keep_pending') ?? false;

  const updates: Record<string, unknown> = {};
  if (name !== undefined && name !== existing.name) updates.name = name;
  if (enabled !== existing.is_enabled) updates.is_enabled = enabled;
  if (matchChanged) {
    Object.assign(updates, {
      criteria: d.criteria,
      criteria_logic: d.logic,
      action: d.action,
      delay_hours: d.delay_hours,
      detail: detailFor(d),
      sender_pattern: null,
    });
  }
  const before = ruleView(existing, streamsById);
  if (Object.keys(updates).length === 0) {
    return { rule: before, changed: false, ...(await queueSummary(ctx, ruleId)) };
  }

  const pendingBefore = (await queueSummary(ctx, ruleId)).pending;
  const { data, error } = await ctx.admin
    .from('sweep_rules')
    .update(updates)
    .eq('id', ruleId)
    .eq('user_id', ctx.userId)
    .select(RULE_COLUMNS)
    .single();
  if (error) throw error;
  const row = data as RuleRow;

  let cancelled = 0;
  let requeued: number | undefined;
  let queueError: string | undefined;
  if (!enabled) {
    // Pausing stops the rule's pending sweeps too (unless asked to let them finish).
    if (existing.is_enabled && !keepPending) cancelled = await cancelPending(ctx, ruleId);
  } else if (matchChanged || !existing.is_enabled) {
    // Start the rule's queue over so pending sweeps follow the new definition.
    cancelled = await cancelPending(ctx, ruleId);
    const applied = await applySaved(ctx, row);
    requeued = applied.queued;
    queueError = applied.queue_error;
  }

  return {
    before,
    rule: ruleView(row, streamsById),
    changed: true,
    pending_before: pendingBefore,
    ...(requeued !== undefined ? { requeued } : { cancelled }),
    ...(queueError ? { queue_error: queueError } : {}),
    ...(await queueSummary(ctx, ruleId)),
  };
}

export async function deleteRule(ctx: Ctx, args: Args) {
  const ruleId = reqUuid(args, 'rule_id');
  const [existing, streams] = await Promise.all([loadRule(ctx, ruleId), loadStreams(ctx)]);
  const keepPending = optBool(args, 'keep_pending') ?? false;

  // Cancel first: deleting the rule would orphan its pending rows (sweep_rule_id
  // is set null), and orphaned rows still get swept.
  const cancelled = keepPending ? 0 : await cancelPending(ctx, ruleId);
  const stillPending = keepPending ? (await queueSummary(ctx, ruleId)).pending : 0;
  const { error } = await ctx.admin.from('sweep_rules').delete().eq('id', ruleId).eq('user_id', ctx.userId);
  if (error) throw error;

  return {
    deleted: ruleView(existing, byId(streams)),
    cancelled,
    ...(keepPending ? { still_pending: stillPending } : {}),
  };
}
