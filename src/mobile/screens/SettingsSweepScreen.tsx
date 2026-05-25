import { Icons } from '../../components/ui/Icons.tsx';
import { useStore } from '../../store/index.ts';
import { useAuth } from '../../hooks/useAuth.ts';
import { useDeleteSweepRule } from '../../hooks/useSweepRules.ts';
import type { SweepRule } from '../../types/index.ts';

function formatRuleSummary(rule: SweepRule): string {
  if (!rule.criteria || rule.criteria.length === 0) return rule.name;
  const joiner = rule.criteriaLogic === 'and' ? ' AND ' : ' OR ';
  const columns = useStore.getState().columns;
  return rule.criteria.map(c => {
    if (c.field === 'stream') {
      const col = columns.find(col => col.id === c.value);
      return `Stream: "${col?.name || c.value}"`;
    }
    const fieldLabel = { from: 'From', to: 'To', subject: 'Subject', body: 'Body', label: 'Label' }[c.field] || c.field;
    return `${fieldLabel} ${c.op.replace('_', ' ')} "${c.value}"`;
  }).join(joiner);
}

export function SettingsSweepScreen() {
  const sweepRules = useStore(s => s.sweepRules);
  const sweepDelayHours = useStore(s => s.sweepDelayHours);
  const setSweepDelayHours = useStore(s => s.setSweepDelayHours);
  const toggleSweepRule = useStore(s => s.toggleSweepRule);
  const openSweepRuleEditorForRule = useStore(s => s.openSweepRuleEditorForRule);
  const openNewSweepRuleEditor = useStore(s => s.openNewSweepRuleEditor);
  const { user } = useAuth();
  const deleteMutation = useDeleteSweepRule();

  const handleDelete = (rule: SweepRule) => {
    if (!confirm(`Delete rule "${rule.name}"?`)) return;
    if (user?.id) deleteMutation.mutate({ id: rule.id, userId: user.id });
    useStore.setState(s => ({
      sweepRules: s.sweepRules.filter(r => r.id !== rule.id),
    }));
  };

  return (
    <div className="mobile-settings-section">
      <div className="mobile-settings-header">
        <div className="mobile-settings-header-text">
          Default delay before sweep actions fire.
        </div>
      </div>
      <div className="mobile-settings-card">
        <div className="mobile-settings-row">
          <div className="mobile-settings-row-main">
            <div className="mobile-settings-row-primary">Default sweep delay</div>
            <div className="mobile-settings-row-secondary">How long emails stay in Sweep before being archived</div>
          </div>
          <select
            className="mobile-settings-select"
            value={String(sweepDelayHours)}
            onChange={(e) => setSweepDelayHours(Number(e.target.value))}
          >
            <option value="1">1 hour</option>
            <option value="6">6 hours</option>
            <option value="12">12 hours</option>
            <option value="24">24 hours</option>
            <option value="48">2 days</option>
            <option value="168">7 days</option>
          </select>
        </div>
      </div>

      <div className="mobile-settings-header" style={{ marginTop: 16 }}>
        <div className="mobile-settings-header-text">Rules</div>
      </div>
      <div className="mobile-settings-card">
        {sweepRules.map(rule => (
          <div key={rule.id} className="mobile-settings-row mobile-settings-rule-row">
            <button
              type="button"
              className="mobile-settings-row-main"
              onClick={() => openSweepRuleEditorForRule(rule.id)}
            >
              <div className="mobile-settings-row-primary">{rule.name}</div>
              <div className="mobile-settings-row-secondary">{formatRuleSummary(rule)}</div>
              <div className="mobile-settings-row-meta">
                <span className="mobile-settings-tag">{rule.enabled ? 'active' : 'paused'}</span>
                <span className="mobile-settings-tag">
                  {rule.action === 'keep_newest_archive' ? 'keep newest (archive)'
                    : rule.action === 'keep_newest_delete' ? 'keep newest (delete)'
                    : rule.action}
                </span>
                {rule.delayHours > 0 && <span className="mobile-settings-tag">{rule.delayHours}h delay</span>}
              </div>
            </button>
            <div className="mobile-settings-row-actions">
              <span
                className={`mobile-toggle${rule.enabled ? ' on' : ''}`}
                onClick={() => toggleSweepRule(rule.id)}
                role="switch"
                aria-checked={rule.enabled}
              >
                <span className="mobile-toggle-knob" />
              </span>
              <button
                type="button"
                className="mobile-settings-row-btn danger"
                onClick={() => handleDelete(rule)}
                aria-label="Delete rule"
              >
                <Icons.Trash />
              </button>
            </div>
          </div>
        ))}
        <button
          type="button"
          className="mobile-settings-add-btn"
          onClick={openNewSweepRuleEditor}
        >
          <Icons.Plus /> Add rule
        </button>
      </div>
    </div>
  );
}
