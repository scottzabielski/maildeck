import { useState, useEffect } from 'react';
import { Icons } from './ui/Icons.tsx';
import { useStore } from '../store/index.ts';

export function SweepRuleEditor() {
  const { sweepRuleEditor, closeSweepRuleEditor, addSweepRule, applySweepAction, sweepDelayHours } = useStore();
  const [selectedAction, setSelectedAction] = useState('alwaysSweep');
  const [delayHours, setDelayHours] = useState(sweepDelayHours);

  useEffect(() => {
    if (sweepRuleEditor) {
      setSelectedAction('alwaysSweep');
      setDelayHours(sweepDelayHours);
    }
  }, [sweepRuleEditor, sweepDelayHours]);

  if (!sweepRuleEditor) return null;

  const { sender } = sweepRuleEditor;
  const isDanger = selectedAction === 'alwaysDelete';

  const handleApply = () => {
    applySweepAction(sender, selectedAction, delayHours);
    if (selectedAction !== 'moveAllToSweep') {
      const actionLabels: Record<string, string> = {
        alwaysSweep: 'Always move to Sweep',
        keepLatest: 'Keep only the latest',
        alwaysDelete: 'Always delete',
      };
      addSweepRule({
        name: sender,
        detail: actionLabels[selectedAction],
        sender: sender,
        action: selectedAction,
        delayHours: isDanger ? 0 : delayHours,
      });
    }
    closeSweepRuleEditor();
  };

  const options = [
    { key: 'moveAllToSweep', title: 'Move all to Sweep', desc: 'One-time bulk move of all messages from this sender', badge: 'One-time' },
    { key: 'alwaysSweep', title: 'Always move to Sweep', desc: 'Automatically sweep future messages from this sender', badge: 'Persistent' },
    { key: 'keepLatest', title: 'Keep only the latest', desc: 'Always keep the newest message, sweep the rest', badge: 'Persistent' },
    { key: 'alwaysDelete', title: 'Always delete', desc: 'Permanently delete all messages from this sender', badge: 'Persistent', danger: true },
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
                  <div className="sweep-rule-option-title">
                    {opt.title}
                    <span className="sweep-rule-option-badge">{opt.badge}</span>
                  </div>
                  <div className="sweep-rule-option-desc">{opt.desc}</div>
                </div>
              </div>
            ))}
          </div>
          {/* Delay dropdown (hidden for delete) */}
          {!isDanger && (
            <div className="sweep-rule-delay">
              <label>Sweep delay</label>
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
          )}
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
