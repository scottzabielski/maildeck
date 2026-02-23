import { useEffect, useRef } from 'react';
import { useStore } from '../store/index.ts';

export function UndoToast() {
  const { undoAction, undoLastAction, clearUndo } = useStore();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (undoAction) {
      timerRef.current = setTimeout(() => clearUndo(), 5000);
      return () => { if (timerRef.current) clearTimeout(timerRef.current); };
    }
  }, [undoAction, clearUndo]);

  if (!undoAction) return null;

  const handleUndo = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    undoLastAction();
  };

  const undoMessages: Record<string, string> = {
    exempt: 'exempted from sweep',
    archive: 'archived',
    delete: 'deleted',
    moveToSweep: 'moved to sweep',
  };
  const msg = undoMessages[undoAction.type] || 'removed';

  return (
    <div className="undo-toast" key={undoAction.timestamp}>
      <span className="undo-toast-text">
        "{undoAction.email.subject}" {msg}
      </span>
      <button className="undo-btn" onClick={handleUndo}>Undo</button>
      <div className="undo-progress" key={undoAction.timestamp} />
    </div>
  );
}
