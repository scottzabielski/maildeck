import { useState, useEffect } from 'react';
import { Icons } from './ui/Icons.tsx';
import { useStore } from '../store/index.ts';
import { useAuth } from '../hooks/useAuth.ts';
import { useCreateSweepRule } from '../hooks/useSweepRules.ts';
import { useAddToSweepQueue } from '../hooks/useSweepQueue.ts';
import { emailMatchesCriteria } from '../lib/emailFilter.ts';
import type { Criterion } from '../types/index.ts';

const useMockData = import.meta.env.VITE_USE_MOCK_DATA === 'true';

export function SweepRuleEditor() {
  const { sweepRuleEditor, closeSweepRuleEditor, addSweepRule, applySweepAction, sweepDelayHours, emails, columns } = useStore();
  const { user } = useAuth();
  const createSweepRuleMutation = useCreateSweepRule();
  const addToSweepQueueMutation = useAddToSweepQueue();

  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [criteriaLogic, setCriteriaLogic] = useState<'and' | 'or'>('and');
  const [selectedAction, setSelectedAction] = useState('archive');
  const [delayHours, setDelayHours] = useState(sweepDelayHours);

  useEffect(() => {
    if (sweepRuleEditor) {
      const initialValue = sweepRuleEditor.senderEmail || sweepRuleEditor.sender;
      setCriteria([{ field: 'from', op: 'contains', value: initialValue }]);
      setCriteriaLogic('and');
      setSelectedAction('archive');
      setDelayHours(sweepDelayHours);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sweepRuleEditor]);

  if (!sweepRuleEditor) return null;

  const isDanger = selectedAction === 'delete';

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

    const ruleName = buildRuleName();
    const detail = selectedAction === 'delete'
      ? `Auto-delete after ${delayHours}h`
      : `Auto-archive after ${delayHours}h`;

    if (useMockData || !user?.id) {
      // Mock mode: update in-memory store only
      applySweepAction(validCriteria, criteriaLogic, selectedAction, delayHours);
      addSweepRule({ name: ruleName, detail, criteria: validCriteria, criteriaLogic, action: selectedAction, delayHours });
    } else {
      // Real mode: persist rule to DB, then queue matching emails
      const userId = user.id;

      // 1. Create sweep rule in DB
      const createdRule = await createSweepRuleMutation.mutateAsync({
        user_id: userId,
        name: ruleName,
        detail,
        is_enabled: true,
        sender_pattern: null,
        criteria: validCriteria,
        criteria_logic: criteriaLogic,
        action: selectedAction,
        delay_hours: delayHours,
      });

      // 2. Find all matching emails and add them to the sweep queue
      const currentEmails = useStore.getState().emails;
      const sweepEmailIds = new Set(useStore.getState().sweepEmails.map(e => e.id));
      const matching = currentEmails.filter(e =>
        emailMatchesCriteria(e, validCriteria, criteriaLogic) && !sweepEmailIds.has(e.id)
      );

      for (const email of matching) {
        try {
          await addToSweepQueueMutation.mutateAsync({
            userId,
            emailId: email.id,
            sweepRuleId: createdRule.id,
            action: selectedAction,
            delayHours,
          });
        } catch (err) {
          console.error(`[Sweep] Failed to queue email ${email.id}:`, err);
        }
      }

      // Also update in-memory store immediately for instant UI feedback
      applySweepAction(validCriteria, criteriaLogic, selectedAction, delayHours);
      addSweepRule({ name: ruleName, detail, criteria: validCriteria, criteriaLogic, action: selectedAction, delayHours });
    }

    closeSweepRuleEditor();
  };

  const hasValidCriteria = criteria.some(c => c.value.trim());
  const isApplying = createSweepRuleMutation.isPending || addToSweepQueueMutation.isPending;

  const options = [
    { key: 'archive', title: 'Archive', desc: 'Automatically archive matching messages after the delay', danger: false },
    { key: 'delete', title: 'Delete', desc: 'Permanently delete matching messages after the delay', danger: true },
  ];

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) closeSweepRuleEditor(); }}
    >
      <div className="criteria-editor">
        {/* Header */}
        <div className="criteria-header">
          <span className="criteria-title">Create Sweep Rule</span>
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
            {options.map(opt => (
              <div
                key={opt.key}
                className={`sweep-rule-option${selectedAction === opt.key ? ' selected' : ''}${opt.danger ? ' danger' : ''}`}
                onClick={() => setSelectedAction(opt.key)}
              >
                <div className="sweep-rule-option-radio" />
                <div className="sweep-rule-option-content">
                  <div className="sweep-rule-option-title">{opt.title}</div>
                  <div className="sweep-rule-option-desc">{opt.desc}</div>
                </div>
              </div>
            ))}
          </div>
          {/* Delay dropdown */}
          <div className="sweep-rule-delay">
            <label>Delay before {isDanger ? 'deleting' : 'archiving'}</label>
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
          </div>
        </div>
        {/* Footer */}
        <div className="criteria-footer">
          <button className="btn-secondary" onClick={closeSweepRuleEditor}>Cancel</button>
          <button
            className={isDanger ? 'btn-danger' : 'btn-primary'}
            onClick={handleApply}
            disabled={!hasValidCriteria || isApplying}
            style={(!hasValidCriteria || isApplying) ? { opacity: 0.5, cursor: 'default' } : undefined}
          >
            {isApplying ? 'Applying...' : isDanger ? 'Delete All' : 'Apply'}
          </button>
        </div>
      </div>
    </div>
  );
}
