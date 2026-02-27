import { useEffect } from 'react';
import { useStore } from '../store/index.ts';

export function useAutoRotateView() {
  const autoRotateView = useStore(s => s.autoRotateView);
  const setActiveView = useStore(s => s.setActiveView);
  const setAutoRotateProgress = useStore(s => s.setAutoRotateProgress);

  useEffect(() => {
    if (!autoRotateView) return;

    let timer: ReturnType<typeof setTimeout>;
    let progressInterval: ReturnType<typeof setInterval>;
    let disposed = false;

    const startCountdown = () => {
      if (disposed) return;
      clearTimeout(timer);
      clearInterval(progressInterval);

      let ticks = 0;
      setAutoRotateProgress(0);
      progressInterval = setInterval(() => {
        if (disposed) return;
        ticks = Math.min(ticks + 1, 60);
        setAutoRotateProgress(ticks);
      }, 1000);

      timer = setTimeout(() => {
        if (disposed) return;
        const state = useStore.getState();
        if (state.selectedEmail || state.highlightedEmail) {
          startCountdown();
          return;
        }
        const current = state.activeViewId;
        setActiveView(current === 'streams' ? 'inboxes' : 'streams');
      }, 60_000);
    };

    // Debounce user activity resets to avoid rapid-fire restarts
    let debounceTimer: ReturnType<typeof setTimeout>;
    const resetOnActivity = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(startCountdown, 100);
    };

    startCountdown();

    // Reset timer when the view changes (manual switch via UI or keyboard)
    let prevViewId = useStore.getState().activeViewId;
    const unsubscribe = useStore.subscribe(() => {
      const viewId = useStore.getState().activeViewId;
      if (viewId !== prevViewId) {
        prevViewId = viewId;
        startCountdown();
      }
    });

    window.addEventListener('pointerdown', resetOnActivity);
    window.addEventListener('keydown', resetOnActivity);

    return () => {
      disposed = true;
      clearTimeout(timer);
      clearTimeout(debounceTimer);
      clearInterval(progressInterval);
      setAutoRotateProgress(0);
      unsubscribe();
      window.removeEventListener('pointerdown', resetOnActivity);
      window.removeEventListener('keydown', resetOnActivity);
    };
  }, [autoRotateView, setActiveView, setAutoRotateProgress]);
}
