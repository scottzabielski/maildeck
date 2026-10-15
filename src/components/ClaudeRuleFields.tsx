import { useState } from 'react';
import { Icons } from './ui/Icons.tsx';
import { useDraftSweepRule, type RuleDraftResult } from '../hooks/useSuggestions.ts';
import { CLAUDE_CHECK_MODELS, actionDeletes } from '../lib/claudeCheck.ts';
import type { ClaudeCheck } from '../types/index.ts';

/**
 * The Claude parts of the sweep rule editors (desktop and mobile): drafting a
 * rule from a plain-English description, and a rule's Claude check, the
 * plain-English condition Claude checks each match against before sweeping.
 */

/** "Describe the rule": drafts the editor's fields from plain English. */
export function RuleDescriptionBuilder({ onDraft }: { onDraft: (result: RuleDraftResult) => void }) {
  const [text, setText] = useState('');
  const [result, setResult] = useState<RuleDraftResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const draftMutation = useDraftSweepRule();
  const canBuild = text.trim().length >= 5 && !draftMutation.isPending;

  const build = async () => {
    if (!canBuild) return;
    setError(null);
    setResult(null);
    try {
      const r = await draftMutation.mutateAsync({ description: text.trim() });
      setResult(r);
      onDraft(r);
    } catch (err) {
      setError((err as Error).message || "Couldn't build the rule.");
    }
  };

  return (
    <div className="claude-rule-builder">
      <label className="claude-rule-label" htmlFor="claude-rule-description">Describe the rule</label>
      <textarea
        id="claude-rule-description"
        className="claude-rule-textarea"
        rows={2}
        value={text}
        maxLength={1000}
        placeholder="e.g. Archive surveys and feedback requests from companies after a week, but not ones from people I know"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) build(); }}
      />
      <div className="claude-rule-row">
        <button type="button" className="btn-secondary suggest-name-btn" onClick={build} disabled={!canBuild}>
          <Icons.Sparkle />
          {draftMutation.isPending ? 'Building…' : 'Build rule'}
        </button>
        <span className="claude-rule-hint">Fills in the rule below for you to review before saving.</span>
      </div>
      {error && <div className="claude-rule-error">{error}</div>}
      {result && (
        <div className={`claude-rule-result${result.draft.ai_check ? ' uses-claude' : ''}`}>
          <strong>{result.draft.ai_check ? 'Uses a Claude check.' : 'Regular conditions are enough.'}</strong>{' '}
          {result.explanation}
          {result.warnings.map((w) => <div key={w} className="claude-rule-warning">{w}</div>)}
        </div>
      )}
    </div>
  );
}

/** A rule's Claude check: on/off, what to look for, the model, and (for deleting rules) permission to delete. */
export function ClaudeCheckFields({ value, onChange, action }: {
  value: ClaudeCheck;
  onChange: (value: ClaudeCheck) => void;
  action: string;
}) {
  return (
    <div className={`claude-check-fields${value.enabled ? ' enabled' : ''}`}>
      <label className="claude-check-toggle">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(e) => onChange({ ...value, enabled: e.target.checked })}
        />
        <span>Check each match with Claude before sweeping it</span>
      </label>
      {value.enabled && (
        <>
          <textarea
            className="claude-rule-textarea"
            rows={3}
            value={value.instruction}
            maxLength={1000}
            placeholder="Describe the mail to sweep, e.g. an automated survey or feedback request sent by a company's system, not a personal email from someone I know"
            onChange={(e) => onChange({ ...value, instruction: e.target.value })}
          />
          <div className="claude-rule-row">
            <select
              className="claude-check-model"
              value={value.model}
              onChange={(e) => onChange({ ...value, model: e.target.value })}
            >
              {CLAUDE_CHECK_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
            <span className="claude-rule-hint">
              Claude reads each match's sender, subject and opening text. Only matches are swept; ones it's unsure about wait in the Review stream.
            </span>
          </div>
          {actionDeletes(action) && (
            <label className="claude-check-toggle danger">
              <input
                type="checkbox"
                checked={value.allowDelete}
                onChange={(e) => onChange({ ...value, allowDelete: e.target.checked })}
              />
              <span>Let this rule delete what Claude confirms (otherwise a Claude-checked rule can only archive)</span>
            </label>
          )}
        </>
      )}
    </div>
  );
}
