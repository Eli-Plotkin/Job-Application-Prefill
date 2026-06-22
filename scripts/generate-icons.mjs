// Generate PNG toolbar icons: a near-black rounded square with a silver
// lightning bolt glyph. Outputs 16/48/128 px into dist/icons/.
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "dist", "icons");

const BG     = [14, 14, 14];    // near-black #0E0E0E
const SILVER = [200, 200, 200]; // silver #C8C8C8

// Lightning bolt polygon — normalized [0,1] coordinates, clockwise.
//   1 ─────────────────────── 6
//    \  upper-right           |
//  2  \  ── 3                 |
//      \   /                  |
//    4  \ /  ── 5             |
//        bottom
const BOLT = [
  [0.63, 0.12], // 1 — top right
  [0.30, 0.53], // 2 — mid left (upper)
  [0.52, 0.53], // 3 — inner notch top-right
  [0.38, 0.88], // 4 — bottom left
  [0.70, 0.47], // 5 — inner notch bottom-right
  [0.48, 0.47], // 6 — mid right (upper inner)
];

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, pixels) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    pixels.subarray(y * stride, y * stride + stride).copy(raw, y * (stride + 1) + 1);
  }
  const idat = deflateSync(raw);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

function set(pixels, size, x, y, [r, g, b], a = 255) {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const i = (y * size + x) * 4;
  pixels[i] = r; pixels[i + 1] = g; pixels[i + 2] = b; pixels[i + 3] = a;
}

// Scanline polygon fill.
function fillPolygon(pixels, size, verts, color) {
  const s = verts.map(([fx, fy]) => [fx * size, fy * size]);
  const minY = Math.floor(Math.min(...s.map(v => v[1])));
  const maxY = Math.ceil(Math.max(...s.map(v => v[1])));
  for (let y = minY; y <= maxY; y++) {
    const xs = [];
    for (let i = 0; i < s.length; i++) {
      const [x0, y0] = s[i];
      const [x1, y1] = s[(i + 1) % s.length];
      if (Math.min(y0, y1) <= y && y < Math.max(y0, y1)) {
        xs.push(x0 + (y - y0) * (x1 - x0) / (y1 - y0));
      }
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i < xs.length - 1; i += 2) {
      for (let x = Math.round(xs[i]); x <= Math.round(xs[i + 1]); x++) {
        set(pixels, size, x, y, color);
      }
    }
  }
}

function makeIcon(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const r = Math.round(size * 0.22); // corner radius

  // Background: rounded rect
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const inX = x >= r && x < size - r;
      const inY = y >= r && y < size - r;
      let inside = inX || inY;
      if (!inside) {
        const cx = x < r ? r : size - r - 1;
        const cy = y < r ? r : size - r - 1;
        inside = (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
      }
      if (inside) set(pixels, size, x, y, BG);
    }
  }

  fillPolygon(pixels, size, BOLT, SILVER);
  return encodePng(size, pixels);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of [16, 48, 128]) {
  writeFileSync(join(OUT_DIR, `icon${size}.png`), makeIcon(size));
}
console.log("icons: wrote icon16/48/128.png to dist/icons/");
