// Generate simple PNG toolbar icons (no external image deps): a rounded blue
// square with a white "A" glyph. Outputs 16/48/128 px into dist/icons/.
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "dist", "icons");

const BRAND = [33, 30, 26]; // ink charcoal #211E1A (background)
const WHITE = [208, 138, 46]; // amber #D08A2E (the "A" glyph)

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
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // 10,11,12 = compression, filter, interlace = 0
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    pixels.subarray(y * stride, y * stride + stride).copy(raw, y * (stride + 1) + 1);
  }
  const idat = deflateSync(raw);
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function set(pixels, size, x, y, [r, g, b], a = 255) {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const i = (y * size + x) * 4;
  pixels[i] = r;
  pixels[i + 1] = g;
  pixels[i + 2] = b;
  pixels[i + 3] = a;
}

// Draw a thick line between two points (Bresenham-ish with radius).
function line(pixels, size, x0, y0, x1, y1, color, radius) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2 + 1;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const x = Math.round(x0 + (x1 - x0) * t);
    const y = Math.round(y0 + (y1 - y0) * t);
    for (let dx = -radius; dx <= radius; dx++)
      for (let dy = -radius; dy <= radius; dy++) set(pixels, size, x + dx, y + dy, color);
  }
}

function makeIcon(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const r = Math.round(size * 0.22); // corner radius
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // rounded-rect mask
      const inX = x >= r && x < size - r;
      const inY = y >= r && y < size - r;
      let inside = inX || inY;
      if (!inside) {
        const cx = x < r ? r : size - r - 1;
        const cy = y < r ? r : size - r - 1;
        inside = (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
      }
      if (inside) set(pixels, size, x, y, BRAND);
    }
  }
  // White "A": two legs + crossbar
  const t = Math.max(1, Math.round(size * 0.07));
  const top = Math.round(size * 0.26);
  const bot = Math.round(size * 0.74);
  const apex = Math.round(size * 0.5);
  const leftB = Math.round(size * 0.3);
  const rightB = Math.round(size * 0.7);
  line(pixels, size, apex, top, leftB, bot, WHITE, t);
  line(pixels, size, apex, top, rightB, bot, WHITE, t);
  const mid = Math.round(size * 0.56);
  line(pixels, size, Math.round(size * 0.37), mid, Math.round(size * 0.63), mid, WHITE, Math.max(1, t - 1));
  return encodePng(size, pixels);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of [16, 48, 128]) {
  writeFileSync(join(OUT_DIR, `icon${size}.png`), makeIcon(size));
}
console.log("icons: wrote icon16/48/128.png to dist/icons/");
