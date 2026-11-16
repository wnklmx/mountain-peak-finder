#!/usr/bin/env node
/**
 * Builds public/data/peaks.geojson from the GeoNames country dumps.
 *
 * GeoNames is a reliable, plain-text source (CC BY 4.0) that needs no API and
 * no rate limits, which makes it the default extractor. The OSM/Overpass path
 * in fetch-peaks.mjs gives richer names but the public endpoint is often busy.
 *
 *   COUNTRIES=AT,CH,DE,IT,FR,SI npm run data:peaks-geonames
 */
import { createReadStream, createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createInterface } from 'node:readline';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '../public/data');

const region = {
  name: process.env.REGION_NAME ?? 'Alps',
  west: Number(process.env.WEST ?? 5.5),
  south: Number(process.env.SOUTH ?? 43.5),
  east: Number(process.env.EAST ?? 16.5),
  north: Number(process.env.NORTH ?? 48.2)
};

const countries = (process.env.COUNTRIES ?? 'AT,CH,DE,IT,FR,SI,LI').split(',').map((c) => c.trim());
const KEEP_CODES = new Set(['PK', 'MT', 'MTS', 'HLL', 'RDGE', 'SPUR']);
const BASE = 'https://download.geonames.org/export/dump';

async function download(country, dir) {
  const zipPath = join(dir, `${country}.zip`);
  const response = await fetch(`${BASE}/${country}.zip`);
  if (!response.ok || !response.body) throw new Error(`${country}.zip: HTTP ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(zipPath));
  execFileSync('unzip', ['-o', '-q', zipPath, '-d', dir]);
  return join(dir, `${country}.txt`);
}

function inRegion(lat, lon) {
  return lat >= region.south && lat <= region.north && lon >= region.west && lon <= region.east;
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const work = resolve(here, '../.cache/geonames');
  mkdirSync(work, { recursive: true });

  const kept = new Map();
  let scanned = 0;
  let outside = 0;

  {
    for (const country of countries) {
      let txt = join(work, `${country}.txt`);
      if (!existsSync(txt)) {
        process.stdout.write(`${country}: downloading… `);
        txt = await download(country, work);
        process.stdout.write('done\n');
      }

      const reader = createInterface({ input: createReadStream(txt, 'utf8'), crlfDelay: Infinity });
      let count = 0;
      for await (const line of reader) {
        scanned++;
        const cols = line.split('\t');
        if (cols[6] !== 'T' || !KEEP_CODES.has(cols[7])) continue;
        const lat = Number(cols[4]);
        const lon = Number(cols[5]);
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || !inRegion(lat, lon)) {
          outside++;
          continue;
        }
        const elevation = Number(cols[15]) || Number(cols[16]) || 0;
        const name = (cols[1] ?? '').trim();
        if (!name || elevation <= 0) continue;

        // Same summit is often listed under several names or as PK + MT.
        const cellLat = Math.round(lat / 0.002);
        const cellLon = Math.round(lon / 0.002);
        let clash = null;
        for (let dy = -1; dy <= 1 && !clash; dy++) {
          for (let dx = -1; dx <= 1 && !clash; dx++) {
            const bucket = kept.get(`${cellLat + dy}:${cellLon + dx}`);
            if (!bucket) continue;
            for (const candidate of bucket) {
              if (Math.abs(candidate.lat - lat) < 0.0016 && Math.abs(candidate.lon - lon) < 0.0024) {
                clash = candidate;
                break;
              }
            }
          }
        }
        if (clash) {
          if (elevation > clash.ele) clash.ele = elevation;
          continue;
        }
        const entry = { id: Number(cols[0]), name, ele: elevation, lat, lon };
        const key = `${cellLat}:${cellLon}`;
        if (!kept.has(key)) kept.set(key, []);
        kept.get(key).push(entry);
        count++;
      }
      console.log(`${country}: +${count} peaks in region`);
    }
  }

  const all = [];
  for (const bucket of kept.values()) all.push(...bucket);

  // GeoNames sometimes tags glaciers, ski areas or sub-summits as peaks.
  const iceOrArea = /^(glacier|gletscher|vadrec|vedretta|ghiacciaio|glaciar|station)\s/i;
  const cleaned = all.filter((peak) => !iceOrArea.test(peak.name));

  // The same summit is often listed under two geoname ids (e.g. "Mont Blanc"
  // as a 2,298 m viewpoint and as the 4,806 m summit). Keep the higher one.
  const byName = new Map();
  for (const peak of cleaned) {
    const norm = peak.name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    const bucket = byName.get(norm) ?? [];
    bucket.push(peak);
    byName.set(norm, bucket);
  }
  const visible = new Set();
  for (const bucket of byName.values()) {
    if (bucket.length > 60) {
      for (const peak of bucket) visible.add(peak);
      continue;
    }
    for (const peak of bucket) {
      let shadowed = false;
      for (const other of bucket) {
        if (other === peak) continue;
        const dLat = (other.lat - peak.lat) * 111;
        const dLon = (other.lon - peak.lon) * 111 * Math.cos((peak.lat * Math.PI) / 180);
        if (Math.hypot(dLat, dLon) < 15 && other.ele > peak.ele) {
          shadowed = true;
          break;
        }
      }
      if (!shadowed) visible.add(peak);
    }
  }

  const deduped = cleaned.filter((peak) => visible.has(peak));
  deduped.sort((a, b) => a.name.localeCompare(b.name));

  const features = deduped.map((peak) => ({
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [Number(peak.lon.toFixed(5)), Number(peak.lat.toFixed(5))]
    },
    properties: { id: peak.id, n: peak.name, e: Math.round(peak.ele) }
  }));

  const collection = { type: 'FeatureCollection', features };
  const meta = {
    name: region.name,
    bbox: [region.west, region.south, region.east, region.north],
    count: features.length,
    generated: new Date().toISOString(),
    source: 'GeoNames country dumps (feature class T)',
    license: 'CC-BY-4.0',
    attribution: 'Peak data © GeoNames (CC BY 4.0)'
  };

  await writeFile(resolve(outDir, 'peaks.geojson'), JSON.stringify(collection));
  await writeFile(resolve(outDir, 'meta.json'), JSON.stringify(meta, null, 2));

  const bytes = Buffer.byteLength(JSON.stringify(collection));
  console.log(
    `\nScanned ${scanned.toLocaleString()} rows, skipped ${outside.toLocaleString()} outside the region.`
  );
  console.log(`Wrote ${features.length.toLocaleString()} peaks (${(bytes / 1024 / 1024).toFixed(2)} MB).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
