-- ============================================================
-- MailDeck: Claude checks on sweep rules, and the bulk-mail flag
-- ============================================================
-- 1. emails.is_bulk: whether a message came from a mailing list
--    (List-Unsubscribe, List-Id, or Precedence: bulk/list headers).
--    sync-emails sets it; mail synced before this migration stays null
--    until a Claude check reads its headers. Rules match it with
--    "bulk equals true/false", and null (not known) matches neither.
--
-- 2. sweep_rules.ai_*: an optional plain-English condition that Claude
--    checks on each message the rule's regular conditions match, before
--    the message can be swept. A Claude-checked rule may only archive
--    unless ai_allow_delete is set.
--
-- 3. sweep_queue.ai_*: a sweep queued by a Claude-checked rule waits with
--    ai_status 'pending' until sweep-check records a verdict:
--      match    → sweeps on its normal schedule
--      no_match → exempted (executed, stays in the inbox), never rechecked
--      unsure   → held for review (the Review stream), never swept
--      failed   → three failed attempts; held, marked "check failed"
--    sweep-execute only runs rows whose ai_status is null or 'match'.
--    A trigger sets 'pending' on every row a Claude-checked rule queues,
--    whichever code path queues it.
--
-- 4. sweep_ai_checks: one row per Claude call. It's the verdict cache
--    (one verdict per message per question) and the spend log behind the
--    monthly budget and daily check limit.
--
-- 5. profiles.ai_monthly_budget_usd / ai_daily_check_limit: when either is
--    reached, checking stops and queued sweeps keep waiting.

-- ------------------------------------------------------------
-- 1. Bulk flag
-- ------------------------------------------------------------
alter table public.emails add column if not exists is_bulk boolean;

comment on column public.emails.is_bulk is
  'Mailing-list headers present (List-Unsubscribe, List-Id, Precedence: bulk/list). Null = not known.';

-- The per-criterion matcher used by the insert trigger, now with "bulk".
-- Unchanged otherwise (migration 012).
create or replace function public._sweep_criterion_matches(
  p_email public.emails,
  p_criterion jsonb
) returns boolean
language plpgsql
stable
as $$
declare
  v_field  text := coalesce(p_criterion->>'field', '');
  v_op     text := coalesce(p_criterion->>'op', '');
  v_value  text := coalesce(p_criterion->>'value', '');
  v_pat    text;
  v_is_not boolean := (v_op = 'not_contains');
  v_hit    boolean;
begin
  -- "bulk" compares a flag, not text: true/false, and an unknown flag
  -- matches neither.
  if v_field = 'bulk' then
    return coalesce(p_email.is_bulk = (lower(btrim(v_value)) in ('true', 'yes')), false);
  end if;

  -- Strip surrounding quotes, mirroring buildIlikePattern() in the edge fn
  v_value := regexp_replace(v_value, '^[''"]+|[''"]+$', '', 'g');

  v_pat := case v_op
    when 'contains'     then '%' || v_value || '%'
    when 'not_contains' then '%' || v_value || '%'
    when 'equals'       then v_value
    when 'starts_with'  then v_value || '%'
    when 'ends_with'    then '%' || v_value
    else '%' || v_value || '%'
  end;

  v_hit := case v_field
    when 'from' then
      coalesce(p_email.sender_name, '') ilike v_pat
      or coalesce(p_email.sender_email, '') ilike v_pat
    when 'to' then
      coalesce(p_email.recipients::text, '') ilike v_pat
    when 'subject' then
      coalesce(p_email.subject, '') ilike v_pat
    when 'body' then
      coalesce(p_email.snippet, '') ilike v_pat
    when 'snippet' then
      coalesce(p_email.snippet, '') ilike v_pat
    when 'label' then
      coalesce(p_email.labels::text, '') ilike v_pat
    -- "stream" criteria are only resolved in the edge function path;
    -- triggers ignore them to avoid cross-table recursion on insert.
    else false
  end;

  -- Collapse any residual NULL into false so the caller never sees a
  -- three-valued-logic surprise.
  v_hit := coalesce(v_hit, false);

  if v_is_not then
    return not v_hit;
  end if;
  return v_hit;
end;
$$;

-- ------------------------------------------------------------
-- 2. Claude check settings on rules
-- ------------------------------------------------------------
alter table public.sweep_rules
  add column ai_check_enabled boolean not null default false,
  add column ai_instruction text,
  add column ai_model text not null default 'claude-haiku-5-5',
  add column ai_allow_delete boolean not null default false;

alter table public.sweep_rules
  add constraint sweep_rules_ai_instruction_check
    check (not ai_check_enabled or char_length(btrim(coalesce(ai_instruction, ''))) between 10 and 1000),
  add constraint sweep_rules_ai_archive_only
    check (not ai_check_enabled or ai_allow_delete or action in ('archive', 'keep_newest_archive'));

comment on column public.sweep_rules.ai_instruction is
  'Plain-English description of the mail this rule should sweep; Claude checks each match against it.';

-- ------------------------------------------------------------
-- 3. Check state on queued sweeps
-- ------------------------------------------------------------
alter table public.sweep_queue
  add column ai_status text check (ai_status in ('pending', 'match', 'no_match', 'unsure', 'failed')),
  add column ai_reason text,
  add column ai_model text,
  add column ai_input_tokens integer,
  add column ai_output_tokens integer,
  add column ai_cost_usd numeric(12, 6),
  add column ai_checked_at timestamptz,
  add column ai_attempts smallint not null default 0,
  add column ai_next_attempt_at timestamptz,
  add column ai_error text,
  add column ai_claim_id uuid,
  add column ai_claimed_until timestamptz;

create index idx_sweep_queue_ai_due on public.sweep_queue (ai_next_attempt_at)
  where ai_status = 'pending' and not executed;

-- Every row a Claude-checked rule queues starts out waiting for its check.
-- Runs for all writers: the insert trigger, the edge functions' upserts, the
-- app. On an update the state is kept unless the row moves to another rule
-- (a sooner rule winning it); a deleted rule sets sweep_rule_id null, and
-- the row keeps its state so a held sweep can't turn into a plain one.
create or replace function public.sweep_queue_ai_guard()
returns trigger
language plpgsql
as $$
declare
  v_ai boolean;
begin
  if tg_op = 'UPDATE'
     and (new.sweep_rule_id is not distinct from old.sweep_rule_id or new.sweep_rule_id is null) then
    return new;
  end if;

  select r.ai_check_enabled into v_ai from public.sweep_rules r where r.id = new.sweep_rule_id;
  new.ai_status := case when coalesce(v_ai, false) then 'pending' end;
  new.ai_attempts := 0;
  new.ai_next_attempt_at := case when coalesce(v_ai, false) then now() end;
  new.ai_reason := null;
  new.ai_model := null;
  new.ai_input_tokens := null;
  new.ai_output_tokens := null;
  new.ai_cost_usd := null;
  new.ai_checked_at := null;
  new.ai_error := null;
  new.ai_claim_id := null;
  new.ai_claimed_until := null;
  return new;
end;
$$;

create trigger trg_sweep_queue_ai_guard
  before insert or update on public.sweep_queue
  for each row execute function public.sweep_queue_ai_guard();

-- Turning a rule's check on or off, or changing its question or model,
-- restarts the check for everything it has queued and not swept: with the
-- check on they wait for a new verdict, with it off they sweep as usual.
create or replace function public.sweep_rules_ai_changed()
returns trigger
language plpgsql
as $$
begin
  if (new.ai_check_enabled, coalesce(btrim(new.ai_instruction), ''), new.ai_model)
     is distinct from (old.ai_check_enabled, coalesce(btrim(old.ai_instruction), ''), old.ai_model) then
    update public.sweep_queue q
       set ai_status = case when new.ai_check_enabled then 'pending' end,
           ai_attempts = 0,
           ai_next_attempt_at = case when new.ai_check_enabled then now() end,
           ai_reason = null, ai_model = null, ai_input_tokens = null, ai_output_tokens = null,
           ai_cost_usd = null, ai_checked_at = null, ai_error = null,
           ai_claim_id = null, ai_claimed_until = null
     where q.sweep_rule_id = new.id
       and not q.executed;
  end if;
  return null;
end;
$$;

create trigger trg_sweep_rules_ai_changed
  after update of ai_check_enabled, ai_instruction, ai_model on public.sweep_rules
  for each row execute function public.sweep_rules_ai_changed();

-- The first Claude-checked rule gets the user a Review stream: messages
-- Claude was unsure about, and ones whose check failed.
create or replace function public.ensure_claude_review_stream()
returns trigger
language plpgsql
as $$
begin
  if new.ai_check_enabled
     and (tg_op = 'INSERT' or not old.ai_check_enabled)
     and not exists (
       select 1 from public.columns c
       where c.user_id = new.user_id
         and c.criteria @> '[{"field": "sweep", "value": "needs review"}]'
     ) then
    insert into public.columns (user_id, name, icon, accent, criteria, criteria_logic, sort_order)
    values (
      new.user_id, 'Review', '🤔', '#d97706',
      '[{"field": "sweep", "op": "equals", "value": "needs review"},
        {"field": "sweep", "op": "equals", "value": "check failed"}]'::jsonb,
      'or',
      coalesce((select max(c.sort_order) + 1 from public.columns c where c.user_id = new.user_id), 0)
    );
  end if;
  return null;
end;
$$;

create trigger trg_ensure_claude_review_stream
  after insert or update of ai_check_enabled on public.sweep_rules
  for each row execute function public.ensure_claude_review_stream();

-- ------------------------------------------------------------
-- 4. Claude calls: verdict cache and spend log
-- ------------------------------------------------------------
create table public.sweep_ai_checks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  -- Set null when the email or rule goes, so the spend history stays.
  email_id uuid references public.emails(id) on delete set null,
  rule_id uuid references public.sweep_rules(id) on delete set null,
  -- SHA-256 of [model, instruction]: the same question about the same
  -- message is answered once.
  check_hash text not null,
  model text not null,
  source text not null check (source in ('sweep', 'preview', 'draft')),
  verdict text check (verdict in ('match', 'no_match', 'unsure')),  -- null: the call failed
  reason text,
  error text,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  created_at timestamptz not null default now()
);

create unique index sweep_ai_checks_verdict_cache
  on public.sweep_ai_checks (email_id, check_hash) where verdict is not null;
create index sweep_ai_checks_user_time on public.sweep_ai_checks (user_id, created_at desc);

alter table public.sweep_ai_checks enable row level security;
create policy "Users can view their own Claude checks"
  on public.sweep_ai_checks for select
  using (auth.uid() = user_id);

comment on table public.sweep_ai_checks is
  'Every Claude call MailDeck makes: the per-message verdict cache and the spend log behind the budget.';

-- ------------------------------------------------------------
-- 5. Budget
-- ------------------------------------------------------------
alter table public.profiles
  add column ai_monthly_budget_usd numeric(8, 2) not null default 20
    check (ai_monthly_budget_usd >= 0 and ai_monthly_budget_usd <= 1000),
  add column ai_daily_check_limit integer not null default 500
    check (ai_daily_check_limit >= 0 and ai_daily_check_limit <= 20000);

-- Spend this calendar month (UTC) and checks in the last 24 hours.
create or replace function public.claude_check_usage(p_user_id uuid)
returns table (
  spent_month_usd numeric,
  checks_24h bigint,
  monthly_budget_usd numeric,
  daily_check_limit integer
)
language sql
stable
set search_path = public
as $$
  select
    coalesce((select sum(c.cost_usd) from public.sweep_ai_checks c
              where c.user_id = p_user_id
                and c.created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc'), 0),
    (select count(*) from public.sweep_ai_checks c
      where c.user_id = p_user_id
        and c.source in ('sweep', 'preview')
        and c.created_at > now() - interval '24 hours'),
    p.ai_monthly_budget_usd,
    p.ai_daily_check_limit
  from public.profiles p
  where p.id = p_user_id;
$$;

-- The same for the signed-in user (the app's settings screen).
create or replace function public.my_claude_check_usage()
returns table (
  spent_month_usd numeric,
  checks_24h bigint,
  monthly_budget_usd numeric,
  daily_check_limit integer
)
language sql
stable
security definer
set search_path = public
as $$
  select * from public.claude_check_usage(auth.uid());
$$;

-- Claims due checks for one run of sweep-check. A claim lasts a few
-- minutes, so a run that dies releases its rows; each row's writes are
-- conditioned on its claim id, so a verdict for a row that was reset in
-- the meantime (a rule edit, an exemption) is dropped.
create or replace function public.claim_sweep_checks(p_limit integer, p_lease_seconds integer default 300)
returns table (
  queue_id uuid,
  user_id uuid,
  email_id uuid,
  sweep_rule_id uuid,
  ai_attempts smallint,
  claim_id uuid
)
language sql
volatile
set search_path = public
as $$
  with claim as (
    select gen_random_uuid() as id   -- one id for the batch (a CTE runs once)
  ),
  due as (
    select q.id
    from public.sweep_queue q
    where q.ai_status = 'pending'
      and not q.executed
      and coalesce(q.ai_next_attempt_at, '-infinity') <= now()
      and coalesce(q.ai_claimed_until, '-infinity') < now()
    order by q.ai_next_attempt_at nulls first, q.scheduled_at
    limit greatest(p_limit, 0)
    for update skip locked
  )
  update public.sweep_queue q
     set ai_claim_id = (select id from claim),
         ai_claimed_until = now() + make_interval(secs => p_lease_seconds)
    from due
   where q.id = due.id
  returning q.id, q.user_id, q.email_id, q.sweep_rule_id, q.ai_attempts, q.ai_claim_id;
$$;

-- ------------------------------------------------------------
-- mcp-api read functions, now with check state. Their result types
-- change, so they're dropped and recreated.
-- ------------------------------------------------------------
drop function if exists public.mcp_sweep_rule_stats(uuid);
drop function if exists public.mcp_sweep_summary(uuid);
drop function if exists public.mcp_list_sweeps(uuid, text, uuid, text, integer, integer);

-- "pending" counts sweeps that will run (no check, or Claude said match).
create function public.mcp_sweep_rule_stats(p_user_id uuid)
returns table (
  rule_id uuid,
  pending bigint,
  next_sweep_at timestamptz,
  swept_7d bigint,
  swept_30d bigint,
  last_swept_at timestamptz,
  awaiting_check bigint,
  review bigint,
  check_failed bigint,
  claude_exempted bigint
)
language sql
stable
set search_path = public
as $$
  select
    q.sweep_rule_id,
    count(*) filter (where not q.executed and (q.ai_status is null or q.ai_status = 'match')),
    min(q.scheduled_at) filter (where not q.executed and (q.ai_status is null or q.ai_status = 'match')),
    count(*) filter (where q.executed and (e.is_archived or e.is_deleted)
                       and q.scheduled_at > now() - interval '7 days' and q.scheduled_at <= now()),
    count(*) filter (where q.executed and (e.is_archived or e.is_deleted)
                       and q.scheduled_at > now() - interval '30 days' and q.scheduled_at <= now()),
    max(q.scheduled_at) filter (where q.executed and (e.is_archived or e.is_deleted) and q.scheduled_at <= now()),
    count(*) filter (where not q.executed and q.ai_status = 'pending'),
    count(*) filter (where not q.executed and q.ai_status = 'unsure'),
    count(*) filter (where not q.executed and q.ai_status = 'failed'),
    count(*) filter (where q.executed and q.ai_status = 'no_match')
  from public.sweep_queue q
  join public.emails e on e.id = q.email_id
  where q.user_id = p_user_id
    and q.sweep_rule_id is not null
  group by q.sweep_rule_id;
$$;

-- "overdue" counts sweeps that should have run more than 15 minutes ago;
-- sweeps waiting on Claude or held for review aren't overdue.
create function public.mcp_sweep_summary(p_user_id uuid)
returns table (
  pending bigint,
  due_24h bigint,
  overdue bigint,
  swept_24h bigint,
  swept_7d bigint,
  awaiting_check bigint,
  review bigint,
  check_failed bigint
)
language sql
stable
set search_path = public
as $$
  select
    count(*) filter (where not q.executed and (q.ai_status is null or q.ai_status = 'match')),
    count(*) filter (where not q.executed and (q.ai_status is null or q.ai_status = 'match')
                       and q.scheduled_at <= now() + interval '24 hours'),
    count(*) filter (where not q.executed and (q.ai_status is null or q.ai_status = 'match')
                       and q.scheduled_at < now() - interval '15 minutes'),
    count(*) filter (where q.executed and (e.is_archived or e.is_deleted)
                       and q.scheduled_at > now() - interval '24 hours' and q.scheduled_at <= now()),
    count(*) filter (where q.executed and (e.is_archived or e.is_deleted)
                       and q.scheduled_at > now() - interval '7 days' and q.scheduled_at <= now()),
    count(*) filter (where not q.executed and q.ai_status = 'pending'),
    count(*) filter (where not q.executed and q.ai_status = 'unsure'),
    count(*) filter (where not q.executed and q.ai_status = 'failed')
  from public.sweep_queue q
  join public.emails e on e.id = q.email_id
  where q.user_id = p_user_id;
$$;

-- One page of the sweep queue with each email's details.
--   pending        — will sweep (no check, or Claude said match), soonest first
--   awaiting_check — waiting for Claude's check, soonest first
--   review         — Claude was unsure; held, soonest first
--   check_failed   — the check failed three times; held, soonest first
--   swept          — executed and the email is archived/deleted, newest first
--   exempted       — executed but the email is still in the inbox (exempted
--                    by the user, or by Claude's no_match), newest first
-- p_query matches sender name, sender address or subject as plain,
-- case-insensitive text (no wildcards).
create function public.mcp_list_sweeps(
  p_user_id uuid,
  p_status text,
  p_rule_id uuid default null,
  p_query text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  email_id uuid,
  sweep_rule_id uuid,
  scheduled_at timestamptz,
  action text,
  account_id uuid,
  sender_name text,
  sender_email text,
  subject text,
  received_at timestamptz,
  provider_message_id text,
  thread_id text,
  ai_status text,
  ai_reason text,
  ai_model text,
  ai_input_tokens integer,
  ai_output_tokens integer,
  ai_checked_at timestamptz,
  ai_attempts smallint,
  ai_error text,
  total bigint
)
language sql
stable
set search_path = public
as $$
  with q as (
    select
      s.email_id, s.sweep_rule_id, s.scheduled_at, s.action,
      e.account_id, e.sender_name, e.sender_email, e.subject, e.received_at,
      e.provider_message_id, e.thread_id,
      s.ai_status, s.ai_reason, s.ai_model, s.ai_input_tokens, s.ai_output_tokens,
      s.ai_checked_at, s.ai_attempts, s.ai_error
    from public.sweep_queue s
    join public.emails e on e.id = s.email_id
    where s.user_id = p_user_id
      and (p_rule_id is null or s.sweep_rule_id = p_rule_id)
      and case p_status
            when 'pending'        then not s.executed and (s.ai_status is null or s.ai_status = 'match')
            when 'awaiting_check' then not s.executed and s.ai_status = 'pending'
            when 'review'         then not s.executed and s.ai_status = 'unsure'
            when 'check_failed'   then not s.executed and s.ai_status = 'failed'
            when 'swept'          then s.executed and (e.is_archived or e.is_deleted)
            when 'exempted'       then s.executed and not e.is_archived and not e.is_deleted
            else false
          end
      and (
        p_query is null
        or position(lower(p_query) in lower(coalesce(e.sender_name, ''))) > 0
        or position(lower(p_query) in lower(coalesce(e.sender_email, ''))) > 0
        or position(lower(p_query) in lower(coalesce(e.subject, ''))) > 0
      )
  )
  select q.*, count(*) over () as total
  from q
  order by
    case when p_status in ('swept', 'exempted') then null else q.scheduled_at end asc,
    case when p_status in ('swept', 'exempted') then q.scheduled_at end desc,
    q.email_id
  limit least(greatest(p_limit, 1), 200)
  offset greatest(p_offset, 0);
$$;

revoke all on function public.mcp_sweep_rule_stats(uuid) from public, anon, authenticated;
revoke all on function public.mcp_sweep_summary(uuid) from public, anon, authenticated;
revoke all on function public.mcp_list_sweeps(uuid, text, uuid, text, integer, integer) from public, anon, authenticated;
revoke all on function public.claude_check_usage(uuid) from public, anon, authenticated;
revoke all on function public.claim_sweep_checks(integer, integer) from public, anon, authenticated;
revoke all on function public.my_claude_check_usage() from public, anon;
grant execute on function public.mcp_sweep_rule_stats(uuid) to service_role;
grant execute on function public.mcp_sweep_summary(uuid) to service_role;
grant execute on function public.mcp_list_sweeps(uuid, text, uuid, text, integer, integer) to service_role;
grant execute on function public.claude_check_usage(uuid) to service_role;
grant execute on function public.claim_sweep_checks(integer, integer) to service_role;
grant execute on function public.my_claude_check_usage() to authenticated;

-- ------------------------------------------------------------
-- sweep-check runs every minute. Its cron job is the sweep-backfill job
-- with the URL changed, so it sends the same shared secret without the
-- secret being written here. Skipped where that job doesn't exist.
-- ------------------------------------------------------------
do $$
declare
  v_command text;
begin
  select command into v_command from cron.job where jobname = 'sweep-backfill';
  if v_command is not null and not exists (select 1 from cron.job where jobname = 'sweep-check') then
    perform cron.schedule(
      'sweep-check',
      '* * * * *',
      replace(v_command, '/functions/v1/sweep-backfill', '/functions/v1/sweep-check')
    );
  end if;
exception
  when undefined_table or invalid_schema_name then null;  -- no pg_cron here
end;
$$;
