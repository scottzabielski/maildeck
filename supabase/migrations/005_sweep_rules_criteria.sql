-- Add criteria columns to sweep_rules
ALTER TABLE public.sweep_rules ADD COLUMN criteria jsonb NOT NULL DEFAULT '[]';
ALTER TABLE public.sweep_rules ADD COLUMN criteria_logic text NOT NULL DEFAULT 'and'
  CHECK (criteria_logic IN ('and', 'or'));

-- Migrate existing sender_pattern data to criteria format
UPDATE public.sweep_rules
SET criteria = jsonb_build_array(
  jsonb_build_object('field', 'from', 'op', 'contains', 'value', sender_pattern)
)
WHERE sender_pattern IS NOT NULL AND sender_pattern != '';

-- Update action check constraint to allow new values
ALTER TABLE public.sweep_rules DROP CONSTRAINT IF EXISTS sweep_rules_action_check;
ALTER TABLE public.sweep_rules ADD CONSTRAINT sweep_rules_action_check
  CHECK (action IN ('archive', 'delete'));
