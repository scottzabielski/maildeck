-- ========================================
-- MailDeck: pg_cron Scheduled Jobs
-- ========================================
-- These jobs call Supabase Edge Functions via pg_net (HTTP).
-- NOTE: The <PROJECT_REF> and <SERVICE_ROLE_KEY> placeholders below must be
-- replaced with real values before running. If you've already set up these
-- cron jobs via the Supabase SQL editor, this migration can be skipped.

-- ========================================
-- Enable Realtime for emails table
-- ========================================
alter publication supabase_realtime add table public.emails;

-- ========================================
-- Sweep execution — every minute
-- Process sweep_queue items where scheduled_at <= now()
-- ========================================
select cron.schedule(
  'sweep-execute',
  '* * * * *',  -- every minute
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/sweep-execute',
    headers := jsonb_build_object(
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- ========================================
-- Token refresh — every 30 minutes
-- Refresh OAuth tokens expiring within 15 minutes
-- ========================================
select cron.schedule(
  'token-refresh',
  '*/30 * * * *',  -- every 30 minutes
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/token-refresh',
    headers := jsonb_build_object(
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- ========================================
-- Polling sync fallback — every 5 minutes
-- Incremental sync for all active accounts
-- ========================================
select cron.schedule(
  'sync-emails-polling',
  '*/5 * * * *',  -- every 5 minutes
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/sync-emails',
    headers := jsonb_build_object(
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>',
      'Content-Type', 'application/json'
    ),
    body := '{"mode": "incremental_all"}'::jsonb
  );
  $$
);

-- ========================================
-- Gmail watch renewal — every 5 days
-- Renew Gmail push notification subscriptions
-- ========================================
select cron.schedule(
  'gmail-watch-renewal',
  '0 0 */5 * *',  -- every 5 days at midnight
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/sync-emails',
    headers := jsonb_build_object(
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>',
      'Content-Type', 'application/json'
    ),
    body := '{"mode": "renew_push", "provider": "gmail"}'::jsonb
  );
  $$
);

-- ========================================
-- Outlook subscription renewal — every 2 days
-- Renew Microsoft Graph push notification subscriptions
-- ========================================
select cron.schedule(
  'outlook-subscription-renewal',
  '0 0 */2 * *',  -- every 2 days at midnight
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/sync-emails',
    headers := jsonb_build_object(
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>',
      'Content-Type', 'application/json'
    ),
    body := '{"mode": "renew_push", "provider": "outlook"}'::jsonb
  );
  $$
);
