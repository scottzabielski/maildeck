-- AI-generated sweep rule suggestion dismissals.
-- A "suggestion_hash" is a stable digest computed client- and edge-side from
-- the suggestion's kind + sorted ruleIds + serialized proposedRule. Storing
-- the hash (not the suggestion body) lets us de-dupe re-runs without
-- carrying around frozen rule snapshots that could go stale.

CREATE TABLE IF NOT EXISTS public.sweep_suggestion_dismissals (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  suggestion_hash text NOT NULL,
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, suggestion_hash)
);

CREATE INDEX IF NOT EXISTS sweep_suggestion_dismissals_user_idx
  ON public.sweep_suggestion_dismissals (user_id);

ALTER TABLE public.sweep_suggestion_dismissals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user sees own dismissals" ON public.sweep_suggestion_dismissals;
CREATE POLICY "user sees own dismissals"
  ON public.sweep_suggestion_dismissals
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
