import { useState, useEffect } from 'react';
import { Icons } from './ui/Icons.tsx';
import { useStore } from '../store/index.ts';
import type { Criterion } from '../types/index.ts';

export function ColumnCriteriaEditor() {
  const { editingColumnId, columns, closeCriteriaEditor } = useStore();
  const column = columns.find(c => c.id === editingColumnId);

  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [logic, setLogic] = useState<'and' | 'or'>('and');

  useEffect(() => {
    if (column) {
      setCriteria(column.criteria || []);
      setLogic(column.criteriaLogic || 'and');
    }
  }, [editingColumnId, column]);

  if (!column) return null;

  const addRow = () => setCriteria([...criteria, { field: 'from', op: 'contains', value: '' }]);
  const removeRow = (i: number) => setCriteria(criteria.filter((_, idx) => idx !== i));
  const updateRow = (i: number, key: keyof Criterion, val: string) =>
    setCriteria(criteria.map((r, idx) => idx === i ? { ...r, [key]: val } : r));

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) closeCriteriaEditor(); }}>
      <div className="criteria-editor">
        <div className="criteria-header">
          <span className="criteria-title">{column.icon} {column.name} — Filters</span>
          <button className="criteria-close" onClick={closeCriteriaEditor}>
            <Icons.Close />
          </button>
        </div>
        <div className="criteria-body">
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
                  <option value="label">Label</option>
                  <option value="body">Body</option>
                </select>
                <select
                  className="filter-select"
                  value={row.op}
                  onChange={(e) => updateRow(i, 'op', e.target.value)}
                >
                  <option value="contains">contains</option>
                  <option value="equals">equals</option>
                  <option value="starts_with">starts with</option>
                  <option value="not_contains">not contains</option>
                </select>
                <input
                  className="filter-input"
                  value={row.value}
                  onChange={(e) => updateRow(i, 'value', e.target.value)}
                  placeholder="Value..."
                />
                <button className="filter-remove-btn" onClick={() => removeRow(i)}>
                  <Icons.Minus />
                </button>
              </div>
            ))}
            <button className="add-filter-btn" onClick={addRow}>
              <Icons.Plus /> Add condition
            </button>
          </div>
        </div>
        <div className="criteria-footer">
          <button className="btn-secondary" onClick={closeCriteriaEditor}>Cancel</button>
          <button className="btn-primary" onClick={closeCriteriaEditor}>Apply</button>
        </div>
      </div>
    </div>
  );
}
