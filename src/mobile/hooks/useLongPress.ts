import { useCallback, useRef } from 'react';

interface UseLongPressOptions {
  onLongPress: () => void;
  /** Optional handler for normal tap (only fires when long-press doesn't). */
  onTap?: () => void;
  /** Optional handler for horizontal swipe (delta sign + magnitude). */
  delayMs?: number;
  /** Movement (px) that cancels the long-press timer. */
  moveThreshold?: number;
  /** Whether to fire navigator.vibrate(15) on long-press. */
  haptic?: boolean;
}

interface UseLongPressBindings {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: (e: React.PointerEvent) => void;
  onPointerLeave: (e: React.PointerEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

export function useLongPress({
  onLongPress,
  onTap,
  delayMs = 500,
  moveThreshold = 10,
  haptic = true,
}: UseLongPressOptions): UseLongPressBindings {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const firedLongPressRef = useRef(false);

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    startRef.current = { x: e.clientX, y: e.clientY };
    firedLongPressRef.current = false;
    clearTimer();
    timerRef.current = setTimeout(() => {
      firedLongPressRef.current = true;
      if (haptic && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        try { navigator.vibrate(15); } catch { /* noop */ }
      }
      onLongPress();
    }, delayMs);
  }, [onLongPress, delayMs, haptic]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!startRef.current) return;
    const dx = e.clientX - startRef.current.x;
    const dy = e.clientY - startRef.current.y;
    if (Math.abs(dx) > moveThreshold || Math.abs(dy) > moveThreshold) {
      clearTimer();
    }
  }, [moveThreshold]);

  const onPointerUp = useCallback((_e: React.PointerEvent) => {
    clearTimer();
    if (!firedLongPressRef.current && onTap) onTap();
    startRef.current = null;
    firedLongPressRef.current = false;
  }, [onTap]);

  const onPointerCancel = useCallback((_e: React.PointerEvent) => {
    clearTimer();
    startRef.current = null;
    firedLongPressRef.current = false;
  }, []);

  const onPointerLeave = useCallback((_e: React.PointerEvent) => {
    clearTimer();
  }, []);

  // Suppress the iOS Safari long-press context menu when we own the gesture
  const onContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onPointerLeave,
    onContextMenu,
  };
}
