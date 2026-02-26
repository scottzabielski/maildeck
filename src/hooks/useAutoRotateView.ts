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

    const resetTimer = () => {
      clearTimeout(timer);
      clearInterval(progressInterval);
      setAutoRotateProgress(0);

      let ticks = 0;
      progressInterval = setInterval(() => {
        ticks = Math.min(ticks + 1, 60);
        setAutoRotateProgress(ticks);
      }, 1000);

      timer = setTimeout(() => {
        const state = useStore.getState();
        if (state.selectedEmail || state.highlightedEmail) {
          resetTimer();
          return;
        }
        const current = useStore.getState().activeViewId;
        setActiveView(current === 'streams' ? 'inboxes' : 'streams');
      }, 60_000);
    };

    resetTimer();

    // Reset timer when the view changes (manual switch via UI or keyboard)
    let prevViewId = useStore.getState().activeViewId;
    const unsubscribe = useStore.subscribe(() => {
      const viewId = useStore.getState().activeViewId;
      if (viewId !== prevViewId) {
        prevViewId = viewId;
        resetTimer();
      }
    });

    window.addEventListener('click', resetTimer);
    window.addEventListener('keydown', resetTimer);

    return () => {
      clearTimeout(timer);
      clearInterval(progressInterval);
      setAutoRotateProgress(0);
      unsubscribe();
      window.removeEventListener('click', resetTimer);
      window.removeEventListener('keydown', resetTimer);
    };
  }, [autoRotateView, setActiveView, setAutoRotateProgress]);
}
