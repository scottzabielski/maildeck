-- ============================================================
-- MailDeck: server sweep matcher fixes for big rules and to/label
-- ============================================================
-- 1. The matcher looked up queue state with `email_id=in.(...)` filters
--    in chunks of 500 ids. A full chunk makes a ~19.5 KB URL, past the
--    edge's request-line limit, so any rule matching more than ~400
--    inbox emails failed ("error sending request"). sweep_queue_state()
--    takes the ids in an RPC body instead, which has no such limit.
--
-- 2. PostgREST drops casts in filters, so the matcher's
--    `recipients::text=ilike...` and `labels::text=ilike...` failed with
--    "operator does not exist: jsonb ~~* unknown": "to" and "label"
--    conditions never worked outside the insert trigger. These computed
--    columns give PostgREST the same text the trigger matches on.

create or replace function public.recipients_text(public.emails)
returns text
language sql
immutable
as $$ select $1.recipients::text $$;

create or replace function public.labels_text(public.emails)
returns text
language sql
immutable
as $$ select $1.labels::text $$;

create or replace function public.sweep_queue_state(p_user_id uuid, p_email_ids uuid[])
returns table (
  email_id uuid,
  executed boolean,
  scheduled_at timestamptz,
  sweep_rule_id uuid
)
language sql
stable
set search_path = public
as $$
  select q.email_id, q.executed, q.scheduled_at, q.sweep_rule_id
  from public.sweep_queue q
  where q.user_id = p_user_id
    and q.email_id = any(p_email_ids);
$$;

revoke all on function public.sweep_queue_state(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.sweep_queue_state(uuid, uuid[]) to service_role;
