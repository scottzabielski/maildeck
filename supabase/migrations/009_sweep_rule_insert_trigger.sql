-- ============================================================
-- MailDeck: auto-apply sweep rules on email insert
-- ============================================================
-- Historically, sweep_queue population relied on the React client
-- being open and its hydration/new-email effects successfully calling
-- the apply-sweep-rule edge function. When the function silently broke
-- (dashboard vs. repo verify_jwt drift), no queue rows were created
-- for ~6 weeks and no email was ever auto-swept. This migration makes
-- queue population a DB-level guarantee: when an email is inserted,
-- the trigger immediately evaluates every enabled sweep rule for the
-- owning user and enqueues any matches.
--
-- The criteria matcher is implemented in pure SQL (no pg_net, no
-- edge-function round-trip) so that it runs inside the insert txn and
-- has no external dependencies. It mirrors the logic in
-- supabase/functions/apply-sweep-rule/index.ts — keep them in sync.

-- ------------------------------------------------------------
-- Helper: does a single criterion match an email?
-- ------------------------------------------------------------
create or replace function public._sweep_criterion_matches(
  p_email public.emails,
  p_criterion jsonb
) returns boolean
language plpgsql
stable
as $$
declare
  v_field  text := p_criterion->>'field';
  v_op     text := p_criterion->>'op';
  v_value  text := p_criterion->>'value';
  v_pat    text;
  v_is_not boolean := (v_op = 'not_contains');
  v_hit    boolean;
begin
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

  if v_is_not then
    return not v_hit;
  end if;
  return v_hit;
end;
$$;

-- ------------------------------------------------------------
-- Helper: does a set of criteria (with and/or logic) match?
-- ------------------------------------------------------------
create or replace function public._sweep_rule_matches(
  p_email public.emails,
  p_criteria jsonb,
  p_logic text
) returns boolean
language plpgsql
stable
as $$
declare
  v_c jsonb;
  v_any boolean := false;
  v_all boolean := true;
  v_count int := 0;
begin
  if p_criteria is null or jsonb_typeof(p_criteria) <> 'array' then
    return false;
  end if;

  for v_c in select * from jsonb_array_elements(p_criteria) loop
    v_count := v_count + 1;
    -- Skip "stream" criteria — see note above.
    if v_c->>'field' = 'stream' then
      continue;
    end if;

    if public._sweep_criterion_matches(p_email, v_c) then
      v_any := true;
    else
      v_all := false;
    end if;
  end loop;

  if v_count = 0 then
    return false;
  end if;

  if p_logic = 'or' then
    return v_any;
  end if;
  return v_all;
end;
$$;

-- ------------------------------------------------------------
-- Main trigger function: enqueue matching sweep rules for a new email
-- ------------------------------------------------------------
create or replace function public.apply_sweep_rules_on_insert()
returns trigger
language plpgsql
as $$
declare
  v_rule record;
  v_scheduled_at timestamptz;
  v_terminal_action text;
  v_criteria jsonb;
  v_logic text;
begin
  -- Skip already-archived/deleted rows (e.g. initial sync of historical mail)
  -- unless the user explicitly wants retroactive sweeping. Current policy:
  -- only sweep emails that landed in the inbox.
  if new.is_archived or new.is_deleted then
    return new;
  end if;

  for v_rule in
    select id, criteria, criteria_logic, action, delay_hours, sender_pattern
    from public.sweep_rules
    where user_id = new.user_id
      and is_enabled = true
  loop
    -- Prefer structured criteria; fall back to legacy sender_pattern if
    -- criteria is empty (matches the edge function's behavior).
    v_criteria := v_rule.criteria;
    if v_criteria is null or jsonb_array_length(v_criteria) = 0 then
      if v_rule.sender_pattern is null or v_rule.sender_pattern = '' then
        continue;
      end if;
      v_criteria := jsonb_build_array(
        jsonb_build_object('field', 'from', 'op', 'contains', 'value', v_rule.sender_pattern)
      );
    end if;

    v_logic := coalesce(v_rule.criteria_logic, 'and');

    if not public._sweep_rule_matches(new, v_criteria, v_logic) then
      continue;
    end if;

    v_terminal_action := case
      when v_rule.action in ('delete', 'keep_newest_delete') then 'delete'
      else 'archive'
    end;

    -- keep_newest_* actions are skipped in the trigger — they need the
    -- group-wide "which one is newest" comparison and are applied only
    -- via the edge function's batch path.
    if v_rule.action like 'keep_newest%' then
      continue;
    end if;

    v_scheduled_at := new.received_at + (v_rule.delay_hours || ' hours')::interval;

    -- Upsert: if a sooner schedule already exists, keep it. Otherwise
    -- insert or replace with the new schedule.
    insert into public.sweep_queue (
      user_id, email_id, sweep_rule_id, scheduled_at, action, executed
    ) values (
      new.user_id, new.id, v_rule.id, v_scheduled_at, v_terminal_action, false
    )
    on conflict (user_id, email_id) do update
      set sweep_rule_id = excluded.sweep_rule_id,
          scheduled_at  = excluded.scheduled_at,
          action        = excluded.action,
          executed      = false
      where public.sweep_queue.executed = false
        and excluded.scheduled_at < public.sweep_queue.scheduled_at;
  end loop;

  return new;
end;
$$;

-- ------------------------------------------------------------
-- Trigger wiring
-- ------------------------------------------------------------
drop trigger if exists trg_apply_sweep_rules_on_email_insert on public.emails;

create trigger trg_apply_sweep_rules_on_email_insert
  after insert on public.emails
  for each row
  execute function public.apply_sweep_rules_on_insert();

-- ------------------------------------------------------------
-- One-time backfill: queue up the ~6-week gap of unswept messages.
--
-- For each email, at most one queue row is created. When multiple
-- enabled rules match the same email, we pick the one with the
-- soonest scheduled_at (= earliest delay_hours applied to
-- received_at), mirroring the "sooner wins" policy the trigger
-- enforces via its ON CONFLICT clause.
--
-- DISTINCT ON in a subquery guarantees one row per (user_id,
-- email_id), so the subsequent INSERT ... ON CONFLICT never tries
-- to affect the same target row twice in one statement (which
-- Postgres rejects with SQLSTATE 21000).
--
-- Safe to re-run: the ON CONFLICT clause either keeps the existing
-- sooner schedule or replaces it with a sooner one.
-- ------------------------------------------------------------
insert into public.sweep_queue (user_id, email_id, sweep_rule_id, scheduled_at, action, executed)
select distinct on (m.user_id, m.email_id)
  m.user_id,
  m.email_id,
  m.rule_id,
  m.scheduled_at,
  m.terminal_action,
  false
from (
  select
    e.user_id,
    e.id as email_id,
    r.id as rule_id,
    e.received_at + (r.delay_hours || ' hours')::interval as scheduled_at,
    case when r.action in ('delete','keep_newest_delete') then 'delete' else 'archive' end as terminal_action
  from public.emails e
  join public.sweep_rules r
    on r.user_id = e.user_id
   and r.is_enabled = true
   and r.action not like 'keep_newest%'
  where e.is_archived = false
    and e.is_deleted = false
    and public._sweep_rule_matches(
      e,
      case
        when r.criteria is null or jsonb_array_length(r.criteria) = 0 then
          case
            when r.sender_pattern is null or r.sender_pattern = '' then null
            else jsonb_build_array(jsonb_build_object('field','from','op','contains','value',r.sender_pattern))
          end
        else r.criteria
      end,
      coalesce(r.criteria_logic, 'and')
    )
) m
order by m.user_id, m.email_id, m.scheduled_at asc
on conflict (user_id, email_id) do update
  set sweep_rule_id = excluded.sweep_rule_id,
      scheduled_at  = excluded.scheduled_at,
      action        = excluded.action,
      executed      = false
  where public.sweep_queue.executed = false
    and excluded.scheduled_at < public.sweep_queue.scheduled_at;
