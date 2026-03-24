import { useEffect, useRef } from 'react';
import { useStore } from '../store/index.ts';

export function useAutoRotateView() {
  const autoRotateView = useStore(s => s.autoRotateView);
  const activeViewId = useStore(s => s.activeViewId);
  const tickRef = useRef(0);

  useEffect(() => {
    if (!autoRotateView) {
      useStore.getState().setAutoRotateProgress(0);
      return;
    }

    tickRef.current = 0;
    useStore.getState().setAutoRotateProgress(0);

    // Brief grace period after view switch to ignore framer-motion events
    const mountedAt = Date.now();

    const interval = setInterval(() => {
      const state = useStore.getState();

      // Pause while an email is open
      if (state.selectedEmail) return;

      tickRef.current += 1;
      state.setAutoRotateProgress(tickRef.current);

      if (tickRef.current >= 60) {
        tickRef.current = 0;
        state.setAutoRotateProgress(0);
        const current = state.activeViewId;
        state.setActiveView(current === 'streams' ? 'inboxes' : 'streams');
      }
    }, 1000);

    // User activity resets the countdown (only when this window is focused)
    const resetOnActivity = () => {
      if (!document.hasFocus()) return;
      if (Date.now() - mountedAt < 1000) return;
      tickRef.current = 0;
      useStore.getState().setAutoRotateProgress(0);
    };

    window.addEventListener('pointerdown', resetOnActivity);
    window.addEventListener('keydown', resetOnActivity);

    return () => {
      clearInterval(interval);
      useStore.getState().setAutoRotateProgress(0);
      window.removeEventListener('pointerdown', resetOnActivity);
      window.removeEventListener('keydown', resetOnActivity);
    };
  }, [autoRotateView, activeViewId]);
}
