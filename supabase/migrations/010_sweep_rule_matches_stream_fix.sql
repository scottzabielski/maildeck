-- ============================================================
-- MailDeck: fix _sweep_rule_matches for stream-only criteria
-- ============================================================
-- Migration 009 installed _sweep_rule_matches(), but it had a bug: when
-- every criterion in a rule is field="stream" (skipped because streams
-- require cross-table resolution that the trigger path intentionally
-- avoids), the function would return true for 'and' logic because
-- v_all stayed at its initial value of true. That would cause
-- stream-only rules to match every email and enqueue spurious sweeps
-- when new emails were inserted.
--
-- Fix: track whether any criterion was actually evaluated, and return
-- false if none were (i.e. all were skipped).

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
  if p_criteria is null or jsonb_typeof(p_criteria) <> 'array' then
    return false;
  end if;

  for v_c in select * from jsonb_array_elements(p_criteria) loop
    -- Skip "stream" criteria — they need cross-table resolution and the
    -- trigger path intentionally ignores them to avoid recursion.
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

  -- If every criterion was a stream (or the array was empty after
  -- filtering), the rule cannot be evaluated in trigger context — treat
  -- that as "no match" so spurious queue rows aren't created.
  if v_evaluated = 0 then
    return false;
  end if;

  if p_logic = 'or' then
    return v_any;
  end if;
  return v_all;
end;
$$;
