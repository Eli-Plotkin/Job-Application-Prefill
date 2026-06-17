// Vendor the latin woff2 subset of the brand fonts locally so the extension makes
// zero external requests at runtime (keeps the "data stays local" promise).
// Run once: node scripts/fetch-fonts.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "src", "dashboard", "fonts");
mkdirSync(OUT, { recursive: true });

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

const FONTS = [
  { out: "hanken-grotesk.woff2", css: "https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400..700&display=swap" },
  { out: "spectral-600.woff2", css: "https://fonts.googleapis.com/css2?family=Spectral:wght@600&display=swap" },
  { out: "ibm-plex-mono-400.woff2", css: "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400&display=swap" },
  { out: "ibm-plex-mono-500.woff2", css: "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500&display=swap" },
];

// From a css2 response, pick the url() of the @font-face block whose unicode-range
// is the basic-latin block (contains U+0000).
function pickLatinUrl(css) {
  const blocks = css.split("@font-face");
  for (const b of blocks) {
    if (/unicode-range:[^;]*U\+0000/i.test(b)) {
      const m = b.match(/url\((https:\/\/[^)]+\.woff2)\)/);
      if (m) return m[1];
    }
  }
  // Fallback: first woff2 url anywhere.
  const m = css.match(/url\((https:\/\/[^)]+\.woff2)\)/);
  return m && m[1];
}

for (const f of FONTS) {
  const cssResp = await fetch(f.css, { headers: { "User-Agent": UA } });
  const css = await cssResp.text();
  const url = pickLatinUrl(css);
  if (!url) throw new Error(`No woff2 found for ${f.out}`);
  const fontResp = await fetch(url, { headers: { "User-Agent": UA } });
  const buf = Buffer.from(await fontResp.arrayBuffer());
  writeFileSync(join(OUT, f.out), buf);
  console.log(`${f.out}  ${(buf.length / 1024).toFixed(1)} KB  <- ${url.split("/").pop()}`);
}
console.log("\nFonts vendored to src/dashboard/fonts/");
