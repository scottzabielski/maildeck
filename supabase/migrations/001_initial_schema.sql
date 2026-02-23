-- ========================================
-- MailDeck: Initial Schema
-- ========================================

-- Extensions
create extension if not exists "pgcrypto";
create extension if not exists "pg_cron";

-- ========================================
-- profiles — extends Supabase Auth users
-- ========================================
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  default_sweep_delay_hours integer not null default 24,
  theme text not null default 'dark' check (theme in ('dark', 'light', 'system')),
  preferences jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'User profile settings, extends auth.users';

-- Auto-create profile row when a new user signs up
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.email));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ========================================
-- email_accounts — connected Gmail/Outlook accounts
-- ========================================
create type public.email_provider as enum ('gmail', 'outlook');
create type public.sync_status as enum ('idle', 'syncing', 'error', 'never_synced');

create table public.email_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider public.email_provider not null,
  email text not null,
  display_name text,
  color text not null default '#3b82f6',
  sort_order integer not null default 0,
  is_enabled boolean not null default true,

  -- OAuth tokens (encrypted, only accessible via service_role)
  access_token_encrypted bytea,
  refresh_token_encrypted bytea,
  token_expires_at timestamptz,

  -- Sync state
  sync_history_id text,         -- Gmail historyId
  sync_delta_link text,         -- Outlook deltaLink
  last_synced_at timestamptz,
  sync_status public.sync_status not null default 'never_synced',

  -- Push notification subscription
  push_subscription_id text,
  push_expires_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique(user_id, email)
);

create index idx_email_accounts_user_id on public.email_accounts(user_id);
create index idx_email_accounts_sync_status on public.email_accounts(sync_status);

comment on table public.email_accounts is 'Connected email provider accounts with encrypted OAuth tokens';

-- ========================================
-- emails — synced email messages
-- ========================================
create table public.emails (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  account_id uuid not null references public.email_accounts(id) on delete cascade,
  provider_message_id text not null,
  thread_id text,

  sender_name text,
  sender_email text,
  recipients jsonb not null default '[]',
  subject text not null default '',
  snippet text not null default '',
  body_text text,
  body_html text,

  received_at timestamptz not null default now(),
  is_unread boolean not null default true,
  is_starred boolean not null default false,
  is_archived boolean not null default false,
  is_deleted boolean not null default false,
  labels jsonb not null default '[]',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique(account_id, provider_message_id)
);

create index idx_emails_user_id on public.emails(user_id);
create index idx_emails_account_id on public.emails(account_id);
create index idx_emails_received_at on public.emails(user_id, received_at desc);
create index idx_emails_unread on public.emails(user_id, is_unread) where is_unread = true;
create index idx_emails_not_archived on public.emails(user_id, is_archived, is_deleted) where is_archived = false and is_deleted = false;
create index idx_emails_sender on public.emails(user_id, sender_email);

comment on table public.emails is 'Synced email messages from all connected accounts';

-- ========================================
-- columns — user-defined deck columns
-- ========================================
create table public.columns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  icon text not null default '📬',
  accent text not null default '#2563eb',
  criteria jsonb not null default '[]',
  criteria_logic text not null default 'and' check (criteria_logic in ('and', 'or')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_columns_user_id on public.columns(user_id, sort_order);

comment on table public.columns is 'User-defined stream columns with filter criteria';

-- ========================================
-- sweep_rules — automated sweep rules
-- ========================================
create table public.sweep_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  detail text,
  is_enabled boolean not null default true,
  sender_pattern text,
  action text not null default 'alwaysSweep' check (action in ('alwaysSweep', 'keepLatest', 'alwaysDelete')),
  delay_hours integer not null default 24,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_sweep_rules_user_id on public.sweep_rules(user_id);

comment on table public.sweep_rules is 'Automated rules for sweeping/archiving emails';

-- ========================================
-- sweep_queue — pending sweep actions
-- ========================================
create table public.sweep_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  email_id uuid not null references public.emails(id) on delete cascade,
  sweep_rule_id uuid references public.sweep_rules(id) on delete set null,
  scheduled_at timestamptz not null,
  action text not null default 'archive' check (action in ('archive', 'delete')),
  executed boolean not null default false,
  created_at timestamptz not null default now()
);

create index idx_sweep_queue_pending on public.sweep_queue(scheduled_at) where executed = false;
create index idx_sweep_queue_user_id on public.sweep_queue(user_id);
create index idx_sweep_queue_email_id on public.sweep_queue(email_id);

comment on table public.sweep_queue is 'Queue of pending sweep actions with scheduled execution times';

-- ========================================
-- updated_at trigger function
-- ========================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger set_email_accounts_updated_at
  before update on public.email_accounts
  for each row execute function public.set_updated_at();

create trigger set_emails_updated_at
  before update on public.emails
  for each row execute function public.set_updated_at();

create trigger set_columns_updated_at
  before update on public.columns
  for each row execute function public.set_updated_at();

create trigger set_sweep_rules_updated_at
  before update on public.sweep_rules
  for each row execute function public.set_updated_at();
