import { useEffect, useMemo, useState } from 'react';
import { Icons } from './ui/Icons.tsx';
import { SuggestionCard } from './SuggestionCard.tsx';
import { useStore } from '../store/index.ts';
import { useAuth } from '../hooks/useAuth.ts';
import { useSuggestConsolidations, useDismissSuggestion } from '../hooks/useSuggestions.ts';
import {
  useCreateSweepRule,
  useUpdateSweepRule,
  useDeleteSweepRule,
  useApplySweepRule,
} from '../hooks/useSweepRules.ts';
import { computeSuggestionHash } from '../lib/suggestionHash.ts';
import type { Suggestion, SweepRule } from '../types/index.ts';

const useMockData = import.meta.env.VITE_USE_MOCK_DATA === 'true';

// Some rules in the local store have phantom client-minted ids like
// "sr-12345" — they were never persisted. Skip DB operations on those.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isPersistedId = (id: string) => UUID_RE.test(id);

interface Props {
  open: boolean;
  onClose: () => void;
}

export function SweepSuggestionsModal({ open, onClose }: Props) {
  const sweepRules = useStore(s => s.sweepRules);
  const addSweepRule = useStore(s => s.addSweepRule);
  const updateSweepRuleLocal = useStore(s => s.updateSweepRule);
  const openSweepRuleEditorForRule = useStore(s => s.openSweepRuleEditorForRule);
  const { user } = useAuth();

  const consolidationsMutation = useSuggestConsolidations();
  const dismissMutation = useDismissSuggestion();
  const createRuleMutation = useCreateSweepRule();
  const updateRuleMutation = useUpdateSweepRule();
  const deleteRuleMutation = useDeleteSweepRule();
  const applyRuleMutation = useApplySweepRule();

  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyHash, setBusyHash] = useState<string | null>(null);

  const rulesById = useMemo(() => {
    const m = new Map<string, SweepRule>();
    for (const r of sweepRules) m.set(r.id, r);
    return m;
  }, [sweepRules]);

  // Reset when the modal opens.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setSuggestions([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Fetch suggestions when modal is open AND auth is ready. Re-fires if auth
  // hydrates after the modal opens (mobile session restore can land late).
  useEffect(() => {
    if (!open) return;
    if (useMockData) {
      console.warn('[AI Review] Mock data mode.');
      runMockSuggestions(sweepRules).then(setSuggestions);
      return;
    }
    if (!user?.id) {
      console.log('[AI Review] Waiting for auth...');
      return;
    }
    console.log('[AI Review] Calling suggest-sweep-consolidations edge function...');
    consolidationsMutation.mutate(undefined, {
      onSuccess: (data) => {
        console.log('[AI Review] Edge function returned', data?.suggestions?.length ?? 0, 'suggestions', data);
        setSuggestions(data?.suggestions ?? []);
      },
      onError: (err) => {
        console.error('[AI Review] Edge function error:', err);
        setError((err as Error).message);
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, user?.id]);

  if (!open) return null;

  const handleDismiss = async (suggestion: Suggestion) => {
    setSuggestions(prev => prev.filter(s => s.hash !== suggestion.hash));
    if (!useMockData && user?.id) {
      try {
        await dismissMutation.mutateAsync({ userId: user.id, suggestionHash: suggestion.hash });
      } catch (err) {
        console.error('[Suggestions] Dismiss persist failed:', err);
      }
    }
  };

  const handleApply = async (suggestion: Suggestion) => {
    if (!user?.id && !useMockData) {
      setError('Not signed in.');
      return;
    }
    setBusyHash(suggestion.hash);
    setError(null);
    try {
      await applySuggestion(suggestion);
      setSuggestions(prev => prev.filter(s => s.hash !== suggestion.hash));
    } catch (err) {
      console.error('[Suggestions] Apply failed:', err);
      setError(`Could not apply: ${(err as Error).message}`);
    } finally {
      setBusyHash(null);
    }
  };

  const applySuggestion = async (suggestion: Suggestion) => {
    // Snapshot involved rules in case we need to roll back.
    const snapshot = suggestion.ruleIds
      .map(id => rulesById.get(id))
      .filter((r): r is SweepRule => !!r);

    if (suggestion.kind === 'rename') {
      const target = snapshot[0];
      if (!target) throw new Error('Rule not found');
      const newName = suggestion.proposedRule?.name?.trim();
      if (!newName) throw new Error('No proposed name');
      const newDetail = suggestion.proposedRule?.detail?.trim() ?? target.detail;
      updateSweepRuleLocal(target.id, { name: newName, detail: newDetail });
      if (!useMockData && user?.id && isPersistedId(target.id)) {
        await updateRuleMutation.mutateAsync({
          id: target.id,
          user_id: user.id,
          name: newName,
          detail: newDetail,
        });
      }
      return;
    }

    if (suggestion.kind === 'duplicate' || suggestion.kind === 'redundant') {
      const keepId = suggestion.keepRuleId ?? snapshot[0]?.id;
      if (!keepId) throw new Error('No keeper rule');
      const toDelete = snapshot.filter(r => r.id !== keepId);
      const deleted: SweepRule[] = [];
      try {
        for (const r of toDelete) {
          if (!useMockData && user?.id && isPersistedId(r.id)) {
            await deleteRuleMutation.mutateAsync({ id: r.id, userId: user.id });
          }
          // Local mutation
          useStore.setState(s => ({ sweepRules: s.sweepRules.filter(x => x.id !== r.id) }));
          deleted.push(r);
        }
      } catch (err) {
        // Roll back local
        useStore.setState(s => ({ sweepRules: [...s.sweepRules, ...deleted] }));
        throw err;
      }
      return;
    }

    if (suggestion.kind === 'merge') {
      const proposed = suggestion.proposedRule;
      if (!proposed?.criteria || proposed.criteria.length === 0) {
        throw new Error('Proposed rule is incomplete');
      }
      const sources = snapshot;
      const baseAction = sources[0]?.action ?? proposed.action ?? 'archive';
      const baseDelay = sources[0]?.delayHours ?? proposed.delayHours ?? 24;
      const name = proposed.name?.trim() || sources.map(s => s.name).join(' + ');
      const detail = proposed.detail?.trim() || sources[0]?.detail || '';
      const criteria = proposed.criteria;
      const logic = proposed.criteriaLogic ?? 'or';

      let createdId: string | null = null;
      const deleted: SweepRule[] = [];
      try {
        if (!useMockData && user?.id) {
          const created = await createRuleMutation.mutateAsync({
            user_id: user.id,
            name,
            detail,
            is_enabled: true,
            sender_pattern: null,
            criteria,
            criteria_logic: logic,
            action: baseAction,
            delay_hours: baseDelay,
          });
          createdId = created.id;
          // Mirror into local store with the DB id
          useStore.setState(s => ({
            sweepRules: [
              ...s.sweepRules,
              {
                id: created.id,
                name,
                detail,
                enabled: true,
                criteria,
                criteriaLogic: logic,
                action: baseAction,
                delayHours: baseDelay,
              },
            ],
          }));
        } else {
          // Mock: addSweepRule generates an id
          addSweepRule({ name, detail, criteria, criteriaLogic: logic, action: baseAction, delayHours: baseDelay });
        }

        // Delete the sources
        for (const r of sources) {
          if (!useMockData && user?.id && isPersistedId(r.id)) {
            await deleteRuleMutation.mutateAsync({ id: r.id, userId: user.id });
          }
          useStore.setState(s => ({ sweepRules: s.sweepRules.filter(x => x.id !== r.id) }));
          deleted.push(r);
        }

        // Trigger server-side apply on the new merged rule (best-effort, fire-and-forget).
        if (createdId && !useMockData && user?.id) {
          applyRuleMutation.mutateAsync({ ruleId: createdId, userId: user.id }).catch(err =>
            console.error('[Suggestions] Post-merge apply failed:', err),
          );
        }
      } catch (err) {
        // Rollback: restore deleted, delete created
        useStore.setState(s => {
          let rules = [...s.sweepRules, ...deleted];
          if (createdId) rules = rules.filter(r => r.id !== createdId);
          return { sweepRules: rules };
        });
        if (createdId && !useMockData && user?.id) {
          deleteRuleMutation.mutateAsync({ id: createdId, userId: user.id }).catch(() => {});
        }
        throw err;
      }
      return;
    }

    if (suggestion.kind === 'absorb') {
      // keepRuleId optional from LLM — fall back to the rule whose criteria is a prefix of proposed.
      const proposed = suggestion.proposedRule;
      if (!proposed?.criteria) throw new Error('Proposed rule has no criteria');

      // Heuristic: the keeper is the rule whose ruleIds appears first; the others are absorbed.
      const keepId = suggestion.keepRuleId ?? snapshot[0]?.id;
      const keeper = snapshot.find(r => r.id === keepId);
      if (!keeper) throw new Error('Absorbing rule not found');
      const absorbed = snapshot.filter(r => r.id !== keepId);

      const newCriteria = proposed.criteria;
      const newLogic = proposed.criteriaLogic ?? keeper.criteriaLogic;
      const prevKeeper = { ...keeper };
      const deleted: SweepRule[] = [];

      try {
        // Update keeper
        updateSweepRuleLocal(keeper.id, { criteria: newCriteria, criteriaLogic: newLogic });
        if (!useMockData && user?.id && isPersistedId(keeper.id)) {
          await updateRuleMutation.mutateAsync({
            id: keeper.id,
            user_id: user.id,
            criteria: newCriteria,
            criteria_logic: newLogic,
          });
        }
        // Delete absorbed rules
        for (const r of absorbed) {
          if (!useMockData && user?.id && isPersistedId(r.id)) {
            await deleteRuleMutation.mutateAsync({ id: r.id, userId: user.id });
          }
          useStore.setState(s => ({ sweepRules: s.sweepRules.filter(x => x.id !== r.id) }));
          deleted.push(r);
        }
      } catch (err) {
        // Rollback
        updateSweepRuleLocal(keeper.id, { criteria: prevKeeper.criteria, criteriaLogic: prevKeeper.criteriaLogic });
        useStore.setState(s => ({ sweepRules: [...s.sweepRules, ...deleted] }));
        throw err;
      }
      return;
    }

    throw new Error(`Unsupported suggestion kind: ${suggestion.kind}`);
  };

  const handleDismissLow = async () => {
    const lows = suggestions.filter(s => s.confidence === 'low');
    setSuggestions(prev => prev.filter(s => s.confidence !== 'low'));
    if (!useMockData && user?.id) {
      for (const s of lows) {
        try {
          await dismissMutation.mutateAsync({ userId: user.id, suggestionHash: s.hash });
        } catch (err) {
          console.error('[Suggestions] Bulk dismiss failed:', err);
        }
      }
    }
  };

  const handleEditRule = (ruleId: string) => {
    onClose();
    setTimeout(() => openSweepRuleEditorForRule(ruleId), 50);
  };

  const isLoading = consolidationsMutation.isPending;
  const hasLowConfidence = suggestions.some(s => s.confidence === 'low');

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="criteria-editor suggestions-modal">
        <div className="criteria-header">
          <span className="criteria-title">
            <Icons.Sparkle /> AI Review
          </span>
          <button className="criteria-close" onClick={onClose} type="button">
            <Icons.Close />
          </button>
        </div>
        <div className="criteria-body suggestions-body">
          {isLoading && <div className="suggestions-loading">Analyzing your rules…</div>}
          {error && <div className="suggestions-error">{error}</div>}
          {!isLoading && suggestions.length === 0 && !error && (
            <div className="suggestions-empty">No suggestions — your rules look tidy.</div>
          )}
          {!isLoading && suggestions.map(s => (
            <SuggestionCard
              key={s.hash}
              suggestion={s}
              rulesById={rulesById}
              busy={busyHash === s.hash}
              onApply={handleApply}
              onDismiss={handleDismiss}
              onEditRule={handleEditRule}
            />
          ))}
        </div>
        {hasLowConfidence && (
          <div className="criteria-footer suggestions-footer">
            <button className="btn-secondary" onClick={handleDismissLow} type="button">
              Dismiss all low-confidence
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// Client-side heuristic-only suggestions for mock mode / when LLM unavailable.
async function runMockSuggestions(rules: SweepRule[]): Promise<Suggestion[]> {
  const out: Suggestion[] = [];
  const groups = new Map<string, SweepRule[]>();
  for (const r of rules) {
    const key = [...r.criteria]
      .filter(c => c.value.trim())
      .map(c => `${c.field}|${c.op}|${c.value.trim().toLowerCase()}`)
      .sort()
      .join('\n') + `::${r.criteriaLogic}`;
    const arr = groups.get(key) ?? [];
    arr.push(r);
    groups.set(key, arr);
  }
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const actions = new Set(list.map(r => r.action));
    if (actions.size === 1) {
      const sorted = [...list].sort((a, b) => a.id.localeCompare(b.id));
      const hash = await computeSuggestionHash({
        kind: 'duplicate',
        ruleIds: sorted.map(r => r.id),
      });
      out.push({
        hash,
        kind: 'duplicate',
        ruleIds: sorted.map(r => r.id),
        keepRuleId: sorted[0].id,
        rationale: `${list.length} rules with identical criteria.`,
        confidence: 'high',
        source: 'deterministic',
      });
    } else {
      const ruleIds = list.map(r => r.id).sort();
      const hash = await computeSuggestionHash({ kind: 'conflict', ruleIds });
      out.push({
        hash,
        kind: 'conflict',
        ruleIds,
        rationale: 'These rules match the same emails but apply different actions.',
        confidence: 'high',
        source: 'deterministic',
      });
    }
  }
  return out;
}
