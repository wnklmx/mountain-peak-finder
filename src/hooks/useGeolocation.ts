import { useEffect, useState } from 'react';

export interface Fix {
  lat: number;
  lon: number;
  accuracy: number;
  altitude: number | null;
  altitudeAccuracy: number | null;
  at: number;
}

export type GeoStatus = 'idle' | 'locating' | 'ok' | 'error' | 'unsupported';

export function useGeolocation(enabled: boolean) {
  const [fix, setFix] = useState<Fix | null>(null);
  const [status, setStatus] = useState<GeoStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setStatus('idle');
      return;
    }
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setStatus('unsupported');
      setError('This browser does not support geolocation.');
      return;
    }

    let cancelled = false;
    setStatus((s) => (s === 'ok' ? s : 'locating'));

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (cancelled) return;
        setFix({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy ?? 0,
          altitude: Number.isFinite(pos.coords.altitude) ? pos.coords.altitude : null,
          altitudeAccuracy: Number.isFinite(pos.coords.altitudeAccuracy) ? pos.coords.altitudeAccuracy : null,
          at: pos.timestamp
        });
        setStatus('ok');
        setError(null);
      },
      (err) => {
        if (cancelled) return;
        setStatus('error');
        setError(err.message || 'Could not get your position.');
      },
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 25000 }
    );

    return () => {
      cancelled = true;
      navigator.geolocation.clearWatch(watchId);
    };
  }, [enabled]);

  return { fix, status, error };
}
