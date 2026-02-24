-- Widen sweep_rules.action to include keep_newest variants
ALTER TABLE public.sweep_rules DROP CONSTRAINT IF EXISTS sweep_rules_action_check;
ALTER TABLE public.sweep_rules ADD CONSTRAINT sweep_rules_action_check
  CHECK (action IN ('archive', 'delete', 'keep_newest_archive', 'keep_newest_delete'));
