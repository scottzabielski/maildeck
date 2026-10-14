-- ============================================================
-- MailDeck: API for the mail MCP server
-- ============================================================
-- The mail-mcp Cloudflare Worker manages sweep rules, streams and the
-- sweep queue through the mcp-api edge function. It authenticates with
-- a long random API key; only the key's SHA-256 hash is stored here.
-- RLS is on with no policies, so only the service role can read keys.
--
-- The functions below back mcp-api's read endpoints. They take a
-- user_id argument, so they are callable by the service role only.

create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  label text not null,
  key_hash text not null unique,   -- hex SHA-256 of the full key
  key_hint text not null,          -- last 6 characters, to tell keys apart
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz           -- set to revoke; mcp-api refuses revoked keys
);

create index idx_api_keys_user_id on public.api_keys(user_id);

alter table public.api_keys enable row level security;
revoke all on public.api_keys from anon, authenticated;

comment on table public.api_keys is 'Hashed API keys for server-to-server callers (mail MCP). Service role only.';

-- ------------------------------------------------------------
-- Per-rule sweep activity: pending sweeps, the next one due, and
-- messages swept recently. A swept row is an executed queue row whose
-- email is now archived or deleted; exempted rows are executed too,
-- but their email is still in the inbox.
-- ------------------------------------------------------------
create or replace function public.mcp_sweep_rule_stats(p_user_id uuid)
returns table (
  rule_id uuid,
  pending bigint,
  next_sweep_at timestamptz,
  swept_7d bigint,
  swept_30d bigint,
  last_swept_at timestamptz
)
language sql
stable
set search_path = public
as $$
  select
    q.sweep_rule_id,
    count(*) filter (where not q.executed),
    min(q.scheduled_at) filter (where not q.executed),
    count(*) filter (where q.executed and (e.is_archived or e.is_deleted)
                       and q.scheduled_at > now() - interval '7 days' and q.scheduled_at <= now()),
    count(*) filter (where q.executed and (e.is_archived or e.is_deleted)
                       and q.scheduled_at > now() - interval '30 days' and q.scheduled_at <= now()),
    max(q.scheduled_at) filter (where q.executed and (e.is_archived or e.is_deleted) and q.scheduled_at <= now())
  from public.sweep_queue q
  join public.emails e on e.id = q.email_id
  where q.user_id = p_user_id
    and q.sweep_rule_id is not null
  group by q.sweep_rule_id;
$$;

-- ------------------------------------------------------------
-- Queue totals for the status overview. "overdue" counts pending rows
-- more than 15 minutes past due: sweep-execute runs every minute, so
-- anything there means the executor is stuck or failing.
-- ------------------------------------------------------------
create or replace function public.mcp_sweep_summary(p_user_id uuid)
returns table (
  pending bigint,
  due_24h bigint,
  overdue bigint,
  swept_24h bigint,
  swept_7d bigint
)
language sql
stable
set search_path = public
as $$
  select
    count(*) filter (where not q.executed),
    count(*) filter (where not q.executed and q.scheduled_at <= now() + interval '24 hours'),
    count(*) filter (where not q.executed and q.scheduled_at < now() - interval '15 minutes'),
    count(*) filter (where q.executed and (e.is_archived or e.is_deleted)
                       and q.scheduled_at > now() - interval '24 hours' and q.scheduled_at <= now()),
    count(*) filter (where q.executed and (e.is_archived or e.is_deleted)
                       and q.scheduled_at > now() - interval '7 days' and q.scheduled_at <= now())
  from public.sweep_queue q
  join public.emails e on e.id = q.email_id
  where q.user_id = p_user_id;
$$;

-- ------------------------------------------------------------
-- One page of the sweep queue with each email's details.
--   pending  — not executed yet, soonest first
--   swept    — executed and the email is archived/deleted, newest first
--   exempted — executed but the email is still in the inbox, newest first
-- p_query matches sender name, sender address or subject as plain,
-- case-insensitive text (no wildcards).
-- ------------------------------------------------------------
create or replace function public.mcp_list_sweeps(
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
      e.provider_message_id, e.thread_id
    from public.sweep_queue s
    join public.emails e on e.id = s.email_id
    where s.user_id = p_user_id
      and (p_rule_id is null or s.sweep_rule_id = p_rule_id)
      and case p_status
            when 'pending'  then not s.executed
            when 'swept'    then s.executed and (e.is_archived or e.is_deleted)
            when 'exempted' then s.executed and not e.is_archived and not e.is_deleted
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
    case when p_status = 'pending' then q.scheduled_at end asc,
    case when p_status <> 'pending' then q.scheduled_at end desc,
    q.email_id
  limit least(greatest(p_limit, 1), 200)
  offset greatest(p_offset, 0);
$$;

revoke all on function public.mcp_sweep_rule_stats(uuid) from public, anon, authenticated;
revoke all on function public.mcp_sweep_summary(uuid) from public, anon, authenticated;
revoke all on function public.mcp_list_sweeps(uuid, text, uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.mcp_sweep_rule_stats(uuid) to service_role;
grant execute on function public.mcp_sweep_summary(uuid) to service_role;
grant execute on function public.mcp_list_sweeps(uuid, text, uuid, text, integer, integer) to service_role;
