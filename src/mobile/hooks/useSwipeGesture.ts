import { useState, useRef, useCallback } from 'react';

interface UseSwipeGestureOptions {
  /** Triggered when the user swipes left past the threshold. */
  onSwipeLeft?: () => void;
  /** Triggered when the user swipes right past the threshold. */
  onSwipeRight?: () => void;
  /**
   * Fraction of element width the user must drag past to commit (0..1).
   * Default 0.4.
   */
  commitFraction?: number;
  /** Minimum px movement before we accept it as a swipe (vs a tap). */
  startThreshold?: number;
  /** Disable swipes (e.g. when in multi-select mode). */
  disabled?: boolean;
}

interface SwipeBindings {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: (e: React.PointerEvent) => void;
  /** Current horizontal offset in pixels (positive = right, negative = left). */
  offset: number;
  /** True once we've committed to a swipe gesture (locks vertical scroll). */
  swiping: boolean;
}

export function useSwipeGesture({
  onSwipeLeft,
  onSwipeRight,
  commitFraction = 0.4,
  startThreshold = 6,
  disabled = false,
}: UseSwipeGestureOptions): SwipeBindings {
  const [offset, setOffset] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const startRef = useRef<{ x: number; y: number; w: number } | null>(null);
  const axisLockedRef = useRef<'h' | 'v' | null>(null);

  const reset = useCallback(() => {
    setOffset(0);
    setSwiping(false);
    startRef.current = null;
    axisLockedRef.current = null;
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (disabled) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const target = e.currentTarget as HTMLElement;
    startRef.current = { x: e.clientX, y: e.clientY, w: target.offsetWidth };
    axisLockedRef.current = null;
    setOffset(0);
    setSwiping(false);
  }, [disabled]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!startRef.current || disabled) return;
    const dx = e.clientX - startRef.current.x;
    const dy = e.clientY - startRef.current.y;

    // Axis lock once movement crosses the threshold
    if (axisLockedRef.current == null) {
      if (Math.abs(dx) < startThreshold && Math.abs(dy) < startThreshold) return;
      axisLockedRef.current = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
      if (axisLockedRef.current === 'h') setSwiping(true);
    }

    if (axisLockedRef.current !== 'h') return;
    // Constrain the offset so the row doesn't fly off-screen
    const maxAbs = startRef.current.w * 0.75;
    const clamped = Math.max(-maxAbs, Math.min(maxAbs, dx));
    setOffset(clamped);
  }, [disabled, startThreshold]);

  const onPointerUp = useCallback((_e: React.PointerEvent) => {
    if (!startRef.current) { reset(); return; }
    const width = startRef.current.w;
    const committed = Math.abs(offset) / width >= commitFraction;
    if (committed) {
      if (offset < 0 && onSwipeLeft) onSwipeLeft();
      else if (offset > 0 && onSwipeRight) onSwipeRight();
    }
    reset();
  }, [offset, commitFraction, onSwipeLeft, onSwipeRight, reset]);

  const onPointerCancel = useCallback((_e: React.PointerEvent) => {
    reset();
  }, [reset]);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    offset,
    swiping,
  };
}
