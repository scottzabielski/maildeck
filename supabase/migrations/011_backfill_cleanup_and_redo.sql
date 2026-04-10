-- ============================================================
-- MailDeck: clean up spurious queue rows from migration 009's backfill
-- ============================================================
-- Migration 009 ran a backfill using a buggy _sweep_rule_matches()
-- that would return true for AND-logic rules whose criteria were ALL
-- stream references (field="stream"). Stream criteria are silently
-- skipped in the trigger path because they require cross-table
-- resolution, and the buggy version failed to mark "no real criteria
-- were actually evaluated" as "no match". Migration 010 fixed the
-- function; this migration cleans up the fallout.
--
-- Strategy:
--   1. Delete every pending (executed = false) queue row that the
--      corrected matcher no longer considers a match for the rule
--      that originally enqueued it. Rows inserted manually (e.g. via
--      a user action) aren't touched because they would still match
--      their rule.
--   2. Re-run the backfill insert using the corrected matcher, in
--      case step 1 deleted rows for emails that should actually have
--      been queued via a different matching rule.
--
-- Rows with executed = true are left alone — those actions already
-- happened and we can't undo them from here.

-- ------------------------------------------------------------
-- Step 1: remove pending rows whose rule no longer matches
-- ------------------------------------------------------------
delete from public.sweep_queue q
using public.sweep_rules r, public.emails e
where q.executed = false
  and q.sweep_rule_id = r.id
  and q.email_id = e.id
  and not public._sweep_rule_matches(
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
  );

-- ------------------------------------------------------------
-- Step 2: re-run the backfill with the corrected matcher.
-- Idempotent via ON CONFLICT — existing correct rows stay put,
-- any newly-matching emails get queued.
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
