import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store/index.ts';

export function UndoToast() {
  const { undoAction, undoLastAction, clearUndo } = useStore();
  const [toastVisible, setToastVisible] = useState(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (undoAction) {
      setToastVisible(true);
      // Hide toast after 5s
      toastTimerRef.current = setTimeout(() => setToastVisible(false), 5000);
      // Clear undo action after 60s (Cmd+Z window)
      clearTimerRef.current = setTimeout(() => clearUndo(), 60000);
      return () => {
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
      };
    } else {
      setToastVisible(false);
    }
  }, [undoAction, clearUndo]);

  if (!undoAction || !toastVisible) return null;

  const handleUndo = () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    undoLastAction();
  };

  const undoMessages: Record<string, string> = {
    exempt: 'exempted from sweep',
    archive: 'archived',
    delete: 'deleted',
    moveToSweep: 'moved to sweep',
  };
  const msg = undoMessages[undoAction.type] || 'removed';
  const label = Array.isArray(undoAction.email)
    ? `${undoAction.email.length} emails`
    : `"${(undoAction.email as { subject: string }).subject}"`;

  return (
    <div className="undo-toast" key={undoAction.timestamp}>
      <span className="undo-toast-text">
        {label} {msg}
      </span>
      <button className="undo-btn" onClick={handleUndo}>Undo</button>
      <div className="undo-progress" key={undoAction.timestamp} />
    </div>
  );
}
