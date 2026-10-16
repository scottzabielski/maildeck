import { useCallback, useEffect, useState } from 'react';

const STEP = 30;
// Cards drawn past the keyboard highlight, so arrowing down (even holding the key)
// lands on cards already in place: one drawn a moment ago is still sliding in and
// would be scrolled to the wrong spot.
const LOOKAHEAD = 30;
// Remembered per list, like scroll positions, so a list comes back the same length.
const sizes = new Map<string, number>();

/**
 * How many of a list's emails to draw. Thousands of cards make every update slow,
 * so a list draws the first STEP and grows as you scroll down. `keepIndex` is an
 * email that must be drawn (the keyboard highlight), or -1.
 */
export function useRenderWindow(key: string, total: number, keepIndex: number) {
  const [win, setWin] = useState(() => ({ key, size: sizes.get(key) ?? STEP }));
  // Another list in the same place (a different stream, on the phone) starts where it was left.
  let size = win.key === key ? win.size : sizes.get(key) ?? STEP;
  // Keep the cards the highlight made us draw, so clearing it doesn't shrink the column under you.
  if (keepIndex >= 0) size = Math.max(size, keepIndex + 1 + LOOKAHEAD);
  if (win.key !== key || win.size !== size) setWin({ key, size });
  const shown = Math.min(total, size);
  useEffect(() => { sizes.set(win.key, win.size); }, [win]);
  const grow = useCallback(() => setWin(w => ({ key: w.key, size: Math.max(w.size, shown + STEP) })), [shown]);
  return { shown, hasMore: shown < total, grow };
}
