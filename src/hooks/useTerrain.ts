import { useEffect, useRef, useState } from 'react';
import type { PeakView } from '../geo';
import type { HorizonProfile, TerrainRequest, TerrainResult } from '../worker/terrain.worker';

export type TerrainStatus = 'off' | 'working' | 'ready' | 'error' | 'unsupported';

export interface TerrainState {
  status: TerrainStatus;
  horizon: HorizonProfile | null;
  hidden: Set<number>;
  groundElevation: number | null;
  /** Altitude the raymarch used, for keeping peak angles consistent. */
  eyeAltitude: number | null;
  progress: { done: number; total: number } | null;
  tilesFailed: number;
  ms: number | null;
}

const EMPTY: TerrainState = {
  status: 'off',
  horizon: null,
  hidden: new Set(),
  groundElevation: null,
  eyeAltitude: null,
  progress: null,
  tilesFailed: 0,
  ms: null
};

interface Options {
  enabled: boolean;
  eye: { lat: number; lon: number } | null;
  altitude: number | null;
  radiusKm: number;
  peaks: PeakView[];
  /** Degrees between horizon samples. 0.5° is smooth enough for a 90° view. */
  azimuthStep?: number;
}

/**
 * Runs the DEM raymarch in a worker. Requests are keyed on a coarse position
 * so walking a hundred metres does not throw away a five megabyte download.
 */
export function useTerrain({ enabled, eye, altitude, radiusKm, peaks, azimuthStep = 0.5 }: Options): TerrainState {
  const [state, setState] = useState<TerrainState>(EMPTY);
  const workerRef = useRef<Worker | null>(null);
  const requestId = useRef(0);
  const lastKey = useRef('');
  const peaksRef = useRef(peaks);
  peaksRef.current = peaks;

  useEffect(() => {
    if (!enabled) {
      setState(EMPTY);
      return;
    }
    if (typeof Worker === 'undefined') {
      setState({ ...EMPTY, status: 'unsupported' });
      return;
    }

    let worker: Worker;
    try {
      worker = new Worker(new URL('../worker/terrain.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      setState({ ...EMPTY, status: 'unsupported' });
      return;
    }
    workerRef.current = worker;

    worker.onmessage = (
      event: MessageEvent<{
        type: string;
        requestId: number;
        result?: TerrainResult;
        horizon?: HorizonProfile;
        done?: number;
        total?: number;
        tiles?: number;
        failed?: number;
      }>
    ) => {
      const message = event.data;
      if (message.requestId !== requestId.current) return;
      if (message.type === 'progress') {
        setState((current) => ({
          ...current,
          progress: { done: message.done ?? 0, total: message.total ?? 0 },
          tilesFailed: message.failed ?? current.tilesFailed
        }));
      } else if (message.type === 'partial' && message.horizon) {
        setState((current) => ({ ...current, horizon: message.horizon ?? current.horizon }));
      } else if (message.type === 'done' && message.result) {
        const result = message.result;
        setState({
          status: 'ready',
          horizon: result.horizon,
          hidden: new Set(result.hidden),
          groundElevation: result.groundElevation,
          eyeAltitude: result.eyeAltitude,
          progress: null,
          tilesFailed: result.tilesFailed,
          ms: result.ms
        });
      }
    };

    worker.onerror = () => {
      setState({ ...EMPTY, status: 'error' });
    };

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !eye) return;
    const worker = workerRef.current;
    if (!worker) return;

    // ~1.1 km of latitude, 25 m of height, and the peak set: a change in any
    // of them is worth a new skyline.
    const key = [eye.lat.toFixed(2), eye.lon.toFixed(2), Math.round((altitude ?? 0) / 25), radiusKm, peaks.length, azimuthStep].join('|');
    if (key === lastKey.current) return;
    lastKey.current = key;

    requestId.current += 1;
    setState((current) => ({ ...current, status: 'working', progress: { done: 0, total: 0 } }));

    const payload: TerrainRequest = {
      type: 'terrain',
      requestId: requestId.current,
      eye: { lat: eye.lat, lon: eye.lon, alt: altitude },
      radiusKm,
      azimuthStep,
      peaks: peaks.map((peak) => ({
        id: peak.id,
        lat: peak.lat,
        lon: peak.lon,
        ele: peak.ele,
        bearing: peak.bearing,
        distance: peak.distance
      }))
    };
    worker.postMessage(payload);
  }, [enabled, eye?.lat, eye?.lon, altitude, radiusKm, peaks, azimuthStep]);

  return state;
}
