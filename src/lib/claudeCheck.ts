import type { ClaudeCheck } from '../types/index.ts';

/** Models a sweep rule's Claude check can use (mirrors CHECK_MODELS in the edge functions). */
export const CLAUDE_CHECK_MODELS = [
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
  { id: 'claude-opus-5', label: 'Claude Opus 5' },
];

export const NO_CLAUDE_CHECK: ClaudeCheck = { enabled: false, instruction: '', model: 'claude-haiku-5-5', allowDelete: false };

export const actionDeletes = (action: string) => action === 'delete' || action === 'keep_newest_delete';

/** Why a rule's Claude check can't be saved as is, or null. */
export function claudeCheckError(check: ClaudeCheck, action: string): string | null {
  if (!check.enabled) return null;
  const length = check.instruction.trim().length;
  if (length < 10) return 'Describe what Claude should look for (at least 10 characters).';
  if (length > 1000) return 'Keep the Claude check under 1,000 characters.';
  if (actionDeletes(action) && !check.allowDelete) {
    return 'A rule with a Claude check can only archive. Choose Archive, or allow it to delete.';
  }
  return null;
}

/** The sweep_rules columns for a check. */
export function claudeCheckColumns(check: ClaudeCheck) {
  return {
    ai_check_enabled: check.enabled,
    ai_instruction: check.instruction.trim() || null,
    ai_model: check.model,
    ai_allow_delete: check.enabled && check.allowDelete,
  };
}
