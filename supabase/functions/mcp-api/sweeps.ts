import { CHECK_MODELS, DEFAULT_CHECK_MODEL } from '../_shared/claude.ts';
import { budgetBlock } from '../_shared/claudeCheck.ts';
import {
  type Args,
  type Ctx,
  badRequest,
  defaultDelayHours,
  loadAccounts,
  loadRules,
  oneOf,
  optInt,
  optString,
  optUuid,
  senderLabel,
  uuidList,
} from './common.ts';

const STATUSES = ['pending', 'awaiting_check', 'review', 'check_failed', 'swept', 'exempted'] as const;
const DECISIONS = ['sweep', 'recheck'] as const;

export async function status(ctx: Ctx) {
  const [accounts, delay, rules, streams, summary, usage] = await Promise.all([
    loadAccounts(ctx),
    defaultDelayHours(ctx),
    ctx.admin.from('sweep_rules').select('is_enabled, ai_check_enabled').eq('user_id', ctx.userId),
    ctx.admin.from('columns').select('id', { count: 'exact', head: true }).eq('user_id', ctx.userId),
    ctx.admin.rpc('mcp_sweep_summary', { p_user_id: ctx.userId }),
    ctx.admin.rpc('claude_check_usage', { p_user_id: ctx.userId }),
  ]);
  for (const r of [rules, streams, summary, usage]) if (r.error) throw r.error;
  const ruleRows = (rules.data ?? []) as { is_enabled: boolean; ai_check_enabled: boolean }[];
  const s = ((summary.data ?? [])[0] ?? {}) as Record<string, number>;
  const u = ((usage.data ?? [])[0] ?? {}) as Record<string, number>;
  const spending = {
    spentMonthUsd: Number(u.spent_month_usd ?? 0),
    checks24h: Number(u.checks_24h ?? 0),
    monthlyBudgetUsd: Number(u.monthly_budget_usd ?? 0),
    dailyCheckLimit: Number(u.daily_check_limit ?? 0),
  };
  const configured = !!Deno.env.get('ANTHROPIC_API_KEY');
  const paused = !configured ? 'ANTHROPIC_API_KEY is not set' : budgetBlock(spending, DEFAULT_CHECK_MODEL);
  return {
    accounts: accounts.map((a) => ({
      email: a.email,
      ...(a.display_name && a.display_name !== a.email ? { name: a.display_name } : {}),
      provider: a.provider,
      enabled: a.is_enabled,
      sync_status: a.sync_status,
      ...(a.last_synced_at ? { last_synced_at: a.last_synced_at } : {}),
    })),
    default_delay_hours: delay,
    sweep_rules: {
      total: ruleRows.length,
      enabled: ruleRows.filter((r) => r.is_enabled).length,
      claude_checked: ruleRows.filter((r) => r.is_enabled && r.ai_check_enabled).length,
    },
    streams: streams.count ?? 0,
    sweeps: {
      pending: Number(s.pending ?? 0),
      due_24h: Number(s.due_24h ?? 0),
      overdue: Number(s.overdue ?? 0),
      swept_24h: Number(s.swept_24h ?? 0),
      swept_7d: Number(s.swept_7d ?? 0),
      awaiting_check: Number(s.awaiting_check ?? 0),
      review: Number(s.review ?? 0),
      check_failed: Number(s.check_failed ?? 0),
    },
    claude_checks: {
      spent_this_month_usd: Number(spending.spentMonthUsd.toFixed(4)),
      monthly_budget_usd: spending.monthlyBudgetUsd,
      checks_last_24h: spending.checks24h,
      daily_check_limit: spending.dailyCheckLimit,
      ...(paused ? { paused } : {}),
      models: Object.keys(CHECK_MODELS),
    },
  };
}

interface SweepRow {
  email_id: string;
  sweep_rule_id: string | null;
  scheduled_at: string;
  action: string;
  account_id: string;
  sender_name: string | null;
  sender_email: string | null;
  subject: string;
  received_at: string;
  provider_message_id: string;
  thread_id: string | null;
  ai_status: string | null;
  ai_reason: string | null;
  ai_model: string | null;
  ai_input_tokens: number | null;
  ai_output_tokens: number | null;
  ai_checked_at: string | null;
  ai_attempts: number;
  ai_error: string | null;
  total: number;
}

/** Claude's check on a queued sweep, for listings. */
function claudeView(r: SweepRow) {
  if (!r.ai_status) return undefined;
  if (r.ai_status === 'pending') {
    return {
      verdict: 'awaiting check',
      ...(r.ai_attempts ? { failed_attempts: r.ai_attempts, last_error: r.ai_error } : {}),
    };
  }
  if (r.ai_status === 'failed') {
    return { verdict: 'check failed', failed_attempts: r.ai_attempts, last_error: r.ai_error };
  }
  return {
    verdict: r.ai_status,
    reason: r.ai_reason,
    model: r.ai_model,
    ...(r.ai_input_tokens !== null ? { input_tokens: r.ai_input_tokens, output_tokens: r.ai_output_tokens } : { cached: true }),
    ...(r.ai_checked_at ? { checked_at: r.ai_checked_at } : {}),
  };
}

export async function listSweeps(ctx: Ctx, args: Args) {
  const status = oneOf(args, 'status', STATUSES) ?? 'pending';
  const ruleId = optUuid(args, 'rule_id');
  const query = optString(args, 'query', 100) || null;
  const limit = optInt(args, 'limit', 1, 200) ?? 50;
  const offset = optInt(args, 'offset', 0, 1_000_000) ?? 0;

  const [page, accounts, rules] = await Promise.all([
    ctx.admin.rpc('mcp_list_sweeps', {
      p_user_id: ctx.userId,
      p_status: status,
      p_rule_id: ruleId ?? null,
      p_query: query,
      p_limit: limit,
      p_offset: offset,
    }),
    loadAccounts(ctx),
    loadRules(ctx),
  ]);
  if (page.error) throw page.error;
  const rows = (page.data ?? []) as SweepRow[];
  const accountEmail = new Map(accounts.map((a) => [a.id, a.email]));
  const ruleName = new Map(rules.map((r) => [r.id, r.name]));
  const total = rows.length ? Number(rows[0].total) : offset === 0 ? 0 : undefined;

  return {
    status,
    ...(total !== undefined ? { total } : {}),
    items: rows.map((r) => ({
      email_id: r.email_id,
      rule: r.sweep_rule_id ? { id: r.sweep_rule_id, name: ruleName.get(r.sweep_rule_id) ?? '(deleted rule)' } : null,
      action: r.action,
      scheduled_at: r.scheduled_at,
      sender: senderLabel(r.sender_name, r.sender_email),
      subject: r.subject,
      received_at: r.received_at,
      account: accountEmail.get(r.account_id) ?? r.account_id,
      provider_message_id: r.provider_message_id,
      ...(r.thread_id ? { thread_id: r.thread_id } : {}),
      ...(r.ai_status ? { claude: claudeView(r) } : {}),
    })),
    ...(total !== undefined && offset + rows.length < total ? { next_offset: offset + rows.length } : {}),
  };
}

/**
 * Exempts emails from their pending sweep, like "Exempt from Sweep" in the
 * UI: the queue row is marked executed, so no rule (and no backfill) queues
 * the email again.
 */
export async function exemptSweeps(ctx: Ctx, args: Args) {
  const ids = uuidList(args, 'email_ids', 200);
  const { data, error } = await ctx.admin
    .from('sweep_queue')
    .update({ executed: true })
    .eq('user_id', ctx.userId)
    .eq('executed', false)
    .in('email_id', ids)
    .select('email_id');
  if (error) throw error;
  const exempted = new Set(((data ?? []) as { email_id: string }[]).map((r) => r.email_id));
  return {
    exempted: exempted.size,
    email_ids: [...exempted],
    ...(exempted.size < ids.length ? { not_pending: ids.filter((id) => !exempted.has(id)) } : {}),
  };
}

/**
 * Settles held Claude checks by hand: "sweep" lets messages Claude was unsure
 * about (or couldn't check) sweep on their schedule; "recheck" asks Claude
 * again about messages whose check failed.
 */
export async function resolveSweeps(ctx: Ctx, args: Args) {
  const ids = uuidList(args, 'email_ids', 200);
  const decision = oneOf(args, 'decision', DECISIONS);
  if (!decision) throw badRequest('decision is required: "sweep" or "recheck"');
  const query = ctx.admin.from('sweep_queue');
  const { data, error } = decision === 'sweep'
    ? await query
      .update({ ai_status: 'match', ai_reason: 'Approved by the user', ai_error: null })
      .eq('user_id', ctx.userId)
      .eq('executed', false)
      .in('ai_status', ['unsure', 'failed'])
      .in('email_id', ids)
      .select('email_id')
    : await query
      .update({
        ai_status: 'pending',
        ai_attempts: 0,
        ai_next_attempt_at: new Date().toISOString(),
        ai_error: null,
        ai_claim_id: null,
        ai_claimed_until: null,
      })
      .eq('user_id', ctx.userId)
      .eq('executed', false)
      .eq('ai_status', 'failed')
      .in('email_id', ids)
      .select('email_id');
  if (error) throw error;
  const done = new Set(((data ?? []) as { email_id: string }[]).map((r) => r.email_id));
  return {
    decision,
    updated: done.size,
    email_ids: [...done],
    ...(done.size < ids.length
      ? {
        not_updated: ids.filter((id) => !done.has(id)),
        note: decision === 'sweep'
          ? 'Only messages held for review or whose check failed can be approved.'
          : 'Only messages whose check failed can be rechecked.',
      }
      : {}),
  };
}
