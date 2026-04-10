-- ============================================================
-- MailDeck: defensively handle NULL/empty criteria fields
-- ============================================================
-- Migration 009's _sweep_criterion_matches() would return NULL
-- (propagated through ILIKE) if a criterion object contained
-- null/missing "field", "op", or "value" members. The caller
-- (_sweep_rule_matches and the trigger loop) treat NULL as "no
-- match" so behavior is safe, but this is fragile. Coalesce
-- inputs to empty strings so the function always returns a
-- concrete boolean.

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
