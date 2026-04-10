-- ============================================================
-- MailDeck: make the sweep-rules trigger resilient to malformed
-- criteria jsonb values
-- ============================================================
-- Migration 009's apply_sweep_rules_on_insert() calls
-- jsonb_array_length(v_criteria) to detect the empty-criteria case.
-- If v_criteria is a jsonb value that isn't an array (e.g. 'null'::jsonb,
-- '{}'::jsonb, a string), jsonb_array_length raises an exception — which
-- AFTER INSERT FOR EACH ROW propagates up and ABORTS the email insert.
-- One malformed sweep_rules row would then break every email insert for
-- that user (and, if it's shared, every user) until cleaned up.
--
-- Fix: guard the array-length probe with jsonb_typeof, and treat any
-- non-array criteria the same as empty criteria (fall through to
-- sender_pattern, or skip the rule).

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
  v_is_empty boolean;
begin
  if new.is_archived or new.is_deleted then
    return new;
  end if;

  for v_rule in
    select id, criteria, criteria_logic, action, delay_hours, sender_pattern
    from public.sweep_rules
    where user_id = new.user_id
      and is_enabled = true
  loop
    v_criteria := v_rule.criteria;

    -- Treat NULL, non-array jsonb, or empty array as "no structured
    -- criteria" and fall through to the sender_pattern legacy path.
    -- In plpgsql IF, boolean OR evaluates strictly left-to-right so the
    -- jsonb_array_length call is never reached when the value is null or
    -- a non-array scalar — guarding us from "cannot get array length of
    -- a scalar" exceptions that would otherwise abort the insert.
    v_is_empty := (
      v_criteria is null
      or jsonb_typeof(v_criteria) <> 'array'
      or jsonb_array_length(v_criteria) = 0
    );

    if v_is_empty then
      if v_rule.sender_pattern is null or v_rule.sender_pattern = '' then
        continue;
      end if;
      v_criteria := jsonb_build_array(
        jsonb_build_object('field', 'from', 'op', 'contains', 'value', v_rule.sender_pattern)
      );
    end if;

    v_logic := coalesce(v_rule.criteria_logic, 'and');

    -- keep_newest_* actions need a cross-email comparison; only the
    -- edge-function batch path can handle them. Skip in the trigger.
    if v_rule.action like 'keep_newest%' then
      continue;
    end if;

    if not public._sweep_rule_matches(new, v_criteria, v_logic) then
      continue;
    end if;

    v_terminal_action := case
      when v_rule.action in ('delete', 'keep_newest_delete') then 'delete'
      else 'archive'
    end;

    v_scheduled_at := new.received_at + (v_rule.delay_hours || ' hours')::interval;

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
