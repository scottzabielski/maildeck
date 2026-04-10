import { useState, useEffect } from 'react';
import { Icons } from './ui/Icons.tsx';
import { useStore } from '../store/index.ts';
import { useAuth } from '../hooks/useAuth.ts';
import { useCreateSweepRule, useUpdateSweepRule, useApplySweepRule } from '../hooks/useSweepRules.ts';
import type { Criterion } from '../types/index.ts';

const useMockData = import.meta.env.VITE_USE_MOCK_DATA === 'true';

export function SweepRuleEditor() {
  const { sweepRuleEditor, closeSweepRuleEditor, addSweepRule, applySweepAction, sweepDelayHours, emails, columns, sweepRules, updateSweepRule } = useStore();
  const { user } = useAuth();
  const createSweepRuleMutation = useCreateSweepRule();
  const updateSweepRuleMutation = useUpdateSweepRule();
  const applySweepRuleMutation = useApplySweepRule();

  const isEditMode = !!sweepRuleEditor?.ruleId;

  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [criteriaLogic, setCriteriaLogic] = useState<'and' | 'or'>('and');
  const [mode, setMode] = useState<'always' | 'keep_newest'>('always');
  const [subAction, setSubAction] = useState<'archive' | 'delete'>('archive');
  const [delayHours, setDelayHours] = useState(sweepDelayHours);
  const [error, setError] = useState<string | null>(null);

  // Compute the compound action from mode + subAction
  const selectedAction = mode === 'keep_newest' ? `keep_newest_${subAction}` : subAction;

  useEffect(() => {
    if (sweepRuleEditor) {
      if (sweepRuleEditor.ruleId) {
        // Edit mode: pre-fill from existing rule
        const rule = sweepRules.find(r => r.id === sweepRuleEditor.ruleId);
        if (rule) {
          setCriteria(rule.criteria.map(c => ({ ...c })));
          setCriteriaLogic(rule.criteriaLogic);
          // Parse compound action
          if (rule.action.startsWith('keep_newest_')) {
            setMode('keep_newest');
            setSubAction(rule.action.replace('keep_newest_', '') as 'archive' | 'delete');
          } else {
            setMode('always');
            setSubAction(rule.action as 'archive' | 'delete');
          }
          setDelayHours(rule.delayHours);
        }
      } else if (sweepRuleEditor.blank) {
        // Create mode: blank new rule
        setCriteria([{ field: 'from', op: 'contains', value: '' }]);
        setCriteriaLogic('and');
        setMode('always');
        setSubAction('archive');
        setDelayHours(sweepDelayHours);
      } else if (sweepRuleEditor.columnId && !sweepRuleEditor.emailId) {
        // Create mode: pre-fill from stream column
        setCriteria([{ field: 'stream', op: 'equals', value: sweepRuleEditor.columnId }]);
        setCriteriaLogic('and');
        setMode('always');
        setSubAction('archive');
        setDelayHours(sweepDelayHours);
      } else {
        // Create mode: pre-fill from email
        const initialValue = sweepRuleEditor.senderEmail || sweepRuleEditor.sender;
        setCriteria([{ field: 'from', op: 'contains', value: initialValue }]);
        setCriteriaLogic('and');
        setMode('always');
        setSubAction('archive');
        setDelayHours(sweepDelayHours);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sweepRuleEditor]);

  if (!sweepRuleEditor) return null;

  const isDanger = subAction === 'delete';

  // Pre-fill values by field based on the source email
  const prefillForField = (field: string): string => {
    switch (field) {
      case 'from': return sweepRuleEditor.senderEmail || sweepRuleEditor.sender;
      case 'to': return sweepRuleEditor.toEmail;
      case 'subject': return sweepRuleEditor.subject;
      case 'stream': return sweepRuleEditor.columnId || '';
      default: return '';
    }
  };

  // Set of values that came from prefill (to detect if user changed it)
  const prefillValues = new Set([
    sweepRuleEditor.senderEmail || sweepRuleEditor.sender,
    sweepRuleEditor.subject,
    sweepRuleEditor.toEmail,
  ].filter(Boolean));

  const addRow = () => setCriteria([...criteria, { field: 'from', op: 'contains', value: '' }]);
  const removeRow = (i: number) => setCriteria(criteria.filter((_, idx) => idx !== i));
  const updateRow = (i: number, key: keyof Criterion, val: string) => {
    setCriteria(criteria.map((r, idx) => {
      if (idx !== i) return r;
      // When field changes, auto-fill value if it's empty or was a prefill from the previous field
      if (key === 'field') {
        const wasEmpty = !r.value.trim();
        const wasPrefill = prefillValues.has(r.value);
        const newValue = (wasEmpty || wasPrefill) ? prefillForField(val) : (val === 'stream' ? '' : r.value);
        return { ...r, field: val, op: val === 'stream' ? 'equals' : r.op, value: newValue };
      }
      return { ...r, [key]: val };
    }));
  };

  const buildRuleName = () => {
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
  };

  const handleApply = async () => {
    const validCriteria = criteria.filter(c => c.value.trim());
    if (validCriteria.length === 0) return;
    setError(null);

    // Check for duplicate criteria against existing rules
    const normalizeCriteria = (c: Criterion[]) =>
      [...c].map(r => `${r.field}|${r.op}|${r.value.trim().toLowerCase()}`).sort().join('\n');

    const newNorm = normalizeCriteria(validCriteria);
    const duplicate = sweepRules.find(r => {
      if (isEditMode && r.id === sweepRuleEditor!.ruleId) return false;
      if (r.criteriaLogic !== criteriaLogic) return false;
      const existingValid = r.criteria.filter(c => c.value.trim());
      return normalizeCriteria(existingValid) === newNorm;
    });

    if (duplicate) {
      const dupDesc = duplicate.criteria
        .filter(c => c.value.trim())
        .map(c => {
          if (c.field === 'stream') {
            const col = columns.find(col => col.id === c.value);
            return `Stream: "${col?.name || c.value}"`;
          }
          const fieldLabel = { from: 'From', to: 'To', subject: 'Subject', body: 'Body', label: 'Label' }[c.field] || c.field;
          return `${fieldLabel} ${c.op.replace('_', ' ')} "${c.value}"`;
        })
        .join(duplicate.criteriaLogic === 'and' ? ' AND ' : ' OR ');
      setError(`A rule with these criteria already exists: ${dupDesc}`);
      return;
    }

    const ruleName = buildRuleName();
    const effectiveDelay = mode === 'keep_newest' ? 0 : delayHours;
    const detail = mode === 'keep_newest'
      ? `Keep newest, ${subAction} rest immediately`
      : subAction === 'delete'
        ? `Auto-delete after ${effectiveDelay}h`
        : `Auto-archive after ${effectiveDelay}h`;

    if (isEditMode) {
      // Edit mode: update existing rule
      const ruleId = sweepRuleEditor!.ruleId!;
      const updates = { name: ruleName, detail, criteria: validCriteria, criteriaLogic, action: selectedAction, delayHours: effectiveDelay };

      // Update in-memory store immediately
      updateSweepRule(ruleId, updates);

      // Persist to DB
      if (!useMockData && user?.id) {
        try {
          await updateSweepRuleMutation.mutateAsync({
            id: ruleId,
            user_id: user.id,
            name: ruleName,
            detail,
            criteria: validCriteria,
            criteria_logic: criteriaLogic,
            action: selectedAction,
            delay_hours: effectiveDelay,
          });
        } catch (err) {
          console.error('[Sweep] Failed to update rule:', err);
          setError('Failed to save rule. Please try again.');
          return;
        }

        // Re-apply the updated rule server-side (fire-and-forget).
        // The function reads criteria/action/delay from the DB row, so we
        // only need to pass the rule id here.
        applySweepRuleMutation.mutateAsync({
          ruleId,
          userId: user.id,
        }).catch(err => console.error('[Sweep] Edge function re-apply failed:', err));
      }

      // Immediate client-side feedback for loaded emails
      applySweepAction(validCriteria, criteriaLogic, selectedAction, effectiveDelay);
      closeSweepRuleEditor();
      return;
    }

    if (useMockData || !user?.id) {
      // Mock mode or no auth: update in-memory store only
      console.warn('[Sweep] No user auth, falling back to in-memory only. useMockData:', useMockData, 'user:', user?.id);
      applySweepAction(validCriteria, criteriaLogic, selectedAction, effectiveDelay);
      addSweepRule({ name: ruleName, detail, criteria: validCriteria, criteriaLogic, action: selectedAction, delayHours: effectiveDelay });
    } else {
      // Real mode: persist rule to DB, then queue matching emails
      const userId = user.id;

      // 1. Create sweep rule in DB
      let createdRule;
      try {
        createdRule = await createSweepRuleMutation.mutateAsync({
          user_id: userId,
          name: ruleName,
          detail,
          is_enabled: true,
          sender_pattern: null,
          criteria: validCriteria,
          criteria_logic: criteriaLogic,
          action: selectedAction,
          delay_hours: effectiveDelay,
        });
      } catch (err) {
        console.error('[Sweep] Failed to create rule:', err);
        setError('Failed to create rule. Please try again.');
        return;
      }

      // 2. Apply rule server-side against the full emails table.
      // The function reads criteria/action/delay from the DB row.
      try {
        await applySweepRuleMutation.mutateAsync({
          ruleId: createdRule.id,
          userId,
        });
      } catch (err) {
        console.error('[Sweep] Edge function apply failed:', err);
      }

      // Also update in-memory store immediately for instant UI feedback
      applySweepAction(validCriteria, criteriaLogic, selectedAction, effectiveDelay);
      addSweepRule({ name: ruleName, detail, criteria: validCriteria, criteriaLogic, action: selectedAction, delayHours: effectiveDelay });
    }

    closeSweepRuleEditor();
  };

  const hasValidCriteria = criteria.some(c => c.value.trim());
  const isApplying = createSweepRuleMutation.isPending || applySweepRuleMutation.isPending || updateSweepRuleMutation.isPending;

  const delayLabel = `Delay before ${isDanger ? 'deleting' : 'archiving'}`;

  const applyLabel = isApplying
    ? (isEditMode ? 'Saving...' : 'Applying...')
    : isEditMode
      ? 'Save'
      : mode === 'keep_newest'
        ? 'Apply'
        : isDanger ? 'Delete All' : 'Apply';

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) closeSweepRuleEditor(); }}
    >
      <div className="criteria-editor">
        {/* Header */}
        <div className="criteria-header">
          <span className="criteria-title">{isEditMode ? 'Edit Sweep Rule' : 'Create Sweep Rule'}</span>
          <button className="criteria-close" onClick={closeSweepRuleEditor}>
            <Icons.Close />
          </button>
        </div>
        {/* Body */}
        <div className="criteria-body">
          {/* Criteria builder */}
          <div className="filter-group">
            <div className="filter-group-header">
              <button
                className={`filter-logic-badge ${criteriaLogic}`}
                onClick={() => setCriteriaLogic(criteriaLogic === 'and' ? 'or' : 'and')}
              >
                {criteriaLogic}
              </button>
              <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                Click to toggle logic
              </span>
            </div>
            {criteria.map((row, i) => (
              <div key={i} className="filter-row">
                <select
                  className="filter-select"
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
                  <span className="filter-select" style={{ display: 'inline-flex', alignItems: 'center', color: 'var(--text-tertiary)', fontStyle: 'italic', cursor: 'default' }}>
                    is part of
                  </span>
                ) : (
                  <select
                    className="filter-select"
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
                    className="filter-select"
                    style={{ flex: 1 }}
                    value={row.value}
                    onChange={(e) => updateRow(i, 'value', e.target.value)}
                  >
                    <option value="">Select stream...</option>
                    {columns.map(col => (
                      <option key={col.id} value={col.id}>{col.name}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="filter-input"
                    value={row.value}
                    onChange={(e) => updateRow(i, 'value', e.target.value)}
                    placeholder="Value..."
                  />
                )}
                <button
                  className="filter-remove-btn"
                  onClick={() => removeRow(i)}
                  disabled={criteria.length <= 1}
                  style={criteria.length <= 1 ? { opacity: 0.3, cursor: 'default' } : undefined}
                >
                  <Icons.Minus />
                </button>
              </div>
            ))}
            <button className="add-filter-btn" onClick={addRow}>
              <Icons.Plus /> Add condition
            </button>
          </div>

          {/* Radio options */}
          <div className="sweep-rule-options">
            {/* Only Keep Most Recent */}
            <div
              className={`sweep-rule-option${mode === 'keep_newest' ? ' selected' : ''}`}
              onClick={() => setMode('keep_newest')}
            >
              <div className="sweep-rule-option-radio" />
              <div className="sweep-rule-option-content">
                <div className="sweep-rule-option-title">Only Keep Most Recent</div>
                <div className="sweep-rule-option-desc">When a new matching email arrives, sweep all older matches</div>
                {mode === 'keep_newest' && (
                  <div className="sweep-rule-sub-options">
                    <div
                      className={`sweep-rule-sub-option${subAction === 'archive' ? ' selected' : ''}`}
                      onClick={(e) => { e.stopPropagation(); setSubAction('archive'); }}
                    >
                      <div className="sweep-rule-sub-radio" />
                      <span>Archive older</span>
                    </div>
                    <div
                      className={`sweep-rule-sub-option${subAction === 'delete' ? ' selected danger' : ''}`}
                      onClick={(e) => { e.stopPropagation(); setSubAction('delete'); }}
                    >
                      <div className="sweep-rule-sub-radio" />
                      <span>Delete older</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
            {/* Archive */}
            <div
              className={`sweep-rule-option${mode === 'always' && subAction === 'archive' ? ' selected' : ''}`}
              onClick={() => { setMode('always'); setSubAction('archive'); }}
            >
              <div className="sweep-rule-option-radio" />
              <div className="sweep-rule-option-content">
                <div className="sweep-rule-option-title">Archive</div>
                <div className="sweep-rule-option-desc">Automatically archive matching messages after the delay</div>
              </div>
            </div>
            {/* Delete */}
            <div
              className={`sweep-rule-option${mode === 'always' && subAction === 'delete' ? ' selected danger' : ''}`}
              onClick={() => { setMode('always'); setSubAction('delete'); }}
            >
              <div className="sweep-rule-option-radio" />
              <div className="sweep-rule-option-content">
                <div className="sweep-rule-option-title">Delete</div>
                <div className="sweep-rule-option-desc">Permanently delete matching messages after the delay</div>
              </div>
            </div>
          </div>
          {/* Delay dropdown */}
          <div className="sweep-rule-delay" style={mode === 'keep_newest' ? { opacity: 0.4, pointerEvents: 'none' } : undefined}>
            <label>{mode === 'keep_newest' ? 'Older emails are swept immediately' : delayLabel}</label>
            {mode !== 'keep_newest' && (
              <select
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
            )}
          </div>
        </div>
        {error && <div style={{ padding: '0 16px 8px', color: '#ef4444', fontSize: '12px' }}>{error}</div>}
        {/* Footer */}
        <div className="criteria-footer">
          <button className="btn-secondary" onClick={closeSweepRuleEditor}>Cancel</button>
          <button
            className={isDanger && mode !== 'keep_newest' ? 'btn-danger' : 'btn-primary'}
            onClick={handleApply}
            disabled={!hasValidCriteria || isApplying}
            style={(!hasValidCriteria || isApplying) ? { opacity: 0.5, cursor: 'default' } : undefined}
          >
            {applyLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
