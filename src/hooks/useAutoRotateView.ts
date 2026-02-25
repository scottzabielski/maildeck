import { useEffect } from 'react';
import { useStore } from '../store/index.ts';

export function useAutoRotateView() {
  const autoRotateView = useStore(s => s.autoRotateView);
  const activeViewId = useStore(s => s.activeViewId);
  const setActiveView = useStore(s => s.setActiveView);

  useEffect(() => {
    if (!autoRotateView) return;

    const interval = setInterval(() => {
      const current = useStore.getState().activeViewId;
      setActiveView(current === 'streams' ? 'inboxes' : 'streams');
    }, 60_000);

    return () => clearInterval(interval);
  }, [autoRotateView, activeViewId, setActiveView]);
}
