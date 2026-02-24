import { useState, useEffect, useRef } from 'react';
import { Icons } from './ui/Icons.tsx';
import { useStore } from '../store/index.ts';
import type { Criterion } from '../types/index.ts';

const ACCENT_COLORS = [
  '#7c3aed', '#2563eb', '#16a34a', '#d97706', '#dc2626',
  '#06b6d4', '#ec4899', '#8b5cf6', '#f59e0b', '#10b981',
];

export function ColumnCriteriaEditor() {
  const { editingColumnId, creatingColumn, columns, closeCriteriaEditor, updateColumn, addColumn, streamEditorPrefill } = useStore();
  const column = editingColumnId ? columns.find(c => c.id === editingColumnId) : null;
  const isCreating = creatingColumn && !editingColumnId;

  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [logic, setLogic] = useState<'and' | 'or'>('and');
  const [name, setName] = useState('');
  const [accent, setAccent] = useState('#7c3aed');
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (column) {
      const baseCriteria = column.criteria || [];
      if (streamEditorPrefill) {
        const prefillValue = streamEditorPrefill.senderEmail || streamEditorPrefill.sender;
        setCriteria([...baseCriteria, { field: 'from', op: 'contains', value: prefillValue }]);
      } else {
        setCriteria(baseCriteria);
      }
      setLogic(column.criteriaLogic || 'and');
      setName(column.name);
      setAccent(column.accent);
    } else if (isCreating) {
      if (streamEditorPrefill) {
        const prefillValue = streamEditorPrefill.senderEmail || streamEditorPrefill.sender;
        setCriteria([{ field: 'from', op: 'contains', value: prefillValue }]);
      } else {
        setCriteria([{ field: 'from', op: 'contains', value: '' }]);
      }
      setLogic('and');
      setName('');
      setAccent(ACCENT_COLORS[Math.floor(Math.random() * ACCENT_COLORS.length)]);
      setTimeout(() => nameInputRef.current?.focus(), 50);
    }
  }, [editingColumnId, column, isCreating, streamEditorPrefill]);

  if (!column && !isCreating) return null;

  const addRow = () => setCriteria([...criteria, { field: 'from', op: 'contains', value: '' }]);
  const removeRow = (i: number) => setCriteria(criteria.filter((_, idx) => idx !== i));
  const getPrefillValueForField = (field: string): string | null => {
    if (!streamEditorPrefill) return null;
    switch (field) {
      case 'from': return streamEditorPrefill.senderEmail || streamEditorPrefill.sender;
      case 'to': return streamEditorPrefill.toEmail;
      case 'subject': return streamEditorPrefill.subject;
      default: return null;
    }
  };

  const updateRow = (i: number, key: keyof Criterion, val: string) =>
    setCriteria(criteria.map((r, idx) => {
      if (idx !== i) return r;
      if (key === 'field' && val === 'stream') {
        return { ...r, field: val, op: 'equals', value: '' };
      }
      if (key === 'field') {
        const prefillValue = getPrefillValueForField(val);
        if (prefillValue) {
          return { ...r, field: val, value: prefillValue };
        }
      }
      return { ...r, [key]: val };
    }));

  const handleApply = () => {
    const validCriteria = criteria.filter(c => c.value.trim());
    if (isCreating) {
      if (!name.trim()) return;
      addColumn({ name: name.trim(), icon: '', accent, criteria: validCriteria, criteriaLogic: logic, enabled: true });
    } else if (column) {
      updateColumn(column.id, { name: name.trim() || column.name, icon: column.icon, accent, criteria: validCriteria, criteriaLogic: logic });
    }
    closeCriteriaEditor();
  };

  const canApply = isCreating ? name.trim().length > 0 : true;

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) closeCriteriaEditor(); }}>
      <div className="criteria-editor">
        <div className="criteria-header">
          <span className="criteria-title">
            {isCreating ? 'New Stream' : `${column!.name} — Filters`}
          </span>
          <button className="criteria-close" onClick={closeCriteriaEditor}>
            <Icons.Close />
          </button>
        </div>
        <div className="criteria-body">
          {/* Column identity — show for create mode, collapsible for edit */}
          {(isCreating || column) && (
            <div className="column-identity-section">
              <div className="column-identity-row">
                <span className="column-accent-preview" style={{ background: accent }} />
                <input
                  ref={nameInputRef}
                  className="column-name-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Stream name..."
                  onKeyDown={(e) => { if (e.key === 'Enter' && canApply) handleApply(); }}
                />
              </div>
              <div className="column-accent-row">
                {ACCENT_COLORS.map(c => (
                  <button
                    key={c}
                    className={`column-accent-option ${accent === c ? 'selected' : ''}`}
                    style={{ background: c }}
                    onClick={() => setAccent(c)}
                  />
                ))}
                <label className="column-accent-custom" title="Pick any color">
                  <input
                    type="color"
                    value={accent}
                    onChange={(e) => setAccent(e.target.value)}
                  />
                  <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>custom</span>
                </label>
              </div>
            </div>
          )}

          {/* Criteria builder */}
          <div className="filter-group">
            <div className="filter-group-header">
              <button
                className={`filter-logic-badge ${logic}`}
                onClick={() => setLogic(logic === 'and' ? 'or' : 'and')}
              >
                {logic}
              </button>
              <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                Click to toggle logic
              </span>
            </div>
            {criteria.map((row, i) => {
              const otherColumns = columns.filter(c => c.id !== editingColumnId);
              return (
              <div key={i} className="filter-row">
                <select
                  className="filter-select"
                  value={row.field}
                  onChange={(e) => updateRow(i, 'field', e.target.value)}
                >
                  <option value="from">From</option>
                  <option value="to">To</option>
                  <option value="subject">Subject</option>
                  <option value="label">Label</option>
                  <option value="body">Body</option>
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
                    {otherColumns.map(col => (
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
              );
            })}
            <button className="add-filter-btn" onClick={addRow}>
              <Icons.Plus /> Add condition
            </button>
          </div>
        </div>
        <div className="criteria-footer">
          <button className="btn-secondary" onClick={closeCriteriaEditor}>Cancel</button>
          <button
            className="btn-primary"
            onClick={handleApply}
            disabled={!canApply}
            style={!canApply ? { opacity: 0.5, cursor: 'default' } : undefined}
          >
            {isCreating ? 'Create Stream' : 'Apply'}
          </button>
        </div>
      </div>
    </div>
  );
}
