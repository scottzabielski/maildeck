import { useEffect } from 'react';
import { useStore } from '../store/index.ts';

export function useAutoRotateView() {
  const autoRotateView = useStore(s => s.autoRotateView);

  useEffect(() => {
    if (!autoRotateView) return;

    let timer: ReturnType<typeof setTimeout>;
    let progressInterval: ReturnType<typeof setInterval>;
    let ticks = 0;
    let ignoreActivityUntil = 0;

    const startCountdown = () => {
      clearTimeout(timer);
      clearInterval(progressInterval);

      ticks = 0;
      useStore.getState().setAutoRotateProgress(0);
      progressInterval = setInterval(() => {
        ticks = Math.min(ticks + 1, 60);
        useStore.getState().setAutoRotateProgress(ticks);
      }, 1000);

      timer = setTimeout(() => {
        const state = useStore.getState();
        if (state.selectedEmail) {
          startCountdown();
          return;
        }
        const current = state.activeViewId;
        useStore.getState().setActiveView(current === 'streams' ? 'inboxes' : 'streams');
      }, 60_000);
    };

    startCountdown();

    // Reset timer when the view changes (manual switch or auto-rotate)
    let prevViewId = useStore.getState().activeViewId;
    const unsubscribe = useStore.subscribe(() => {
      const viewId = useStore.getState().activeViewId;
      if (viewId !== prevViewId) {
        prevViewId = viewId;
        // Ignore pointer/key events briefly after view switch to avoid
        // framer-motion animation events from resetting the countdown
        ignoreActivityUntil = Date.now() + 1000;
        startCountdown();
      }
    });

    // User activity resets the countdown
    const resetOnActivity = () => {
      if (Date.now() < ignoreActivityUntil) return;
      startCountdown();
    };

    window.addEventListener('pointerdown', resetOnActivity);
    window.addEventListener('keydown', resetOnActivity);

    return () => {
      clearTimeout(timer);
      clearInterval(progressInterval);
      useStore.getState().setAutoRotateProgress(0);
      unsubscribe();
      window.removeEventListener('pointerdown', resetOnActivity);
      window.removeEventListener('keydown', resetOnActivity);
    };
  }, [autoRotateView]);
}
