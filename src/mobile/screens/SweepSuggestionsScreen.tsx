import { useEffect, useMemo, useState } from 'react';
import { Icons } from '../../components/ui/Icons.tsx';
import { MobileTopBar } from '../components/MobileTopBar.tsx';
import { SuggestionCard } from '../../components/SuggestionCard.tsx';
import { useStore } from '../../store/index.ts';
import { useAuth } from '../../hooks/useAuth.ts';
import { useSuggestConsolidations, useDismissSuggestion } from '../../hooks/useSuggestions.ts';
import {
  useCreateSweepRule,
  useUpdateSweepRule,
  useDeleteSweepRule,
  useApplySweepRule,
} from '../../hooks/useSweepRules.ts';
import { computeSuggestionHash } from '../../lib/suggestionHash.ts';
import type { Suggestion, SweepRule } from '../../types/index.ts';

const useMockData = import.meta.env.VITE_USE_MOCK_DATA === 'true';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isPersistedId = (id: string) => UUID_RE.test(id);

interface Props {
  onClose: () => void;
}

export function SweepSuggestionsScreen({ onClose }: Props) {
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

  useEffect(() => {
    setError(null);
    if (useMockData || !user?.id) {
      runMockSuggestions(sweepRules).then(setSuggestions);
      return;
    }
    consolidationsMutation.mutate(undefined, {
      onSuccess: (data) => setSuggestions(data?.suggestions ?? []),
      onError: (err) => setError((err as Error).message),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          useStore.setState(s => ({ sweepRules: s.sweepRules.filter(x => x.id !== r.id) }));
          deleted.push(r);
        }
      } catch (err) {
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
          addSweepRule({ name, detail, criteria, criteriaLogic: logic, action: baseAction, delayHours: baseDelay });
        }

        for (const r of sources) {
          if (!useMockData && user?.id && isPersistedId(r.id)) {
            await deleteRuleMutation.mutateAsync({ id: r.id, userId: user.id });
          }
          useStore.setState(s => ({ sweepRules: s.sweepRules.filter(x => x.id !== r.id) }));
          deleted.push(r);
        }

        if (createdId && !useMockData && user?.id) {
          applyRuleMutation.mutateAsync({ ruleId: createdId, userId: user.id }).catch(err =>
            console.error('[Suggestions] Post-merge apply failed:', err),
          );
        }
      } catch (err) {
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
      const proposed = suggestion.proposedRule;
      if (!proposed?.criteria) throw new Error('Proposed rule has no criteria');
      const keepId = suggestion.keepRuleId ?? snapshot[0]?.id;
      const keeper = snapshot.find(r => r.id === keepId);
      if (!keeper) throw new Error('Absorbing rule not found');
      const absorbed = snapshot.filter(r => r.id !== keepId);

      const newCriteria = proposed.criteria;
      const newLogic = proposed.criteriaLogic ?? keeper.criteriaLogic;
      const prevKeeper = { ...keeper };
      const deleted: SweepRule[] = [];

      try {
        updateSweepRuleLocal(keeper.id, { criteria: newCriteria, criteriaLogic: newLogic });
        if (!useMockData && user?.id && isPersistedId(keeper.id)) {
          await updateRuleMutation.mutateAsync({
            id: keeper.id,
            user_id: user.id,
            criteria: newCriteria,
            criteria_logic: newLogic,
          });
        }
        for (const r of absorbed) {
          if (!useMockData && user?.id && isPersistedId(r.id)) {
            await deleteRuleMutation.mutateAsync({ id: r.id, userId: user.id });
          }
          useStore.setState(s => ({ sweepRules: s.sweepRules.filter(x => x.id !== r.id) }));
          deleted.push(r);
        }
      } catch (err) {
        updateSweepRuleLocal(keeper.id, { criteria: prevKeeper.criteria, criteriaLogic: prevKeeper.criteriaLogic });
        useStore.setState(s => ({ sweepRules: [...s.sweepRules, ...deleted] }));
        throw err;
      }
      return;
    }

    throw new Error(`Unsupported suggestion kind: ${suggestion.kind}`);
  };

  const handleEditRule = (ruleId: string) => {
    onClose();
    setTimeout(() => openSweepRuleEditorForRule(ruleId), 50);
  };

  const isLoading = consolidationsMutation.isPending;

  return (
    <div className="mobile-editor-overlay">
      <div className="mobile-screen">
        <MobileTopBar
          onBack={onClose}
          title="AI Review"
          rightSlot={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--text-tertiary)' }}>
            <Icons.Sparkle />
          </span>}
        />
        <div className="mobile-suggestions-body">
          {isLoading && <div className="mobile-suggestions-loading">Analyzing your rules…</div>}
          {error && <div className="mobile-suggestions-error">{error}</div>}
          {!isLoading && suggestions.length === 0 && !error && (
            <div className="mobile-suggestions-empty">No suggestions — your rules look tidy.</div>
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
      </div>
    </div>
  );
}

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
      const hash = await computeSuggestionHash({ kind: 'duplicate', ruleIds: sorted.map(r => r.id) });
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
