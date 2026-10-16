import type { ReactNode } from 'react';
import { useNow } from '../../hooks/useNow.ts';

/**
 * Renders `children` with the whole seconds left until `dueAt` (epoch ms), and
 * re-renders once a second so the countdown ticks without redrawing what's around it.
 */
export function Countdown({ dueAt, children }: { dueAt: number; children: (secondsLeft: number) => ReactNode }) {
  const now = useNow();
  return <>{children(Math.max(0, Math.ceil((dueAt - now) / 1000)))}</>;
}
