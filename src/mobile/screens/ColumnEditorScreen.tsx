import { useState, useEffect } from 'react';
import { Icons } from '../../components/ui/Icons.tsx';
import { useStore } from '../../store/index.ts';
import { MobileTopBar } from '../components/MobileTopBar.tsx';
import type { Criterion } from '../../types/index.ts';

const ACCENT_COLORS = [
  '#7c3aed', '#2563eb', '#16a34a', '#d97706', '#dc2626',
  '#06b6d4', '#ec4899', '#8b5cf6', '#f59e0b', '#10b981',
];

export function ColumnEditorScreen() {
  const editingColumnId = useStore(s => s.editingColumnId);
  const creatingColumn = useStore(s => s.creatingColumn);
  const columns = useStore(s => s.columns);
  const closeCriteriaEditor = useStore(s => s.closeCriteriaEditor);
  const updateColumn = useStore(s => s.updateColumn);
  const addColumn = useStore(s => s.addColumn);
  const streamEditorPrefill = useStore(s => s.streamEditorPrefill);

  const column = editingColumnId ? columns.find(c => c.id === editingColumnId) : null;
  const isCreating = creatingColumn && !editingColumnId;

  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [logic, setLogic] = useState<'and' | 'or'>('and');
  const [name, setName] = useState('');
  const [accent, setAccent] = useState('#7c3aed');

  useEffect(() => {
    if (column) {
      const base = column.criteria || [];
      if (streamEditorPrefill) {
        const v = streamEditorPrefill.senderEmail || streamEditorPrefill.sender;
        setCriteria([...base, { field: 'from', op: 'contains', value: v }]);
      } else {
        setCriteria(base);
      }
      setLogic(column.criteriaLogic || 'and');
      setName(column.name);
      setAccent(column.accent);
    } else if (isCreating) {
      if (streamEditorPrefill) {
        const v = streamEditorPrefill.senderEmail || streamEditorPrefill.sender;
        setCriteria([{ field: 'from', op: 'contains', value: v }]);
      } else {
        setCriteria([{ field: 'from', op: 'contains', value: '' }]);
      }
      setLogic('or');
      setName('');
      setAccent(ACCENT_COLORS[Math.floor(Math.random() * ACCENT_COLORS.length)]);
    }
  }, [editingColumnId, column, isCreating, streamEditorPrefill]);

  if (!column && !isCreating) return null;

  const addRow = () => setCriteria(prev => [...prev, { field: 'from', op: 'contains', value: '' }]);
  const removeRow = (i: number) => setCriteria(prev => prev.filter((_, idx) => idx !== i));
  const updateRow = (i: number, key: keyof Criterion, val: string) => {
    setCriteria(prev => prev.map((r, idx) => {
      if (idx !== i) return r;
      if (key === 'field' && val === 'stream') return { ...r, field: val, op: 'equals', value: '' };
      if (key === 'field' && val === 'sweep') return { ...r, field: val, op: 'equals', value: 'no rule' };
      return { ...r, [key]: val };
    }));
  };

  const handleApply = () => {
    const valid = criteria.filter(c => c.value.trim());
    if (isCreating) {
      if (!name.trim()) return;
      addColumn({ name: name.trim(), icon: '', accent, criteria: valid, criteriaLogic: logic, enabled: true });
    } else if (column) {
      updateColumn(column.id, {
        name: name.trim() || column.name,
        icon: column.icon,
        accent,
        criteria: valid,
        criteriaLogic: logic,
      });
    }
    closeCriteriaEditor();
  };

  const canApply = isCreating ? name.trim().length > 0 : true;

  return (
    <div className="mobile-editor-overlay">
      <div className="mobile-screen">
        <MobileTopBar
          onBack={closeCriteriaEditor}
          title={isCreating ? 'New stream' : column!.name}
          rightSlot={
            <button
              type="button"
              className="mobile-editor-save"
              onClick={handleApply}
              disabled={!canApply}
            >
              {isCreating ? 'Create' : 'Save'}
            </button>
          }
        />
        <div className="mobile-editor-body">
          <div className="mobile-editor-field">
            <label className="mobile-editor-label">Name</label>
            <input
              type="text"
              className="mobile-editor-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Stream name…"
            />
          </div>
          <div className="mobile-editor-field">
            <label className="mobile-editor-label">Accent color</label>
            <div className="mobile-editor-accent-row">
              {ACCENT_COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  className={`mobile-editor-accent${accent === c ? ' selected' : ''}`}
                  style={{ background: c }}
                  onClick={() => setAccent(c)}
                  aria-label={`Accent ${c}`}
                />
              ))}
            </div>
          </div>

          <div className="mobile-editor-field">
            <div className="mobile-editor-label-row">
              <label className="mobile-editor-label">Match emails where</label>
              <button
                type="button"
                className={`mobile-editor-logic-badge ${logic}`}
                onClick={() => setLogic(l => l === 'and' ? 'or' : 'and')}
              >
                {logic}
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
                  <option value="label">Label</option>
                  <option value="body">Body</option>
                  <option value="stream">Stream</option>
                  <option value="sweep">Sweep</option>
                </select>
                {row.field === 'stream' ? (
                  <span className="mobile-editor-select" style={{ fontStyle: 'italic', color: 'var(--text-tertiary)' }}>
                    is part of
                  </span>
                ) : row.field === 'sweep' ? (
                  <span className="mobile-editor-select" style={{ fontStyle: 'italic', color: 'var(--text-tertiary)' }}>
                    has
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
                    {columns.filter(c => c.id !== editingColumnId).map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                ) : row.field === 'sweep' ? (
                  <select
                    className="mobile-editor-input"
                    value={row.value}
                    onChange={(e) => updateRow(i, 'value', e.target.value)}
                  >
                    <option value="no rule">no rule</option>
                    <option value="has rule">has rule</option>
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
        </div>
      </div>
    </div>
  );
}
