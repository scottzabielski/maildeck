import { useState, useEffect } from 'react';
import { Icons } from './ui/Icons.tsx';
import { useStore } from '../store/index.ts';

export function SweepRuleEditor() {
  const { sweepRuleEditor, closeSweepRuleEditor, addSweepRule, applySweepAction, sweepDelayHours } = useStore();
  const [selectedAction, setSelectedAction] = useState('archive');
  const [delayHours, setDelayHours] = useState(sweepDelayHours);

  useEffect(() => {
    if (sweepRuleEditor) {
      setSelectedAction('archive');
      setDelayHours(sweepDelayHours);
    }
  }, [sweepRuleEditor, sweepDelayHours]);

  if (!sweepRuleEditor) return null;

  const { sender } = sweepRuleEditor;
  const isDanger = selectedAction === 'delete';

  const handleApply = () => {
    applySweepAction(sender, selectedAction, delayHours);
    addSweepRule({
      name: sender,
      detail: selectedAction === 'delete'
        ? `Auto-delete after ${delayHours}h`
        : `Auto-archive after ${delayHours}h`,
      sender: sender,
      action: selectedAction,
      delayHours,
    });
    closeSweepRuleEditor();
  };

  const options = [
    { key: 'archive', title: 'Archive', desc: 'Automatically archive messages from this sender after the delay', danger: false },
    { key: 'delete', title: 'Delete', desc: 'Permanently delete messages from this sender after the delay', danger: true },
  ];

  return (
    <div
      className="modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) closeSweepRuleEditor(); }}
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
          {/* Sender display */}
          <div className="sweep-rule-sender">
            <Icons.Envelope />
            <span className="sweep-rule-sender-name">{sender}</span>
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
          >
            {isDanger ? 'Delete All' : 'Apply'}
          </button>
        </div>
      </div>
    </div>
  );
}
