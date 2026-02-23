-- ========================================
-- MailDeck: Row Level Security Policies
-- ========================================

-- Enable RLS on all tables
alter table public.profiles enable row level security;
alter table public.email_accounts enable row level security;
alter table public.emails enable row level security;
alter table public.columns enable row level security;
alter table public.sweep_rules enable row level security;
alter table public.sweep_queue enable row level security;

-- ========================================
-- profiles
-- ========================================
create policy "Users can view their own profile"
  on public.profiles for select
  to authenticated
  using ( (select auth.uid()) = id );

create policy "Users can update their own profile"
  on public.profiles for update
  to authenticated
  using ( (select auth.uid()) = id )
  with check ( (select auth.uid()) = id );

-- Insert is handled by the trigger, but allow users to insert their own
create policy "Users can insert their own profile"
  on public.profiles for insert
  to authenticated
  with check ( (select auth.uid()) = id );

-- ========================================
-- email_accounts
-- ========================================
create policy "Users can view their own email accounts"
  on public.email_accounts for select
  to authenticated
  using ( (select auth.uid()) = user_id );

create policy "Users can insert their own email accounts"
  on public.email_accounts for insert
  to authenticated
  with check ( (select auth.uid()) = user_id );

create policy "Users can update their own email accounts"
  on public.email_accounts for update
  to authenticated
  using ( (select auth.uid()) = user_id )
  with check ( (select auth.uid()) = user_id );

create policy "Users can delete their own email accounts"
  on public.email_accounts for delete
  to authenticated
  using ( (select auth.uid()) = user_id );

-- Revoke direct access to encrypted token columns from anon and authenticated roles.
-- Tokens are only accessed via service_role Edge Functions.
revoke all on public.email_accounts from anon;
grant select (
  id, user_id, provider, email, display_name, color, sort_order, is_enabled,
  last_synced_at, sync_status, created_at, updated_at
) on public.email_accounts to authenticated;
grant insert (
  user_id, provider, email, display_name, color, sort_order, is_enabled
) on public.email_accounts to authenticated;
grant update (
  display_name, color, sort_order, is_enabled
) on public.email_accounts to authenticated;
grant delete on public.email_accounts to authenticated;

-- ========================================
-- emails
-- ========================================
create policy "Users can view their own emails"
  on public.emails for select
  to authenticated
  using ( (select auth.uid()) = user_id );

create policy "Users can insert their own emails"
  on public.emails for insert
  to authenticated
  with check ( (select auth.uid()) = user_id );

create policy "Users can update their own emails"
  on public.emails for update
  to authenticated
  using ( (select auth.uid()) = user_id )
  with check ( (select auth.uid()) = user_id );

create policy "Users can delete their own emails"
  on public.emails for delete
  to authenticated
  using ( (select auth.uid()) = user_id );

-- ========================================
-- columns
-- ========================================
create policy "Users can view their own columns"
  on public.columns for select
  to authenticated
  using ( (select auth.uid()) = user_id );

create policy "Users can insert their own columns"
  on public.columns for insert
  to authenticated
  with check ( (select auth.uid()) = user_id );

create policy "Users can update their own columns"
  on public.columns for update
  to authenticated
  using ( (select auth.uid()) = user_id )
  with check ( (select auth.uid()) = user_id );

create policy "Users can delete their own columns"
  on public.columns for delete
  to authenticated
  using ( (select auth.uid()) = user_id );

-- ========================================
-- sweep_rules
-- ========================================
create policy "Users can view their own sweep rules"
  on public.sweep_rules for select
  to authenticated
  using ( (select auth.uid()) = user_id );

create policy "Users can insert their own sweep rules"
  on public.sweep_rules for insert
  to authenticated
  with check ( (select auth.uid()) = user_id );

create policy "Users can update their own sweep rules"
  on public.sweep_rules for update
  to authenticated
  using ( (select auth.uid()) = user_id )
  with check ( (select auth.uid()) = user_id );

create policy "Users can delete their own sweep rules"
  on public.sweep_rules for delete
  to authenticated
  using ( (select auth.uid()) = user_id );

-- ========================================
-- sweep_queue
-- ========================================
create policy "Users can view their own sweep queue"
  on public.sweep_queue for select
  to authenticated
  using ( (select auth.uid()) = user_id );

create policy "Users can insert into their own sweep queue"
  on public.sweep_queue for insert
  to authenticated
  with check ( (select auth.uid()) = user_id );

create policy "Users can update their own sweep queue"
  on public.sweep_queue for update
  to authenticated
  using ( (select auth.uid()) = user_id )
  with check ( (select auth.uid()) = user_id );

create policy "Users can delete from their own sweep queue"
  on public.sweep_queue for delete
  to authenticated
  using ( (select auth.uid()) = user_id );
