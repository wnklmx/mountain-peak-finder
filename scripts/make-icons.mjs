#!/usr/bin/env node
/**
 * Generates the PWA icons without any image library: rasterises a small
 * mountain glyph, supersamples it, and writes a valid PNG by hand.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '../public/icons');
mkdirSync(outDir, { recursive: true });

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = -1;
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = deflateSync(raw, { level: 9 });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const BG = [10, 15, 24];
const ROCK = [246, 183, 60];
const SNOW = [243, 247, 255];

function insideTriangle(px, py, a, b, c) {
  const d1 = (px - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (py - b[1]);
  const d2 = (px - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (py - c[1]);
  const d3 = (px - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (py - a[1]);
  const hasNegative = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPositive = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNegative && hasPositive);
}

function makeIcon(size, scale) {
  const ss = 3;
  const n = size * ss;
  const samples = Buffer.alloc(n * n * 4);

  const transform = (u) => 0.5 + (u - 0.5) * scale;
  const mountain = [
    [transform(0.1), transform(0.8)],
    [transform(0.5), transform(0.2)],
    [transform(0.9), transform(0.8)]
  ];
  const snow = [
    [transform(0.5), transform(0.2)],
    [transform(0.34), transform(0.44)],
    [transform(0.66), transform(0.44)]
  ];

  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n;
      const v = (y + 0.5) / n;
      let color = BG;
      const groundY = transform(0.8);
      if (Math.abs(v - groundY) < 0.012 * scale && u > transform(0.08) && u < transform(0.92)) color = [34, 48, 74];
      if (insideTriangle(u, v, mountain[0], mountain[1], mountain[2])) color = ROCK;
      if (insideTriangle(u, v, snow[0], snow[1], snow[2])) color = SNOW;
      const offset = (y * n + x) * 4;
      samples[offset] = color[0];
      samples[offset + 1] = color[1];
      samples[offset + 2] = color[2];
      samples[offset + 3] = 255;
    }
  }

  const out = Buffer.alloc(size * size * 4);
  const perPixel = ss * ss;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let dy = 0; dy < ss; dy++) {
        for (let dx = 0; dx < ss; dx++) {
          const offset = ((y * ss + dy) * n + (x * ss + dx)) * 4;
          r += samples[offset];
          g += samples[offset + 1];
          b += samples[offset + 2];
        }
      }
      const offset = (y * size + x) * 4;
      out[offset] = Math.round(r / perPixel);
      out[offset + 1] = Math.round(g / perPixel);
      out[offset + 2] = Math.round(b / perPixel);
      out[offset + 3] = 255;
    }
  }

  return encodePng(size, size, out);
}

const outputs = [
  ['icon-192.png', 192, 1],
  ['icon-512.png', 512, 1],
  ['icon-maskable-512.png', 512, 0.68],
  ['apple-touch-icon.png', 180, 1]
];

for (const [name, size, scale] of outputs) {
  writeFileSync(resolve(outDir, name), makeIcon(size, scale));
  console.log(`icons/${name}`);
}

const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#0a0f18"/>
  <path d="M8 50 32 14 56 50Z" fill="#f6b73c"/>
  <path d="M32 14 42.7 30H21.3Z" fill="#f3f7ff"/>
</svg>
`;
writeFileSync(resolve(here, '../public/favicon.svg'), favicon);
console.log('favicon.svg');
