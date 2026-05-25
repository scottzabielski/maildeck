import { useEffect, useState, useCallback } from 'react';

export type DeviceLayout = 'mobile' | 'desktop';
export type DeviceLayoutOverride = 'auto' | DeviceLayout;

const OVERRIDE_KEY = 'maildeck-device-override';

function readOverride(): DeviceLayoutOverride {
  try {
    const raw = localStorage.getItem(OVERRIDE_KEY);
    if (raw === 'mobile' || raw === 'desktop' || raw === 'auto') return raw;
  } catch { /* noop */ }
  return 'auto';
}

export function setDeviceLayoutOverride(value: DeviceLayoutOverride) {
  try { localStorage.setItem(OVERRIDE_KEY, value); } catch { /* noop */ }
  window.dispatchEvent(new Event('maildeck:device-override-changed'));
}

export function getDeviceLayoutOverride(): DeviceLayoutOverride {
  return readOverride();
}

function detectFromEnvironment(): DeviceLayout {
  if (typeof window === 'undefined') return 'desktop';
  const w = window.innerWidth;
  const coarse = typeof window.matchMedia === 'function'
    && window.matchMedia('(pointer: coarse)').matches;
  if ((coarse && w < 900) || w < 640) return 'mobile';
  return 'desktop';
}

function resolveLayout(): DeviceLayout {
  const override = readOverride();
  if (override === 'mobile' || override === 'desktop') return override;
  return detectFromEnvironment();
}

export function useDeviceLayout(): DeviceLayout {
  const [layout, setLayout] = useState<DeviceLayout>(resolveLayout);

  const recompute = useCallback(() => {
    setLayout(prev => {
      const next = resolveLayout();
      return next === prev ? prev : next;
    });
  }, []);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(recompute, 200);
    };

    window.addEventListener('resize', schedule);
    window.addEventListener('orientationchange', schedule);
    window.addEventListener('maildeck:device-override-changed', recompute);

    const mq = window.matchMedia('(pointer: coarse)');
    const mqHandler = () => recompute();
    if (mq.addEventListener) mq.addEventListener('change', mqHandler);
    else mq.addListener(mqHandler);

    return () => {
      if (timeout) clearTimeout(timeout);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('orientationchange', schedule);
      window.removeEventListener('maildeck:device-override-changed', recompute);
      if (mq.removeEventListener) mq.removeEventListener('change', mqHandler);
      else mq.removeListener(mqHandler);
    };
  }, [recompute]);

  return layout;
}
