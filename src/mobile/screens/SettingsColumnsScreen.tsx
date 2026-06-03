import { useState } from 'react';
import { Icons } from '../../components/ui/Icons.tsx';
import { useStore } from '../../store/index.ts';
import { useAuth } from '../../hooks/useAuth.ts';
import { useDeleteColumn } from '../../hooks/useColumns.ts';
import type { Column, Criterion } from '../../types/index.ts';

function formatCriteriaSummary(criteria: Criterion[], logic: 'and' | 'or'): string {
  if (!criteria || criteria.length === 0) return 'No filters';
  const joiner = logic === 'and' ? ' AND ' : ' OR ';
  const columns = useStore.getState().columns;
  return criteria.map(c => {
    if (c.field === 'stream') {
      const col = columns.find(col => col.id === c.value);
      return `Stream: "${col?.name || c.value}"`;
    }
    if (c.field === 'sweep') {
      return `Sweep: ${c.value}`;
    }
    const fieldLabel = { from: 'From', to: 'To', subject: 'Subject', body: 'Body', label: 'Label' }[c.field] || c.field;
    return `${fieldLabel} ${c.op.replace('_', ' ')} "${c.value}"`;
  }).join(joiner);
}

export function SettingsColumnsScreen() {
  const columns = useStore(s => s.columns);
  const reorderColumns = useStore(s => s.reorderColumns);
  const openCriteriaEditor = useStore(s => s.openCriteriaEditor);
  const openNewColumnEditor = useStore(s => s.openNewColumnEditor);
  const toggleColumn = useStore(s => s.toggleColumn);
  const { user } = useAuth();
  const deleteMutation = useDeleteColumn();
  const [reorderMode, setReorderMode] = useState(false);

  const moveUp = (idx: number) => {
    if (idx <= 0) return;
    const next = [...columns];
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    reorderColumns(next);
  };
  const moveDown = (idx: number) => {
    if (idx >= columns.length - 1) return;
    const next = [...columns];
    [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
    reorderColumns(next);
  };

  const handleDelete = (col: Column) => {
    if (!confirm(`Delete stream "${col.name}"?`)) return;
    if (user?.id) deleteMutation.mutate({ id: col.id, userId: user.id });
    useStore.setState(s => ({
      columns: s.columns.filter(c => c.id !== col.id),
    }));
  };

  return (
    <div className="mobile-settings-section">
      <div className="mobile-settings-header">
        <div className="mobile-settings-header-text">
          Filter columns and their order.
        </div>
        <button
          type="button"
          className="mobile-settings-header-action"
          onClick={() => setReorderMode(v => !v)}
        >
          {reorderMode ? 'Done' : 'Reorder'}
        </button>
      </div>
      <div className="mobile-settings-card">
        {columns.map((col, idx) => {
          const enabled = col.enabled !== false;
          return (
            <div key={col.id} className="mobile-settings-row mobile-settings-column-row">
              <span className="mobile-settings-dot" style={{ background: col.accent }} aria-hidden />
              <button
                type="button"
                className="mobile-settings-row-main"
                onClick={() => openCriteriaEditor(col.id)}
              >
                <div className="mobile-settings-row-primary">{col.name}</div>
                <div className="mobile-settings-row-secondary">
                  {formatCriteriaSummary(col.criteria, col.criteriaLogic)}
                </div>
              </button>
              {reorderMode ? (
                <div className="mobile-settings-reorder-controls">
                  <button
                    type="button"
                    className="mobile-settings-reorder-btn"
                    onClick={() => moveUp(idx)}
                    disabled={idx === 0}
                    aria-label="Move up"
                  >↑</button>
                  <button
                    type="button"
                    className="mobile-settings-reorder-btn"
                    onClick={() => moveDown(idx)}
                    disabled={idx === columns.length - 1}
                    aria-label="Move down"
                  >↓</button>
                </div>
              ) : (
                <div className="mobile-settings-row-actions">
                  <span
                    className={`mobile-toggle${enabled ? ' on' : ''}`}
                    onClick={() => toggleColumn(col.id)}
                    role="switch"
                    aria-checked={enabled}
                  >
                    <span className="mobile-toggle-knob" />
                  </span>
                  <button
                    type="button"
                    className="mobile-settings-row-btn danger"
                    onClick={() => handleDelete(col)}
                    aria-label="Delete stream"
                  >
                    <Icons.Trash />
                  </button>
                </div>
              )}
            </div>
          );
        })}
        <button
          type="button"
          className="mobile-settings-add-btn"
          onClick={openNewColumnEditor}
        >
          <Icons.Plus /> Add stream
        </button>
      </div>
    </div>
  );
}
