export const EARTH_R = 6371008.8;
export const REFRACTION_K = 0.13;
export const R_EFF = EARTH_R / (1 - REFRACTION_K);

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

export function normalize360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

export function normalize180(deg: number): number {
  return ((deg + 540) % 360) - 180;
}

export interface LatLon {
  lat: number;
  lon: number;
}

export interface Peak extends LatLon {
  id: number;
  name: string;
  ele: number;
}

export interface PeakView extends Peak {
  bearing: number;
  distance: number;
  angle: number;
  x: number;
  y: number;
}

/** Local east/north offset in metres. Flat-earth approximation, fine below ~300 km. */
export function project(origin: LatLon, point: LatLon): { x: number; y: number; distance: number } {
  const dLat = (point.lat - origin.lat) * DEG;
  let dLon = (point.lon - origin.lon) * DEG;
  if (dLon > Math.PI) dLon -= 2 * Math.PI;
  if (dLon < -Math.PI) dLon += 2 * Math.PI;
  const x = EARTH_R * dLon * Math.cos(origin.lat * DEG);
  const y = EARTH_R * dLat;
  return { x, y, distance: Math.hypot(x, y) };
}

/** Compass bearing from north, clockwise. */
export function bearingOf(x: number, y: number): number {
  return normalize360(Math.atan2(x, y) * RAD);
}

/**
 * Apparent elevation angle above the horizontal, in degrees.
 * Includes earth curvature and a standard refraction correction.
 */
export function elevationAngle(distance: number, dz: number): number {
  const drop = (distance * distance) / (2 * R_EFF);
  return Math.atan2(dz - drop, distance) * RAD;
}

/** Destination point from a start, a bearing and a distance in metres. */
export function destination(from: LatLon, bearingDeg: number, meters: number): LatLon {
  const d = meters / EARTH_R;
  const b = bearingDeg * DEG;
  const lat1 = from.lat * DEG;
  const lon1 = from.lon * DEG;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
  const lon2 =
    lon1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: lat2 / DEG, lon: ((lon2 / DEG + 540) % 360) - 180 };
}

export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  if (m < 10000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m / 1000)} km`;
}

export function formatElevation(m: number): string {
  return `${Math.round(m).toLocaleString('en-US')} m`;
}

export const CARDINALS = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'
];

export function cardinal(bearing: number): string {
  return CARDINALS[Math.round(normalize360(bearing) / 22.5) % 16];
}
