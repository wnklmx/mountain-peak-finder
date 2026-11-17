/// <reference lib="webworker" />
/**
 * Terrain worker: downloads Terrarium DEM tiles, decodes them, and answers two
 * questions.
 *
 *  1. What is the apparent horizon in every direction? (drawn as the skyline)
 *  2. Is this peak hidden behind a ridge? (occlusion test)
 *
 * Both use the same raymarch, with earth curvature and standard refraction
 * folded in: the terrain at distance d appears `d² / (2R′)` metres lower than
 * it really is, so a far summit can sit above the geometric horizon.
 */
import { BANDS, TILE_SIZE, decodeTerrarium, tileUrl, EARTH_RADIUS, REFRACTION_K } from '../dem';

const R_EFF = EARTH_RADIUS / (1 - REFRACTION_K);
const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

export interface PeakInput {
  id: number;
  lat: number;
  lon: number;
  ele: number;
  bearing: number;
  distance: number;
}

export interface TerrainRequest {
  type: 'terrain';
  requestId: number;
  eye: { lat: number; lon: number; alt: number | null };
  radiusKm: number;
  azimuthStep: number;
  peaks: PeakInput[];
}

export interface HorizonProfile {
  step: number;
  angles: Float32Array;
  distances: Float32Array;
  /** Max angle limited to each cut in `cuts`, nearest first. */
  bands?: Float32Array[];
  cuts?: number[];
}

export interface TerrainResult {
  horizon: HorizonProfile;
  behind: Array<{ id: number; ridge: number; ridgeDistance: number }>;
  hidden: number[];
  groundElevation: number | null;
  /** The altitude the raymarch used: the higher of GPS and the DEM. */
  eyeAltitude: number;
  tilesLoaded: number;
  tilesFailed: number;
  samples: number;
  ms: number;
}

const ctx = self as unknown as { postMessage: (message: unknown) => void };
const post = (message: unknown) => ctx.postMessage(message);

// ---------------------------------------------------------------- tile cache

const tiles = new Map<string, Int16Array | null>();
const inflight = new Map<string, Promise<Int16Array | null>>();
const queue: Array<() => void> = [];
let active = 0;
let loaded = 0;
let failed = 0;
const MAX_PARALLEL = 6;

function schedule<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      active++;
      task()
        .then(resolve, reject)
        .finally(() => {
          active--;
          const next = queue.shift();
          if (next) next();
        });
    };
    if (active < MAX_PARALLEL) run();
    else queue.push(run);
  });
}

async function loadTile(z: number, x: number, y: number): Promise<Int16Array | null> {
  const key = `${z}/${x}/${y}`;
  const hit = tiles.get(key);
  if (hit !== undefined) return hit;
  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = schedule(async () => {
    const response = await fetch(tileUrl(z, x, y), { mode: 'cors' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bitmap = await createImageBitmap(await response.blob());
    const canvas = new OffscreenCanvas(TILE_SIZE, TILE_SIZE);
    const c2d = canvas.getContext('2d', { willReadFrequently: true });
    if (!c2d) throw new Error('no 2d context');
    c2d.drawImage(bitmap, 0, 0);
    bitmap.close();
    return decodeTerrarium(c2d.getImageData(0, 0, TILE_SIZE, TILE_SIZE).data);
  })
    .then((tile) => {
      tiles.set(key, tile);
      loaded++;
      return tile;
    })
    .catch(() => {
      tiles.set(key, null);
      failed++;
      return null;
    })
    .finally(() => inflight.delete(key));

  inflight.set(key, promise);
  return promise;
}

function samplePixel(z: number, wx: number, wy: number): number | null {
  const tx = Math.floor(wx / TILE_SIZE);
  const ty = Math.floor(wy / TILE_SIZE);
  const tile = tiles.get(`${z}/${tx}/${ty}`);
  if (!tile) return null;
  const px = Math.min(TILE_SIZE - 1, Math.floor(wx - tx * TILE_SIZE));
  const py = Math.min(TILE_SIZE - 1, Math.floor(wy - ty * TILE_SIZE));
  return tile[py * TILE_SIZE + px];
}

// ------------------------------------------------------------ geometry tables

/**
 * Normalised Web Mercator y (0 at the north edge, 1 at the south edge) for a
 * latitude. Pre-tabulated once per request: the raymarch then does one array
 * lookup instead of two trig calls and a logarithm per sample.
 */
function mercatorTable(lat0: number, spanDeg: number) {
  const n = 512;
  const lo = lat0 - spanDeg;
  const hi = lat0 + spanDeg;
  const table = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const lat = lo + ((hi - lo) * i) / (n - 1);
    const rad = Math.max(-1.4844, Math.min(1.4844, lat * DEG));
    table[i] = (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2;
  }
  const scale = (n - 1) / (hi - lo);
  return (lat: number) => {
    const t = Math.max(0, Math.min(n - 1.001, (lat - lo) * scale));
    const i = t | 0;
    return table[i] + (table[i + 1] - table[i]) * (t - i);
  };
}

interface Scan {
  angle: number;
  distance: number;
  samples: number;
  bands: number[];
}

/**
 * Raymarch helper. One instance per request; `scan` walks a great circle from
 * the eye and samples the DEM straight in Mercator pixels.
 */
function makeScanner(eye: { lat: number; lon: number }, radiusM: number) {
  const lat0 = eye.lat;
  const lon0 = eye.lon;
  const sinLat0 = Math.sin(lat0 * DEG);
  const cosLat0 = Math.cos(lat0 * DEG);
  const merc = mercatorTable(lat0, (radiusM / 111000) * 1.2 + 0.01);

  const zooms = BANDS.map((band) => ({
    ...band,
    size: TILE_SIZE * 2 ** band.z,
    kx: (TILE_SIZE * 2 ** band.z) / 360,
    base: ((lon0 + 180) / 360) * TILE_SIZE * 2 ** band.z,
    merc0: merc(lat0) * TILE_SIZE * 2 ** band.z
  }));

  return function scan(
    bearing: number,
    limit: number,
    stride = 1,
    alt = 0,
    minD = 60,
    cuts: number[] = []
  ): Scan {
    const cosB = Math.cos(bearing * DEG);
    const sinB = Math.sin(bearing * DEG);
    let best = -90;
    let bestDistance = 0;
    let samples = 0;
    const bands = cuts.map(() => -90);

    const sampleAt = (d: number, z: number) => {
      const dd = d / EARTH_RADIUS;
      const sinDd = Math.sin(dd);
      const cosDd = Math.cos(dd);
      const lat = Math.asin(sinLat0 * cosDd + cosLat0 * sinDd * cosB) * RAD;
      const lon = lon0 + Math.atan2(sinDd * sinB, cosLat0 * cosDd - sinLat0 * sinDd * cosB) * RAD;
      const zoom = zooms.find((entry) => entry.z === z);
      if (!zoom) return null;
      const wx = zoom.base + (lon - lon0) * zoom.kx;
      const wy = merc(lat) * zoom.size;
      return samplePixel(z, wx, wy);
    };

    for (const band of zooms) {
      if (band.from >= limit) break;
      const end = Math.min(band.to, limit);
      const step = band.step * stride;
      const steps = Math.max(1, Math.ceil((end - band.from) / step));
      for (let i = 0; i <= steps; i++) {
        const d = band.from + ((end - band.from) * i) / steps;
        if (d < minD) continue;
        const h = sampleAt(d, band.z);
        samples++;
        if (h == null) continue;
        const angle = Math.atan2(h - alt - (d * d) / (2 * R_EFF), d) * RAD;
        if (angle > best) {
          best = angle;
          bestDistance = d;
        }
        for (let c = 0; c < cuts.length; c++) {
          if (d <= cuts[c] && angle > bands[c]) bands[c] = angle;
        }
      }
    }

    return { angle: best, distance: bestDistance, samples, bands };
  };
}

// ------------------------------------------------------------------- request

self.onmessage = async (event: MessageEvent<TerrainRequest>) => {
  const request = event.data;
  if (!request || request.type !== 'terrain') return;

  const started = performance.now();
  const radiusM = request.radiusKm * 1000;
  const { lat, lon } = request.eye;

  // Tiles are pulled band by band, nearest zoom first, and a partial skyline
  // is posted after each band so the view fills in instead of staying blank.
  const wanted: Array<{ z: number; x: number; y: number }> = [];
  const seen = new Set<string>();
  const bands: Array<{ z: number; from: number; to: number; tiles: Array<{ z: number; x: number; y: number }> }> = [];

  for (const band of BANDS) {
    if (band.from >= radiusM) break;
    const outer = Math.min(band.to, radiusM);
    const worldTiles = 2 ** band.z;
    const tileMetres = (40075016.686 * Math.cos(lat * DEG)) / worldTiles;
    const span = Math.ceil(outer / tileMetres) + 2;
    const fx = (((lon + 180) / 360) * worldTiles);
    const fy = mercatorTable(lat, 0.01)(lat) * worldTiles;
    const cx = Math.floor(fx);
    const cy = Math.floor(fy);

    const owned: Array<{ z: number; x: number; y: number }> = [];
    for (let dy = -span; dy <= span; dy++) {
      for (let dx = -span; dx <= span; dx++) {
        // Skip whatever this annulus cannot reach: a square bounding box is
        // more than twice the tiles of the ring actually sampled.
        const ox = dx + 0.5 - (fx - cx);
        const oy = dy + 0.5 - (fy - cy);
        const distance = Math.hypot(ox, oy) * tileMetres;
        if (distance - tileMetres * 0.71 > outer) continue;
        if (distance + tileMetres * 0.71 < band.from) continue;
        const key = `${band.z}/${cx + dx}/${cy + dy}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const ref = { z: band.z, x: cx + dx, y: cy + dy };
        wanted.push(ref);
        owned.push(ref);
      }
    }
    bands.push({ z: band.z, from: band.from, to: outer, tiles: owned });
  }

  const total = wanted.length;
  let done = 0;
  const tick = () => {
    done++;
    if (done % 8 === 0 || done === total) {
      post({ type: 'progress', requestId: request.requestId, done, total, tiles: loaded, failed });
    }
  };

  const count = Math.max(72, Math.round(360 / request.azimuthStep));
  const step = 360 / count;

  const cuts = [3000, 12000, 40000, radiusM].filter((cut, index, all) => all.indexOf(cut) === index);

  const profileNow = (altitude: number) => {
    const scanner = makeScanner({ lat, lon }, radiusM);
    const raw = new Float32Array(count);
    const distances = new Float32Array(count);
    const rawBands = cuts.map(() => new Float32Array(count));
    for (let i = 0; i < count; i++) {
      const scan = scanner(i * step, radiusM, 1, altitude, 200, cuts);
      raw[i] = scan.angle;
      distances[i] = scan.distance;
      for (let c = 0; c < cuts.length; c++) rawBands[c][i] = scan.bands[c];
    }
    // One pass of [1 2 1] to drop single-sample DEM spikes; a 30 m cell next to
    // the eye can otherwise put a fake crag on the skyline.
    const smooth = (input: Float32Array) => {
      const out = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        const b = input[i];
        if (b < -89) {
          out[i] = -90;
          continue;
        }
        const a = input[(i - 1 + count) % count];
        const c = input[(i + 1) % count];
        let sum = 2 * b;
        let weight = 2;
        if (a > -89) {
          sum += a;
          weight += 1;
        }
        if (c > -89) {
          sum += c;
          weight += 1;
        }
        out[i] = sum / weight;
      }
      return out;
    };
    return { step, angles: smooth(raw), distances, bands: rawBands.map(smooth), cuts };
  };

  const groundElevation = (() => {
    const size = TILE_SIZE * 2 ** 13;
    const wx = ((lon + 180) / 360) * size;
    const wy = mercatorTable(lat, 0.01)(lat) * size;
    return samplePixel(13, wx, wy);
  })();

  // Never below the DEM surface: a GPS altitude a few metres low would
  // otherwise let the ground you are standing on hide everything.
  const candidate = Math.max(request.eye.alt ?? -1e9, (groundElevation ?? -1e9) + 1.6);
  const alt = candidate < -1e8 ? 0 : candidate;

  for (let b = 0; b < bands.length; b++) {
    const band = bands[b];
    await Promise.all(band.tiles.map((ref) => loadTile(ref.z, ref.x, ref.y).then(tick)));
    if (b === 0 || b === bands.length - 1 || b % 2 === 1) {
      post({ type: 'partial', requestId: request.requestId, horizon: profileNow(alt) });
    }
  }

  const horizon = profileNow(alt);
  const scanner = makeScanner({ lat, lon }, radiusM);

  const behind: TerrainResult['behind'] = [];
  const hidden: number[] = [];
  let samples = count * 700;
  for (const peak of request.peaks) {
    const stop = Math.max(120, peak.distance - Math.max(220, peak.distance * 0.012));
    const scan = scanner(peak.bearing, stop, 2, alt, 200);
    const peakAngle = Math.atan2(peak.ele - alt - (peak.distance * peak.distance) / (2 * R_EFF), peak.distance) * RAD;
    // EU-DEM is a surface model: forest and buildings add height to ridges but
    // not to summits. Allow 14 m of that, plus a floor for DEM noise, and never
    // let the 200 m under your feet count as a blocker.
    const tolerance = Math.max(0.3, Math.atan2(14, Math.max(200, scan.distance)) * RAD);
    if (scan.angle > peakAngle + tolerance) hidden.push(peak.id);
    else behind.push({ id: peak.id, ridge: scan.angle, ridgeDistance: scan.distance });
    samples += scan.samples;
  }

  post({
    type: 'done',
    requestId: request.requestId,
    result: {
      horizon,
      behind,
      hidden,
      groundElevation,
      eyeAltitude: alt,
      tilesLoaded: loaded,
      tilesFailed: failed,
      samples,
      ms: Math.round(performance.now() - started)
    } satisfies TerrainResult
  });
};

export {};
