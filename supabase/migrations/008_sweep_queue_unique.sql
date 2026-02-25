-- Remove duplicate (user_id, email_id) rows, keeping the earliest inserted
DELETE FROM public.sweep_queue a
USING public.sweep_queue b
WHERE a.user_id = b.user_id AND a.email_id = b.email_id AND a.id > b.id;

-- Add UNIQUE constraint so upsert on (user_id, email_id) works correctly
ALTER TABLE public.sweep_queue
  ADD CONSTRAINT sweep_queue_user_email_unique UNIQUE (user_id, email_id);
