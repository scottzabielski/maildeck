import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Lightweight in-shell navigation stack for the mobile UI.
 *
 * Frames are user-defined `{ type, ... }` shapes. `push` adds a screen on
 * top; `pop` removes the top frame; `replace` swaps the top frame; `reset`
 * resets to a single root frame.
 *
 * Hardware/browser back button: each `push` adds a synthetic history entry,
 * so a `popstate` event from the back button maps to a `pop` here.
 */
export type ScreenFrame = { type: string } & Record<string, unknown>;

export interface MobileNavApi<F extends ScreenFrame = ScreenFrame> {
  stack: F[];
  top: F;
  depth: number;
  push: (frame: F) => void;
  pop: () => void;
  replace: (frame: F) => void;
  reset: (frame: F) => void;
}

const HISTORY_MARKER = 'maildeck-mobile-nav';

export function useMobileNavStack<F extends ScreenFrame>(initial: F): MobileNavApi<F> {
  const [stack, setStack] = useState<F[]>([initial]);
  const stackRef = useRef(stack);
  stackRef.current = stack;

  const ownedEntriesRef = useRef(0);
  // When `pop()` itself fires history.back(), the browser will emit a
  // popstate event we shouldn't react to (we already popped the stack).
  // This counter lets the popstate handler swallow the events we caused.
  const suppressNextPopstateRef = useRef(0);

  const push = useCallback((frame: F) => {
    setStack(prev => [...prev, frame]);
    try {
      window.history.pushState({ [HISTORY_MARKER]: true }, '');
      ownedEntriesRef.current += 1;
    } catch { /* noop */ }
  }, []);

  const pop = useCallback(() => {
    setStack(prev => (prev.length > 1 ? prev.slice(0, -1) : prev));
    if (ownedEntriesRef.current > 0) {
      ownedEntriesRef.current -= 1;
      suppressNextPopstateRef.current += 1;
      try { window.history.back(); } catch { /* noop */ }
    }
  }, []);

  const replace = useCallback((frame: F) => {
    setStack(prev => (prev.length === 0 ? [frame] : [...prev.slice(0, -1), frame]));
  }, []);

  const reset = useCallback((frame: F) => {
    setStack([frame]);
    ownedEntriesRef.current = 0;
  }, []);

  useEffect(() => {
    const handler = () => {
      // If this popstate was triggered by our own pop()→history.back(), the
      // stack and ref counters are already updated — swallow it.
      if (suppressNextPopstateRef.current > 0) {
        suppressNextPopstateRef.current -= 1;
        return;
      }
      if (stackRef.current.length > 1) {
        setStack(prev => prev.slice(0, -1));
        if (ownedEntriesRef.current > 0) ownedEntriesRef.current -= 1;
      }
    };
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, []);

  return useMemo(() => ({
    stack,
    top: stack[stack.length - 1],
    depth: stack.length,
    push,
    pop,
    replace,
    reset,
  }), [stack, push, pop, replace, reset]);
}
