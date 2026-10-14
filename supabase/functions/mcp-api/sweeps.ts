import {
  type Args,
  type Ctx,
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

const STATUSES = ['pending', 'swept', 'exempted'] as const;

export async function status(ctx: Ctx) {
  const [accounts, delay, rules, streams, summary] = await Promise.all([
    loadAccounts(ctx),
    defaultDelayHours(ctx),
    ctx.admin.from('sweep_rules').select('is_enabled').eq('user_id', ctx.userId),
    ctx.admin.from('columns').select('id', { count: 'exact', head: true }).eq('user_id', ctx.userId),
    ctx.admin.rpc('mcp_sweep_summary', { p_user_id: ctx.userId }),
  ]);
  for (const r of [rules, streams, summary]) if (r.error) throw r.error;
  const ruleRows = (rules.data ?? []) as { is_enabled: boolean }[];
  const s = ((summary.data ?? [])[0] ?? {}) as Record<string, number>;
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
    sweep_rules: { total: ruleRows.length, enabled: ruleRows.filter((r) => r.is_enabled).length },
    streams: streams.count ?? 0,
    sweeps: {
      pending: Number(s.pending ?? 0),
      due_24h: Number(s.due_24h ?? 0),
      overdue: Number(s.overdue ?? 0),
      swept_24h: Number(s.swept_24h ?? 0),
      swept_7d: Number(s.swept_7d ?? 0),
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
  total: number;
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
