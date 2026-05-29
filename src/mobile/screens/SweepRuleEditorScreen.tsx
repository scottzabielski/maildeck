import { useState, useEffect, useMemo, useRef } from 'react';
import { Icons } from '../../components/ui/Icons.tsx';
import { useStore } from '../../store/index.ts';
import { useAuth } from '../../hooks/useAuth.ts';
import { useCreateSweepRule, useUpdateSweepRule, useApplySweepRule } from '../../hooks/useSweepRules.ts';
import { useSuggestRuleName } from '../../hooks/useSuggestions.ts';
import { MobileTopBar } from '../components/MobileTopBar.tsx';
import type { Criterion } from '../../types/index.ts';

const useMockData = import.meta.env.VITE_USE_MOCK_DATA === 'true';

export function SweepRuleEditorScreen() {
  const sweepRuleEditor = useStore(s => s.sweepRuleEditor);
  const closeSweepRuleEditor = useStore(s => s.closeSweepRuleEditor);
  const addSweepRule = useStore(s => s.addSweepRule);
  const applySweepAction = useStore(s => s.applySweepAction);
  const updateSweepRule = useStore(s => s.updateSweepRule);
  const sweepDelayHours = useStore(s => s.sweepDelayHours);
  const columns = useStore(s => s.columns);
  const sweepRules = useStore(s => s.sweepRules);

  const { user } = useAuth();
  const createMutation = useCreateSweepRule();
  const updateMutation = useUpdateSweepRule();
  const applyMutation = useApplySweepRule();
  const suggestNameMutation = useSuggestRuleName();

  const isEditMode = !!sweepRuleEditor?.ruleId;

  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [criteriaLogic, setCriteriaLogic] = useState<'and' | 'or'>('and');
  const [mode, setMode] = useState<'always' | 'keep_newest'>('always');
  const [subAction, setSubAction] = useState<'archive' | 'delete'>('archive');
  const [delayHours, setDelayHours] = useState(sweepDelayHours);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [nameUserEdited, setNameUserEdited] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);

  const selectedAction = mode === 'keep_newest' ? `keep_newest_${subAction}` : subAction;

  useEffect(() => {
    if (!sweepRuleEditor) return;
    setSuggestError(null);
    if (sweepRuleEditor.ruleId) {
      const rule = sweepRules.find(r => r.id === sweepRuleEditor.ruleId);
      if (rule) {
        setCriteria(rule.criteria.map(c => ({ ...c })));
        setCriteriaLogic(rule.criteriaLogic);
        if (rule.action.startsWith('keep_newest_')) {
          setMode('keep_newest');
          setSubAction(rule.action.replace('keep_newest_', '') as 'archive' | 'delete');
        } else {
          setMode('always');
          setSubAction(rule.action as 'archive' | 'delete');
        }
        setDelayHours(rule.delayHours);
        setName(rule.name);
        setNameUserEdited(true);
      }
    } else if (sweepRuleEditor.blank) {
      setCriteria([{ field: 'from', op: 'contains', value: '' }]);
      setCriteriaLogic('and');
      setMode('always');
      setSubAction('archive');
      setDelayHours(sweepDelayHours);
      setName('');
      setNameUserEdited(false);
    } else if (sweepRuleEditor.columnId && !sweepRuleEditor.emailId) {
      setCriteria([{ field: 'stream', op: 'equals', value: sweepRuleEditor.columnId }]);
      setCriteriaLogic('and');
      setMode('always');
      setSubAction('archive');
      setDelayHours(sweepDelayHours);
      setName('');
      setNameUserEdited(false);
    } else {
      const v = sweepRuleEditor.senderEmail || sweepRuleEditor.sender;
      setCriteria([{ field: 'from', op: 'contains', value: v }]);
      setCriteriaLogic('and');
      setMode('always');
      setSubAction('archive');
      setDelayHours(sweepDelayHours);
      setName('');
      setNameUserEdited(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sweepRuleEditor]);

  const derivedName = useMemo(() => {
    return criteria
      .filter(c => c.value.trim())
      .map(c => {
        if (c.field === 'stream') {
          const col = columns.find(col => col.id === c.value);
          return `Stream: "${col?.name || c.value}"`;
        }
        const fieldLabel = { from: 'From', to: 'To', subject: 'Subject', body: 'Body', label: 'Label' }[c.field] || c.field;
        return `${fieldLabel} ${c.op.replace('_', ' ')} "${c.value}"`;
      })
      .join(criteriaLogic === 'and' ? ' AND ' : ' OR ') || 'Untitled rule';
  }, [criteria, criteriaLogic, columns]);

  const lastAutoCriteriaKey = useRef<string>('');
  useEffect(() => {
    if (!sweepRuleEditor) return;
    if (isEditMode) return;
    if (nameUserEdited) return;
    const valid = criteria.filter(c => c.value.trim());
    if (valid.length === 0) return;
    const key = valid.map(c => `${c.field}|${c.op}|${c.value.trim().toLowerCase()}`).sort().join('\n') + `::${criteriaLogic}::${selectedAction}`;
    if (key === lastAutoCriteriaKey.current) return;

    const handle = setTimeout(() => {
      lastAutoCriteriaKey.current = key;
      runSuggestNameRef.current?.(false);
    }, 800);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [criteria, criteriaLogic, selectedAction, nameUserEdited, isEditMode, sweepRuleEditor]);

  const runSuggestNameRef = useRef<((markAsUserEdited: boolean) => Promise<void>) | null>(null);

  if (!sweepRuleEditor) return null;

  const addRow = () => setCriteria(prev => [...prev, { field: 'from', op: 'contains', value: '' }]);
  const removeRow = (i: number) => setCriteria(prev => prev.filter((_, idx) => idx !== i));
  const updateRow = (i: number, key: keyof Criterion, val: string) => {
    setCriteria(prev => prev.map((r, idx) => {
      if (idx !== i) return r;
      if (key === 'field' && val === 'stream') return { ...r, field: val, op: 'equals', value: '' };
      return { ...r, [key]: val };
    }));
  };

  const effectiveName = (nameUserEdited || name) && name.trim() ? name.trim() : derivedName;

  const runSuggestName = async (markAsUserEdited: boolean) => {
    const valid = criteria.filter(c => c.value.trim());
    if (valid.length === 0) return;
    setSuggestError(null);

    if (useMockData || !user?.id) {
      const fromC = valid.find(c => c.field === 'from');
      let guess = '';
      if (fromC) {
        const v = fromC.value.replace(/^["']+|["']+$/g, '');
        const domainMatch = v.match(/@?([^@\s]+\.[^@\s]+)/);
        const domain = domainMatch ? domainMatch[1] : v;
        const base = domain.split('.')[0];
        if (base) guess = base.charAt(0).toUpperCase() + base.slice(1);
      }
      if (guess) {
        setName(guess);
        if (markAsUserEdited) setNameUserEdited(true);
      }
      return;
    }

    try {
      const result = await suggestNameMutation.mutateAsync({
        criteria: valid,
        criteriaLogic,
        action: selectedAction,
        existingRuleNames: sweepRules.map(r => r.name).filter(Boolean),
      });
      if (result?.name) {
        setName(result.name);
        if (markAsUserEdited) setNameUserEdited(true);
      }
    } catch (err) {
      console.error('[Sweep] Name suggestion failed:', err);
      if (markAsUserEdited) setSuggestError('Could not generate a name.');
    }
  };

  const handleSuggestName = () => runSuggestName(true);
  runSuggestNameRef.current = runSuggestName;

  const handleApply = async () => {
    const valid = criteria.filter(c => c.value.trim());
    if (valid.length === 0) return;
    setError(null);

    const normalize = (c: Criterion[]) =>
      [...c].map(r => `${r.field}|${r.op}|${r.value.trim().toLowerCase()}`).sort().join('\n');
    const newNorm = normalize(valid);
    const duplicate = sweepRules.find(r => {
      if (isEditMode && r.id === sweepRuleEditor.ruleId) return false;
      if (r.criteriaLogic !== criteriaLogic) return false;
      return normalize(r.criteria.filter(c => c.value.trim())) === newNorm;
    });
    if (duplicate) {
      setError(`A rule with these criteria already exists: "${duplicate.name}".`);
      return;
    }

    const ruleName = effectiveName;
    const effectiveDelay = mode === 'keep_newest' ? 0 : delayHours;
    const detail = mode === 'keep_newest'
      ? `Keep newest, ${subAction} rest immediately`
      : subAction === 'delete'
        ? `Auto-delete after ${effectiveDelay}h`
        : `Auto-archive after ${effectiveDelay}h`;

    if (isEditMode) {
      const ruleId = sweepRuleEditor.ruleId!;
      const updates = { name: ruleName, detail, criteria: valid, criteriaLogic, action: selectedAction, delayHours: effectiveDelay };
      updateSweepRule(ruleId, updates);
      if (!useMockData && user?.id) {
        try {
          await updateMutation.mutateAsync({
            id: ruleId,
            user_id: user.id,
            name: ruleName,
            detail,
            criteria: valid,
            criteria_logic: criteriaLogic,
            action: selectedAction,
            delay_hours: effectiveDelay,
          });
          applyMutation.mutateAsync({ ruleId, userId: user.id }).catch(err =>
            console.error('[Sweep] Re-apply failed:', err),
          );
        } catch (err) {
          console.error('[Sweep] Failed to update rule:', err);
          setError('Failed to save rule.');
          return;
        }
      }
      applySweepAction(valid, criteriaLogic, selectedAction, effectiveDelay);
      closeSweepRuleEditor();
      return;
    }

    if (useMockData || !user?.id) {
      applySweepAction(valid, criteriaLogic, selectedAction, effectiveDelay);
      addSweepRule({ name: ruleName, detail, criteria: valid, criteriaLogic, action: selectedAction, delayHours: effectiveDelay });
    } else {
      let created;
      try {
        created = await createMutation.mutateAsync({
          user_id: user.id,
          name: ruleName,
          detail,
          is_enabled: true,
          sender_pattern: null,
          criteria: valid,
          criteria_logic: criteriaLogic,
          action: selectedAction,
          delay_hours: effectiveDelay,
        });
      } catch (err) {
        console.error('[Sweep] Failed to create rule:', err);
        setError('Failed to create rule.');
        return;
      }
      try {
        await applyMutation.mutateAsync({ ruleId: created.id, userId: user.id });
      } catch (err) {
        console.error('[Sweep] Apply failed:', err);
      }
      applySweepAction(valid, criteriaLogic, selectedAction, effectiveDelay);
      addSweepRule({ name: ruleName, detail, criteria: valid, criteriaLogic, action: selectedAction, delayHours: effectiveDelay });
    }
    closeSweepRuleEditor();
  };

  const hasValid = criteria.some(c => c.value.trim());
  const isApplying = createMutation.isPending || applyMutation.isPending || updateMutation.isPending;

  return (
    <div className="mobile-editor-overlay">
      <div className="mobile-screen">
        <MobileTopBar
          onBack={closeSweepRuleEditor}
          title={isEditMode ? 'Edit sweep rule' : 'New sweep rule'}
          rightSlot={
            <button
              type="button"
              className="mobile-editor-save"
              onClick={handleApply}
              disabled={!hasValid || isApplying}
            >
              {isApplying ? '…' : (isEditMode ? 'Save' : 'Apply')}
            </button>
          }
        />
        <div className="mobile-editor-body">
          <div className="mobile-editor-field">
            <label className="mobile-editor-label">Name</label>
            <div className="mobile-editor-name-row">
              <input
                type="text"
                className="mobile-editor-input"
                value={name}
                placeholder={suggestNameMutation.isPending ? 'Thinking…' : derivedName}
                onChange={(e) => { setName(e.target.value); setNameUserEdited(true); }}
              />
              <button
                type="button"
                className="mobile-editor-suggest"
                onClick={handleSuggestName}
                disabled={!hasValid || suggestNameMutation.isPending}
              >
                <Icons.Sparkle />
                {suggestNameMutation.isPending ? '…' : 'Suggest'}
              </button>
            </div>
            {suggestError && <div className="mobile-error" style={{ marginTop: 4 }}>{suggestError}</div>}
          </div>
          <div className="mobile-editor-field">
            <div className="mobile-editor-label-row">
              <label className="mobile-editor-label">Match emails where</label>
              <button
                type="button"
                className={`mobile-editor-logic-badge ${criteriaLogic}`}
                onClick={() => setCriteriaLogic(l => l === 'and' ? 'or' : 'and')}
              >
                {criteriaLogic}
              </button>
            </div>
            {criteria.map((row, i) => (
              <div key={i} className="mobile-editor-criterion">
                <select
                  className="mobile-editor-select"
                  value={row.field}
                  onChange={(e) => updateRow(i, 'field', e.target.value)}
                >
                  <option value="from">From</option>
                  <option value="to">To</option>
                  <option value="subject">Subject</option>
                  <option value="body">Body</option>
                  <option value="label">Label</option>
                  <option value="stream">Stream</option>
                </select>
                {row.field === 'stream' ? (
                  <span className="mobile-editor-select" style={{ fontStyle: 'italic', color: 'var(--text-tertiary)' }}>
                    is part of
                  </span>
                ) : (
                  <select
                    className="mobile-editor-select"
                    value={row.op}
                    onChange={(e) => updateRow(i, 'op', e.target.value)}
                  >
                    <option value="contains">contains</option>
                    <option value="not_contains">not contains</option>
                    <option value="equals">equals</option>
                    <option value="starts_with">starts with</option>
                    <option value="ends_with">ends with</option>
                  </select>
                )}
                {row.field === 'stream' ? (
                  <select
                    className="mobile-editor-input"
                    value={row.value}
                    onChange={(e) => updateRow(i, 'value', e.target.value)}
                  >
                    <option value="">Select stream…</option>
                    {columns.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    className="mobile-editor-input"
                    value={row.value}
                    onChange={(e) => updateRow(i, 'value', e.target.value)}
                    placeholder="Value…"
                  />
                )}
                <button
                  type="button"
                  className="mobile-editor-remove"
                  onClick={() => removeRow(i)}
                  disabled={criteria.length <= 1}
                  aria-label="Remove condition"
                >
                  <Icons.Minus />
                </button>
              </div>
            ))}
            <button
              type="button"
              className="mobile-editor-add"
              onClick={addRow}
            >
              <Icons.Plus /> Add condition
            </button>
          </div>

          <div className="mobile-editor-field">
            <label className="mobile-editor-label">Action</label>
            <div className="mobile-editor-options">
              <RuleOption
                title="Only Keep Most Recent"
                desc="When a new matching email arrives, sweep all older matches"
                selected={mode === 'keep_newest'}
                onSelect={() => setMode('keep_newest')}
              />
              {mode === 'keep_newest' && (
                <div className="mobile-editor-sub-options">
                  <SubOption label="Archive older" selected={subAction === 'archive'} onSelect={() => setSubAction('archive')} />
                  <SubOption label="Delete older" danger selected={subAction === 'delete'} onSelect={() => setSubAction('delete')} />
                </div>
              )}
              <RuleOption
                title="Archive"
                desc="Automatically archive matching messages after the delay"
                selected={mode === 'always' && subAction === 'archive'}
                onSelect={() => { setMode('always'); setSubAction('archive'); }}
              />
              <RuleOption
                title="Delete"
                desc="Permanently delete matching messages after the delay"
                danger
                selected={mode === 'always' && subAction === 'delete'}
                onSelect={() => { setMode('always'); setSubAction('delete'); }}
              />
            </div>
          </div>

          {mode !== 'keep_newest' && (
            <div className="mobile-editor-field">
              <label className="mobile-editor-label">Delay before {subAction === 'delete' ? 'deleting' : 'archiving'}</label>
              <select
                className="mobile-editor-input"
                value={String(delayHours)}
                onChange={(e) => setDelayHours(Number(e.target.value))}
              >
                <option value="1">1 hour</option>
                <option value="6">6 hours</option>
                <option value="12">12 hours</option>
                <option value="24">24 hours</option>
                <option value="48">48 hours</option>
                <option value="168">7 days</option>
              </select>
            </div>
          )}

          {error && <div className="mobile-error" style={{ marginTop: 8 }}>{error}</div>}
        </div>
      </div>
    </div>
  );
}

interface RuleOptionProps {
  title: string;
  desc: string;
  selected: boolean;
  danger?: boolean;
  onSelect: () => void;
}

function RuleOption({ title, desc, selected, danger, onSelect }: RuleOptionProps) {
  return (
    <button
      type="button"
      className={`mobile-editor-option${selected ? ' selected' : ''}${danger ? ' danger' : ''}`}
      onClick={onSelect}
    >
      <span className="mobile-editor-option-radio" />
      <span className="mobile-editor-option-text">
        <span className="mobile-editor-option-title">{title}</span>
        <span className="mobile-editor-option-desc">{desc}</span>
      </span>
    </button>
  );
}

function SubOption({ label, selected, danger, onSelect }: { label: string; selected: boolean; danger?: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      className={`mobile-editor-sub-option${selected ? ' selected' : ''}${danger ? ' danger' : ''}`}
      onClick={onSelect}
    >
      <span className="mobile-editor-sub-radio" />
      {label}
    </button>
  );
}
