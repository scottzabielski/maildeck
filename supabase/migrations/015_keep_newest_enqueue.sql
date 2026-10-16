-- ============================================================
-- MailDeck: enqueue keep_newest_* sweeps
-- ============================================================
-- The insert trigger apply_sweep_rules_on_insert() deliberately skips
-- rules whose action is keep_newest_* because deciding which row to
-- keep needs a cross-email comparison the trigger cannot do safely.
-- The comment in that function says "only the edge-function batch
-- path can handle them" -- but sweep-execute only drains existing
-- sweep_queue rows, so nothing ever enqueued these. Result: every
-- keep_newest_delete / keep_newest_archive rule was a silent no-op.
--
-- This migration adds enqueue_keep_newest_sweeps(), invoked by the
-- sweep-execute edge function at the start of each run. For every
-- enabled keep_newest_* rule it scans the matching live emails per
-- user, picks the newest by received_at as the survivor, and enqueues
-- every other match for delete/archive with scheduled_at = now() so
-- the existing executor picks them up in the same invocation.
-- ============================================================

create or replace function public.enqueue_keep_newest_sweeps()
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_rule record;
  v_criteria jsonb;
  v_logic text;
  v_terminal_action text;
  v_keeper_id uuid;
  v_now timestamptz := now();
  v_enqueued int := 0;
begin
  for v_rule in
    select id, user_id, criteria, criteria_logic, action, sender_pattern
    from public.sweep_rules
    where is_enabled = true
      and action like 'keep_newest%'
  loop
    v_criteria := v_rule.criteria;

    -- Mirror the empty-criteria handling from apply_sweep_rules_on_insert:
    -- a missing/empty criteria array falls back to sender_pattern, and a
    -- rule with neither is skipped entirely.
    if v_criteria is null
       or jsonb_typeof(v_criteria) <> 'array'
       or jsonb_array_length(v_criteria) = 0
    then
      if v_rule.sender_pattern is null or v_rule.sender_pattern = '' then
        continue;
      end if;
      v_criteria := jsonb_build_array(
        jsonb_build_object('field', 'from', 'op', 'contains', 'value', v_rule.sender_pattern)
      );
    end if;

    v_logic := coalesce(v_rule.criteria_logic, 'and');

    v_terminal_action := case
      when v_rule.action = 'keep_newest_delete' then 'delete'
      else 'archive'
    end;

    -- Find the survivor: newest live email matching the rule for this user.
    select e.id
      into v_keeper_id
      from public.emails e
     where e.user_id = v_rule.user_id
       and e.is_archived = false
       and e.is_deleted = false
       and public._sweep_rule_matches(e, v_criteria, v_logic)
     order by e.received_at desc
     limit 1;

    -- No matches at all -> nothing to do for this rule.
    if v_keeper_id is null then
      continue;
    end if;

    -- Enqueue every other live match. Reuses the existing UPSERT
    -- semantics so concurrent enqueues stay idempotent.
    with losers as (
      select e.id, e.user_id
        from public.emails e
       where e.user_id = v_rule.user_id
         and e.id <> v_keeper_id
         and e.is_archived = false
         and e.is_deleted = false
         and public._sweep_rule_matches(e, v_criteria, v_logic)
    ),
    inserted as (
      insert into public.sweep_queue (
        user_id, email_id, sweep_rule_id, scheduled_at, action, executed
      )
      select l.user_id, l.id, v_rule.id, v_now, v_terminal_action, false
        from losers l
      on conflict (user_id, email_id) do update
        set sweep_rule_id = excluded.sweep_rule_id,
            scheduled_at  = excluded.scheduled_at,
            action        = excluded.action,
            executed      = false
        where public.sweep_queue.executed = false
          and excluded.scheduled_at < public.sweep_queue.scheduled_at
      returning 1
    )
    select v_enqueued + coalesce(count(*), 0) into v_enqueued from inserted;
  end loop;

  return v_enqueued;
end;
$function$;

grant execute on function public.enqueue_keep_newest_sweeps() to service_role;
