import { useEffect, useRef, useState, type RefObject } from 'react';

interface UsePullToRefreshOptions {
  /** Container that's scrolled. PTR only activates when scrollTop === 0. */
  containerRef: RefObject<HTMLElement | null>;
  /** Called when the user pulls past the threshold and releases. */
  onRefresh: () => void | Promise<void>;
  /** Pull distance (in px) the user must reach to trigger refresh. Default 60. */
  threshold?: number;
  /** Max pull distance before we stop responding. Default 120. */
  maxPull?: number;
  /** Disable PTR (e.g. when in multi-select mode). */
  disabled?: boolean;
}

interface PullState {
  /** How far the indicator should appear pulled, in CSS pixels. */
  pullDistance: number;
  /** True while the refresh callback is pending. */
  refreshing: boolean;
  /** True when the user has pulled past the threshold (visual cue). */
  armed: boolean;
}

/**
 * Pull-to-refresh: attaches non-passive touch listeners to the container,
 * surfaces a small set of state values so the caller can render an indicator.
 *
 * Uses rubber-band resistance: as the pull grows, each px requires more
 * finger movement.
 */
export function usePullToRefresh({
  containerRef,
  onRefresh,
  threshold = 60,
  maxPull = 120,
  disabled = false,
}: UsePullToRefreshOptions): PullState {
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startYRef = useRef<number | null>(null);
  const activeRef = useRef(false);

  useEffect(() => {
    if (disabled) return;
    const el = containerRef.current;
    if (!el) return;

    const resistance = (delta: number) => {
      // Stretchy curve: distance grows but slows down past the threshold
      if (delta <= threshold) return delta;
      const overshoot = delta - threshold;
      return threshold + overshoot * 0.4;
    };

    const onTouchStart = (e: TouchEvent) => {
      if (refreshing) return;
      if (el.scrollTop > 0) return;
      const t = e.touches[0];
      if (!t) return;
      startYRef.current = t.clientY;
      activeRef.current = true;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!activeRef.current || startYRef.current == null) return;
      if (el.scrollTop > 0) {
        // User scrolled away from the top — cancel PTR
        activeRef.current = false;
        setPullDistance(0);
        return;
      }
      const t = e.touches[0];
      if (!t) return;
      const delta = t.clientY - startYRef.current;
      if (delta <= 0) {
        setPullDistance(0);
        return;
      }
      // Prevent the document from scrolling/refreshing itself while we own it.
      e.preventDefault();
      const next = Math.min(maxPull, resistance(delta));
      setPullDistance(next);
    };

    const onTouchEnd = async () => {
      if (!activeRef.current) return;
      const triggered = pullDistance >= threshold;
      activeRef.current = false;
      startYRef.current = null;
      if (triggered && !refreshing) {
        setRefreshing(true);
        try {
          await onRefresh();
        } finally {
          setRefreshing(false);
          setPullDistance(0);
        }
      } else {
        setPullDistance(0);
      }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    // touchmove must be non-passive to preventDefault during a pull
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('touchcancel', onTouchEnd);

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [containerRef, disabled, onRefresh, threshold, maxPull, pullDistance, refreshing]);

  return {
    pullDistance,
    refreshing,
    armed: pullDistance >= threshold,
  };
}
