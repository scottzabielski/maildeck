import { useSyncExternalStore } from 'react';

// One shared clock for every countdown on screen. Only the components that read it
// re-render each second; the cards and columns around them don't.
let now = Date.now();
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      for (const l of listeners) l();
    }, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

function getSnapshot() {
  // Nothing keeps `now` current while no countdown is mounted. Refresh it here, at
  // most once a second, so React sees the same value between its consistency checks.
  if (!timer && Date.now() - now >= 1000) now = Date.now();
  return now;
}

/** The current time (epoch ms), updated once a second. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot);
}
