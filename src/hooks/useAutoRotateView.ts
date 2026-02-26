import { useEffect } from 'react';
import { useStore } from '../store/index.ts';

export function useAutoRotateView() {
  const autoRotateView = useStore(s => s.autoRotateView);
  const setActiveView = useStore(s => s.setActiveView);

  useEffect(() => {
    if (!autoRotateView) return;

    let timer: ReturnType<typeof setTimeout>;

    const resetTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (useStore.getState().selectedEmail) {
          resetTimer();
          return;
        }
        const current = useStore.getState().activeViewId;
        setActiveView(current === 'streams' ? 'inboxes' : 'streams');
      }, 60_000);
    };

    resetTimer();

    window.addEventListener('click', resetTimer);
    window.addEventListener('keydown', resetTimer);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('click', resetTimer);
      window.removeEventListener('keydown', resetTimer);
    };
  }, [autoRotateView, setActiveView]);
}
