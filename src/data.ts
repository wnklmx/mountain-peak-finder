import { bearingOf, elevationAngle, project, type LatLon, type Peak, type PeakView } from './geo';

export type { Peak } from './geo';

export interface RegionMeta {
  name: string;
  bbox: [number, number, number, number];
  count: number;
  generated: string;
  source: string;
  license: string;
  attribution: string;
}

interface GeoJsonFeature {
  geometry: { coordinates: [number, number] };
  properties: Record<string, unknown>;
}

interface GeoJsonCollection {
  features: GeoJsonFeature[];
}

const BASE = import.meta.env.BASE_URL;

export async function loadData(): Promise<{ peaks: Peak[]; meta: RegionMeta | null }> {
  const [geoRes, metaRes] = await Promise.all([
    fetch(`${BASE}data/peaks.geojson`),
    fetch(`${BASE}data/meta.json`).catch(() => null)
  ]);

  if (!geoRes.ok) throw new Error(`Could not load peak data (HTTP ${geoRes.status})`);

  const geo = (await geoRes.json()) as GeoJsonCollection;
  const peaks: Peak[] = [];

  for (let i = 0; i < geo.features.length; i++) {
    const f = geo.features[i];
    const p = f.properties ?? {};
    const ele = Number(p.e ?? p.ele);
    const lat = f.geometry?.coordinates?.[1];
    const lon = f.geometry?.coordinates?.[0];
    if (!Number.isFinite(ele) || ele <= 0) continue;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    peaks.push({
      id: Number(p.id ?? i),
      name: String(p.n ?? p.name ?? 'Unnamed'),
      ele,
      lat,
      lon
    });
  }

  let meta: RegionMeta | null = null;
  if (metaRes && metaRes.ok) {
    try {
      meta = (await metaRes.json()) as RegionMeta;
    } catch {
      meta = null;
    }
  }

  return { peaks, meta };
}

export function rankPeaks(
  peaks: Peak[],
  origin: LatLon,
  eyeAltitude: number,
  radiusKm: number
): PeakView[] {
  const maxDistance = radiusKm * 1000;
  const out: PeakView[] = [];

  for (const peak of peaks) {
    if (Math.abs(peak.lat - origin.lat) > 3 || Math.abs(peak.lon - origin.lon) > 5) continue;
    const { x, y, distance } = project(origin, peak);
    if (distance > maxDistance || distance < 80) continue;
    out.push({
      ...peak,
      bearing: bearingOf(x, y),
      distance,
      angle: elevationAngle(distance, peak.ele - eyeAltitude),
      x,
      y
    });
  }

  out.sort((a, b) => a.distance - b.distance);
  return out;
}

/**
 * Bearing of the highest summit in range. A viewpoint picked on the map opens
 * looking at something worth seeing instead of at an arbitrary north.
 */
export function bestViewBearing(peaks: Peak[], origin: LatLon, radiusKm: number): number | null {
  const maxDistance = radiusKm * 1000;
  let best: { bearing: number; ele: number } | null = null;

  for (const peak of peaks) {
    if (Math.abs(peak.lat - origin.lat) > 3 || Math.abs(peak.lon - origin.lon) > 5) continue;
    const { x, y, distance } = project(origin, peak);
    // Skip the summit you are standing on and anything at the same coordinates.
    if (distance > maxDistance || distance < 200) continue;
    if (best && peak.ele <= best.ele) continue;
    best = { bearing: bearingOf(x, y), ele: peak.ele };
  }

  return best ? Math.round(best.bearing) : null;
}

export function insideRegion(bbox: [number, number, number, number] | undefined, point: LatLon): boolean {
  if (!bbox) return true;
  const [west, south, east, north] = bbox;
  const pad = 0.25;
  return point.lon >= west - pad && point.lon <= east + pad && point.lat >= south - pad && point.lat <= north + pad;
}
