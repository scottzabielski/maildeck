import { useMemo } from 'react';
import { Icons } from './ui/Icons.tsx';
import type { Criterion, Suggestion, SweepRule } from '../types/index.ts';
import { emailMatchesCriteria, beginCriteriaMatch, endCriteriaMatch } from '../lib/emailFilter.ts';
import { useStore } from '../store/index.ts';

interface Props {
  suggestion: Suggestion;
  rulesById: Map<string, SweepRule>;
  busy: boolean;
  onApply: (suggestion: Suggestion) => void;
  onDismiss: (suggestion: Suggestion) => void;
  onEditRule?: (ruleId: string) => void;
}

const KIND_LABEL: Record<Suggestion['kind'], string> = {
  duplicate: 'Duplicate',
  merge: 'Merge',
  absorb: 'Absorb',
  redundant: 'Redundant',
  rename: 'Rename',
  conflict: 'Conflict',
};

export function SuggestionCard({ suggestion, rulesById, busy, onApply, onDismiss, onEditRule }: Props) {
  const involved = suggestion.ruleIds.map(id => rulesById.get(id)).filter((r): r is SweepRule => !!r);
  const emails = useStore(s => s.emails);

  // Dry-run match counts for kinds that change matching behavior.
  const dryRun = useMemo(() => {
    if (!['merge', 'absorb', 'redundant'].includes(suggestion.kind)) return null;
    if (!suggestion.proposedRule && suggestion.kind !== 'redundant') return null;

    beginCriteriaMatch();
    try {
      // Current matches: union of all involved rules' matches.
      const currentMatches = new Set<string>();
      for (const r of involved) {
        for (const e of emails) {
          if (emailMatchesCriteria(e, r.criteria, r.criteriaLogic)) currentMatches.add(e.id);
        }
      }

      let proposedCount = 0;
      if (suggestion.kind === 'redundant' && suggestion.keepRuleId) {
        const keeper = rulesById.get(suggestion.keepRuleId);
        if (keeper) {
          for (const e of emails) {
            if (emailMatchesCriteria(e, keeper.criteria, keeper.criteriaLogic)) proposedCount++;
          }
        }
      } else if (suggestion.proposedRule?.criteria) {
        const c = suggestion.proposedRule.criteria;
        const logic = suggestion.proposedRule.criteriaLogic ?? 'or';
        for (const e of emails) {
          if (emailMatchesCriteria(e, c, logic)) proposedCount++;
        }
      }
      return { current: currentMatches.size, proposed: proposedCount };
    } finally {
      endCriteriaMatch();
    }
  }, [suggestion, involved, emails, rulesById]);

  const isConflict = suggestion.kind === 'conflict';

  return (
    <div className={`suggestion-card kind-${suggestion.kind}${isConflict ? ' conflict' : ''}`}>
      <div className="suggestion-card-header">
        <span className={`suggestion-kind-badge kind-${suggestion.kind}`}>
          {KIND_LABEL[suggestion.kind]}
        </span>
        <span className={`suggestion-confidence conf-${suggestion.confidence}`}>{suggestion.confidence}</span>
      </div>

      <div className="suggestion-rationale">{suggestion.rationale}</div>

      <div className="suggestion-body">
        <SuggestionDetail
          suggestion={suggestion}
          involved={involved}
        />
      </div>

      {dryRun && (
        <div className="suggestion-drypreview">
          Currently matches <strong>{dryRun.current}</strong> loaded email{dryRun.current === 1 ? '' : 's'} —
          {' '}after this change: <strong>{dryRun.proposed}</strong>
        </div>
      )}

      <div className="suggestion-actions">
        {isConflict ? (
          involved.map(r => (
            <button
              key={r.id}
              className="btn-secondary"
              onClick={() => onEditRule?.(r.id)}
              type="button"
            >
              Edit "{shorten(r.name, 24)}"
            </button>
          ))
        ) : (
          <>
            <button
              className="btn-secondary"
              onClick={() => onDismiss(suggestion)}
              disabled={busy}
              type="button"
            >
              Dismiss
            </button>
            <button
              className="btn-primary"
              onClick={() => onApply(suggestion)}
              disabled={busy}
              type="button"
            >
              Apply
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function SuggestionDetail({ suggestion, involved }: { suggestion: Suggestion; involved: SweepRule[] }) {
  const { kind, proposedRule, keepRuleId } = suggestion;

  if (kind === 'rename') {
    const target = involved[0];
    return (
      <div className="suggestion-rename">
        <RulePill rule={target} dim />
        <span className="suggestion-arrow">→</span>
        <span className="suggestion-rename-new">{proposedRule?.name ?? '—'}</span>
      </div>
    );
  }

  if (kind === 'conflict') {
    return (
      <div className="suggestion-stack">
        {involved.map(r => (
          <div key={r.id} className="suggestion-row-conflict">
            <RulePill rule={r} />
            <span className="suggestion-action-pill">{r.action}</span>
          </div>
        ))}
      </div>
    );
  }

  if (kind === 'duplicate' || kind === 'redundant') {
    return (
      <div className="suggestion-stack">
        {involved.map(r => (
          <div key={r.id} className="suggestion-row">
            <RulePill rule={r} dim={keepRuleId !== r.id} />
            {keepRuleId === r.id && <span className="suggestion-keep">keep</span>}
          </div>
        ))}
      </div>
    );
  }

  // merge / absorb
  return (
    <div className="suggestion-merge">
      <div className="suggestion-stack">
        {involved.map(r => (
          <RulePill key={r.id} rule={r} dim />
        ))}
      </div>
      <div className="suggestion-arrow vert">↓</div>
      <div className="suggestion-proposed">
        <strong>{proposedRule?.name || 'Combined rule'}</strong>
        {proposedRule?.criteria && (
          <div className="suggestion-criteria">
            {formatCriteria(proposedRule.criteria, proposedRule.criteriaLogic ?? 'or')}
          </div>
        )}
      </div>
    </div>
  );
}

function RulePill({ rule, dim }: { rule: SweepRule; dim?: boolean }) {
  return (
    <div className={`suggestion-rule-pill${dim ? ' dim' : ''}`}>
      <Icons.Sweep />
      <span className="suggestion-rule-name">{rule.name}</span>
      <span className="suggestion-rule-criteria">
        {formatCriteria(rule.criteria, rule.criteriaLogic)}
      </span>
    </div>
  );
}

function formatCriteria(criteria: Criterion[] | undefined, logic: 'and' | 'or'): string {
  if (!criteria || criteria.length === 0) return '';
  const joiner = logic === 'and' ? ' AND ' : ' OR ';
  return criteria
    .filter(c => c.value?.trim())
    .map(c => {
      const fieldLabel = { from: 'From', to: 'To', subject: 'Subject', body: 'Body', label: 'Label', stream: 'Stream' }[c.field] || c.field;
      return `${fieldLabel} ${c.op.replace('_', ' ')} "${c.value}"`;
    })
    .join(joiner);
}

function shorten(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

export type { Suggestion };
