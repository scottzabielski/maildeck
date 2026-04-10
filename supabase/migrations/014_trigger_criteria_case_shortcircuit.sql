-- ============================================================
-- MailDeck: use CASE for short-circuited criteria type guards
-- ============================================================
-- Migration 013 added jsonb_typeof guards in front of jsonb_array_length
-- inside apply_sweep_rules_on_insert(), but wrote them as a bare OR
-- chain assigned to a variable:
--
--     v_is_empty := (
--       v_criteria is null
--       or jsonb_typeof(v_criteria) <> 'array'
--       or jsonb_array_length(v_criteria) = 0
--     );
--
-- Postgres does NOT guarantee short-circuit evaluation of boolean OR
-- expressions outside of IF/WHERE short-circuit contexts. Inside a
-- plpgsql assignment the expression is handed to the SQL executor,
-- which may evaluate all three operands unconditionally and raise
-- "cannot get array length of a scalar" on non-array jsonb values.
--
-- CASE expressions DO guarantee left-to-right, lazy evaluation of
-- their WHEN conditions — the only way to write this safely.

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

    -- CASE guarantees each WHEN is evaluated only if the earlier ones
    -- were false, so jsonb_array_length is never called on a non-array.
    v_is_empty := case
      when v_criteria is null then true
      when jsonb_typeof(v_criteria) <> 'array' then true
      when jsonb_array_length(v_criteria) = 0 then true
      else false
    end;

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


-- ------------------------------------------------------------
-- Same CASE treatment for _sweep_rule_matches — it calls
-- jsonb_array_elements on p_criteria, which requires array type.
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
  v_evaluated int := 0;
begin
  -- Guard: only arrays can be iterated with jsonb_array_elements.
  if p_criteria is null or jsonb_typeof(p_criteria) <> 'array' then
    return false;
  end if;

  for v_c in select * from jsonb_array_elements(p_criteria) loop
    if v_c->>'field' = 'stream' then
      continue;
    end if;

    v_evaluated := v_evaluated + 1;
    if public._sweep_criterion_matches(p_email, v_c) then
      v_any := true;
    else
      v_all := false;
    end if;
  end loop;

  if v_evaluated = 0 then
    return false;
  end if;

  if p_logic = 'or' then
    return v_any;
  end if;
  return v_all;
end;
$$;
