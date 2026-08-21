#!/usr/bin/env node
/**
 * Generates the app icon and splash mark.
 *
 * These are committed binaries, so the script that made them is committed too —
 * otherwise the only way to change the icon is to open a design tool and guess
 * at the original geometry. Run `node scripts/generate-assets.mjs` after editing.
 *
 * The mark is the ladder: six ascending rungs, dim at the bottom and bright at
 * the top, which is the product in one shape. Drawn at 4x and box-downsampled,
 * which is enough antialiasing for straight edges and needs no dependencies.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const assets = join(here, '..', 'assets');

const INK = [15, 27, 42]; // #0f1b2a — the same ground as the app's dark theme
const RUNGS = [
  [58, 92, 130],
  [70, 112, 156],
  [82, 132, 182],
  [96, 152, 205],
  [122, 176, 224],
  [168, 206, 240],
];

const SUPERSAMPLE = 4;

/** A plain RGB canvas: `pixels` is row-major, three bytes per pixel. */
function createCanvas(width, height, background) {
  const pixels = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    pixels[i * 3] = background[0];
    pixels[i * 3 + 1] = background[1];
    pixels[i * 3 + 2] = background[2];
  }
  return { width, height, pixels };
}

function fillRoundedRect(canvas, x, y, width, height, radius, color) {
  const right = x + width;
  const bottom = y + height;
  for (let py = Math.max(0, Math.floor(y)); py < Math.min(canvas.height, Math.ceil(bottom)); py++) {
    for (let px = Math.max(0, Math.floor(x)); px < Math.min(canvas.width, Math.ceil(right)); px++) {
      // Distance past the straight edges, per axis; inside a corner arc both are
      // positive and the pixel is kept only within `radius` of the arc centre.
      const dx = Math.max(x + radius - px, 0, px - (right - radius - 1));
      const dy = Math.max(y + radius - py, 0, py - (bottom - radius - 1));
      if (dx > 0 && dy > 0 && dx * dx + dy * dy > radius * radius) continue;
      const offset = (py * canvas.width + px) * 3;
      canvas.pixels[offset] = color[0];
      canvas.pixels[offset + 1] = color[1];
      canvas.pixels[offset + 2] = color[2];
    }
  }
}

/** Box-downsample by `factor`, which is what turns the 4x draw into smooth edges. */
function downsample(canvas, factor) {
  const width = canvas.width / factor;
  const height = canvas.height / factor;
  const out = createCanvas(width, height, [0, 0, 0]);
  const samples = factor * factor;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < factor; sy++) {
        for (let sx = 0; sx < factor; sx++) {
          const offset = ((y * factor + sy) * canvas.width + (x * factor + sx)) * 3;
          r += canvas.pixels[offset];
          g += canvas.pixels[offset + 1];
          b += canvas.pixels[offset + 2];
        }
      }
      const offset = (y * width + x) * 3;
      out.pixels[offset] = Math.round(r / samples);
      out.pixels[offset + 1] = Math.round(g / samples);
      out.pixels[offset + 2] = Math.round(b / samples);
    }
  }
  return out;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(canvas) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(canvas.width, 0);
  header.writeUInt32BE(canvas.height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: truecolour
  // 10..12 stay zero: deflate, adaptive filtering, no interlace.

  // One filter byte (0 = None) per scanline, ahead of that row's pixels.
  const stride = canvas.width * 3;
  const raw = Buffer.alloc((stride + 1) * canvas.height);
  for (let y = 0; y < canvas.height; y++) {
    raw[y * (stride + 1)] = 0;
    canvas.pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * The ladder mark. `inset` is the share of the canvas left as margin — Android
 * adaptive icons crop hard, so they get a bigger one.
 */
function drawLadder(size, inset) {
  const scale = size * SUPERSAMPLE;
  const canvas = createCanvas(scale, scale, INK);

  const margin = scale * inset;
  const usable = scale - margin * 2;
  const gap = usable * 0.045;
  const rungHeight = (usable - gap * (RUNGS.length - 1)) / RUNGS.length;
  const radius = rungHeight * 0.34;

  RUNGS.forEach((color, index) => {
    // Bottom rung is widest: the base is broad, the frontier is narrow.
    // Centred rather than left-aligned, so the stack reads as a climb instead
    // of as a ragged margin.
    const width = usable * (1 - index * 0.085);
    const x = margin + (usable - width) / 2;
    const y = margin + (RUNGS.length - 1 - index) * (rungHeight + gap);
    fillRoundedRect(canvas, x, y, width, rungHeight, radius, color);
  });

  return downsample(canvas, SUPERSAMPLE);
}

mkdirSync(assets, { recursive: true });

const outputs = [
  ['icon.png', drawLadder(1024, 0.16)],
  ['adaptive-icon.png', drawLadder(1024, 0.26)],
  ['splash-icon.png', drawLadder(512, 0.18)],
  ['favicon.png', drawLadder(48, 0.14)],
];

for (const [name, canvas] of outputs) {
  const png = encodePng(canvas);
  writeFileSync(join(assets, name), png);
  console.log(`${name}: ${canvas.width}x${canvas.height}, ${(png.length / 1024).toFixed(1)} KB`);
}
