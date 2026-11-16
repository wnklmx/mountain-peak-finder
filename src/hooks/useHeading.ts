import { useCallback, useEffect, useRef, useState } from 'react';

export type SensorStatus = 'idle' | 'waiting' | 'active' | 'denied' | 'unsupported';

type OrientationEvent = DeviceOrientationEvent & { webkitCompassHeading?: number };

/**
 * Compass heading in degrees, clockwise from north.
 *
 * Android Chrome exposes `deviceorientationabsolute` with a reliable absolute
 * alpha. iOS needs an explicit permission request from a user gesture and
 * provides `webkitCompassHeading`. Values are smoothed on the unit circle so
 * the 359° -> 1° wrap does not produce a spin.
 */
export function useHeading(enabled: boolean) {
  const [heading, setHeading] = useState<number | null>(null);
  const [status, setStatus] = useState<SensorStatus>('idle');
  const smooth = useRef<{ s: number; c: number } | null>(null);
  const lastAt = useRef(0);

  const handle = useCallback((event: Event) => {
    const now = performance.now();
    if (now - lastAt.current < 60) return;
    lastAt.current = now;

    const e = event as OrientationEvent;
    let raw: number | null = null;
    if (typeof e.webkitCompassHeading === 'number' && Number.isFinite(e.webkitCompassHeading)) {
      raw = e.webkitCompassHeading;
    } else if (e.absolute && e.alpha != null && Number.isFinite(e.alpha)) {
      raw = 360 - e.alpha;
    }
    if (raw == null) return;

    const rad = (raw * Math.PI) / 180;
    const s = Math.sin(rad);
    const c = Math.cos(rad);
    const prev = smooth.current;
    const a = prev ? 0.2 : 1;
    const ns = prev ? prev.s * (1 - a) + s * a : s;
    const nc = prev ? prev.c * (1 - a) + c * a : c;
    smooth.current = { s: ns, c: nc };

    const deg = (Math.atan2(ns, nc) * 180) / Math.PI;
    setHeading((deg + 360) % 360);
    setStatus('active');
  }, []);

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) {
      setStatus('unsupported');
      return;
    }
    setStatus((s) => (s === 'active' ? s : 'waiting'));
    window.addEventListener('deviceorientationabsolute', handle, true);
    window.addEventListener('deviceorientation', handle, true);
    return () => {
      window.removeEventListener('deviceorientationabsolute', handle, true);
      window.removeEventListener('deviceorientation', handle, true);
    };
  }, [enabled, handle]);

  const requestPermission = useCallback(async (): Promise<boolean> => {
    const D = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
    if (typeof D?.requestPermission === 'function') {
      try {
        const result = await D.requestPermission();
        setStatus(result === 'granted' ? 'waiting' : 'denied');
        return result === 'granted';
      } catch {
        setStatus('denied');
        return false;
      }
    }
    return true;
  }, []);

  return { heading, status, requestPermission };
}
