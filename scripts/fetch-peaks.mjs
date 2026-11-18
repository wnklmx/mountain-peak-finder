#!/usr/bin/env node
/**
 * Builds public/data/peaks.geojson from OpenStreetMap.
 *
 * The Overpass API is rate limited, so the region is split into tiles and each
 * tile is retried with exponential backoff. Override the region with env vars:
 *
 *   WEST=6 SOUTH=45 EAST=10 NORTH=48 REGION_NAME="Switzerland" npm run data:peaks
 *
 * Data © OpenStreetMap contributors, ODbL 1.0.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '../public/data');

const region = {
  name: process.env.REGION_NAME ?? 'Alps',
  west: Number(process.env.WEST ?? 5.5),
  south: Number(process.env.SOUTH ?? 43.5),
  east: Number(process.env.EAST ?? 16.5),
  north: Number(process.env.NORTH ?? 48.2)
};

const ENDPOINT = process.env.OVERPASS ?? 'https://overpass-api.de/api/interpreter';
const TILE_W = 2.0;
const TILE_H = 1.5;
const PAUSE_MS = 1200;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function overpass(query, attempt = 0) {
  let response;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': 'buscacumbres/0.1 (github.com/wnklmx)'
      },
      body: new URLSearchParams({ data: query }).toString()
    });
  } catch (error) {
    if (attempt >= 6) throw error;
    const wait = Math.min(45000, 3000 * 2 ** attempt);
    console.warn(`  network error, retrying in ${Math.round(wait / 1000)}s`);
    await sleep(wait);
    return overpass(query, attempt + 1);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    if (attempt >= 6) throw new Error(`Overpass HTTP ${response.status}: ${body.slice(0, 160)}`);
    const wait = Math.min(45000, 3000 * 2 ** attempt);
    console.warn(`  HTTP ${response.status}, retrying in ${Math.round(wait / 1000)}s`);
    await sleep(wait);
    return overpass(query, attempt + 1);
  }

  return response.json();
}

function parseElevation(raw) {
  if (raw == null) return NaN;
  const cleaned = String(raw).replace(',', '.').replace(/[^\d.\-]/g, '');
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? value : NaN;
}

async function main() {
  await mkdir(outDir, { recursive: true });

  const tiles = [];
  for (let west = region.west; west < region.east; west += TILE_W) {
    for (let south = region.south; south < region.north; south += TILE_H) {
      tiles.push({
        west,
        south,
        east: Math.min(west + TILE_W, region.east),
        north: Math.min(south + TILE_H, region.north)
      });
    }
  }

  console.log(`Region "${region.name}": ${tiles.length} tiles`);
  const byId = new Map();
  let dropped = 0;

  for (let index = 0; index < tiles.length; index++) {
    const tile = tiles[index];
    const query = `[out:json][timeout:90];
node["natural"="peak"]["name"](${tile.south.toFixed(4)},${tile.west.toFixed(4)},${tile.north.toFixed(4)},${tile.east.toFixed(4)});
out body;`;

    let payload = null;
    try {
      payload = await overpass(query);
    } catch (error) {
      console.error(`  tile ${index + 1}/${tiles.length} failed: ${error.message}`);
      continue;
    }

    let kept = 0;
    for (const element of payload.elements ?? []) {
      const tags = element.tags ?? {};
      const ele = parseElevation(tags.ele);
      const name = tags.name;
      if (!name || !Number.isFinite(ele)) {
        dropped++;
        continue;
      }
      byId.set(element.id, {
        id: element.id,
        name,
        ele,
        lat: element.lat,
        lon: element.lon
      });
      kept++;
    }
    console.log(`  tile ${index + 1}/${tiles.length}: +${kept} (total ${byId.size})`);
    if (index < tiles.length - 1) await sleep(PAUSE_MS);
  }

  const seen = new Set();
  const features = [];
  const sorted = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  for (const peak of sorted) {
    const key = `${peak.name.toLowerCase()}|${peak.lat.toFixed(3)}|${peak.lon.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    features.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [Number(peak.lon.toFixed(5)), Number(peak.lat.toFixed(5))]
      },
      properties: { id: peak.id, n: peak.name, e: Math.round(peak.ele) }
    });
  }

  const collection = { type: 'FeatureCollection', features };
  const meta = {
    name: region.name,
    bbox: [region.west, region.south, region.east, region.north],
    count: features.length,
    generated: new Date().toISOString(),
    source: 'OpenStreetMap natural=peak',
    license: 'ODbL-1.0',
    attribution: '© OpenStreetMap contributors'
  };

  await writeFile(resolve(outDir, 'peaks.geojson'), JSON.stringify(collection));
  await writeFile(resolve(outDir, 'meta.json'), JSON.stringify(meta, null, 2));

  const bytes = Buffer.byteLength(JSON.stringify(collection));
  console.log(`\nWrote ${features.length} peaks (${(bytes / 1024 / 1024).toFixed(2)} MB), dropped ${dropped} without elevation.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
