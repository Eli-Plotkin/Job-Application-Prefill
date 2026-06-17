// Build the extension into dist/. Bundles the three entry points with esbuild,
// copies static assets + vendored resume-parsing libraries, and generates icons.
import { build } from "esbuild";
import {
  mkdirSync,
  copyFileSync,
  rmSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = __dirname;
const dist = join(root, "dist");
const watch = process.argv.includes("--watch");

function copy(from, to) {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
}

async function run() {
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });

  const common = {
    bundle: true,
    format: "iife",
    platform: "browser",
    target: ["chrome111"],
    logLevel: "info",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
  };

  await build({
    ...common,
    entryPoints: {
      background: join(root, "src/background/background.js"),
      "content-script": join(root, "src/content/content-script.js"),
      dashboard: join(root, "src/dashboard/dashboard.js"),
    },
    outdir: dist,
  });

  // Static assets.
  copy(join(root, "manifest.json"), join(dist, "manifest.json"));
  copy(join(root, "src/dashboard/dashboard.html"), join(dist, "dashboard.html"));
  copy(join(root, "src/dashboard/dashboard.css"), join(dist, "dashboard.css"));

  // Local brand fonts (used by the dashboard and, via web_accessible_resources,
  // the in-page overlay).
  const fontDir = join(root, "src/dashboard/fonts");
  if (!existsSync(fontDir)) throw new Error("Missing src/dashboard/fonts — run node scripts/fetch-fonts.mjs");
  for (const f of readdirSync(fontDir).filter((n) => n.endsWith(".woff2"))) {
    copy(join(fontDir, f), join(dist, "fonts", f));
  }

  // Vendored resume-parsing libraries (loaded at runtime, not bundled).
  const vendors = [
    ["node_modules/pdfjs-dist/build/pdf.min.mjs", "vendor/pdf.min.mjs"],
    ["node_modules/pdfjs-dist/build/pdf.worker.min.mjs", "vendor/pdf.worker.min.mjs"],
    ["node_modules/mammoth/mammoth.browser.min.js", "vendor/mammoth.browser.min.js"],
  ];
  for (const [from, to] of vendors) {
    const src = join(root, from);
    if (!existsSync(src)) throw new Error(`Missing vendor file: ${from} (run npm install)`);
    copy(src, join(dist, to));
  }

  // Icons.
  execFileSync(process.execPath, [join(root, "scripts/generate-icons.mjs")], { stdio: "inherit" });

  console.log("\n✓ Built extension into dist/ — load it unpacked in chrome://extensions.");
}

if (watch) {
  // Minimal watch: rebuild on change via esbuild context.
  const { context } = await import("esbuild");
  await run();
  const ctx = await context({
    bundle: true,
    format: "iife",
    platform: "browser",
    target: ["chrome111"],
    define: { "process.env.NODE_ENV": '"production"' },
    entryPoints: {
      background: join(root, "src/background/background.js"),
      "content-script": join(root, "src/content/content-script.js"),
      dashboard: join(root, "src/dashboard/dashboard.js"),
    },
    outdir: dist,
  });
  await ctx.watch();
  console.log("watching for changes…");
} else {
  await run();
}
