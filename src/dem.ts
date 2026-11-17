/**
 * Terrain-RGB (Mapzen "Terrarium") helpers.
 *
 * Tiles are 256×256 PNGs where elevation = (R * 256 + G + B / 256) − 32768
 * metres. The dataset is public, needs no key, and is served from S3 through
 * the AWS Open Data programme.
 *
 * https://github.com/tilezen/joerd/blob/master/docs/formats.md
 */

export const TILE_SIZE = 256;

// Path-style S3 does not send CORS headers; the virtual-hosted host does.
const TILE_HOST = 'https://elevation-tiles-prod.s3.amazonaws.com/terrarium';

export function tileUrl(z: number, x: number, y: number): string {
  return `${TILE_HOST}/${z}/${x}/${y}.png`;
}

/** Fractional pixel position in the global Web Mercator grid at zoom z. */
export function lonLatToWorldPixel(lat: number, lon: number, z: number): { x: number; y: number } {
  const size = TILE_SIZE * 2 ** z;
  const clamped = Math.max(-85.0511, Math.min(85.0511, lat));
  const rad = (clamped * Math.PI) / 180;
  return {
    x: ((lon + 180) / 360) * size,
    y: ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * size
  };
}

/** Inverse of the above, for turning a sampled pixel back into a coordinate. */
export function worldPixelToLonLat(px: number, py: number, z: number): { lat: number; lon: number } {
  const size = TILE_SIZE * 2 ** z;
  const lon = (px / size) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * py) / size;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { lat, lon };
}

/** Metres covered by one pixel at a latitude and zoom level. */
export function metresPerPixel(lat: number, z: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;
}

/** Decode RGBA bytes into signed metres. Writes into `out` when given. */
export function decodeTerrarium(rgba: Uint8ClampedArray | Uint8Array, out?: Int16Array): Int16Array {
  const count = TILE_SIZE * TILE_SIZE;
  const result = out ?? new Int16Array(count);
  const step = rgba.length / count;
  for (let i = 0; i < count; i++) {
    const p = i * step;
    result[i] = Math.round(rgba[p] * 256 + rgba[p + 1] + rgba[p + 2] / 256 - 32768);
  }
  return result;
}

export interface TileRef {
  z: number;
  x: number;
  y: number;
}

export function tileOf(lat: number, lon: number, z: number): TileRef & { fx: number; fy: number } {
  const p = lonLatToWorldPixel(lat, lon, z);
  const x = Math.floor(p.x / TILE_SIZE);
  const y = Math.floor(p.y / TILE_SIZE);
  return { z, x, y, fx: p.x / TILE_SIZE - x, fy: p.y / TILE_SIZE - y };
}

/** Zoom levels used by the horizon raymarch, from near to far. */
export interface Band {
  /** Inner edge in metres. */
  from: number;
  /** Outer edge in metres. */
  to: number;
  z: number;
  /** Distance between samples, in metres. */
  step: number;
}

export const BANDS: Band[] = [
  { from: 0, to: 2500, z: 13, step: 18 },
  { from: 2500, to: 9000, z: 12, step: 40 },
  { from: 9000, to: 30000, z: 11, step: 110 },
  { from: 30000, to: 90000, z: 10, step: 300 },
  { from: 90000, to: 220000, z: 9, step: 800 }
];

/** Line-of-sight correction: curvature plus standard refraction, in metres. */
export function dropAt(distance: number, rEff: number): number {
  return (distance * distance) / (2 * rEff);
}

export const EARTH_RADIUS = 6371008.8;
export const REFRACTION_K = 0.13;
export const EFFECTIVE_RADIUS = EARTH_RADIUS / (1 - REFRACTION_K);
