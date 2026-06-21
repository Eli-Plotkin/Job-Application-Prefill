# Apply Assistant

A Manifest V3 Chrome extension that fills job-application forms (Workday-first)
from a saved profile, with per-question AI drafting for open-ended questions. You
always review and click submit yourself — nothing is ever auto-submitted, and no
data leaves your machine except calls to your configured Anthropic API.

Built to the spec in `Apply_Assistant_Spec.md`.

## What it does

1. Configure once in the dashboard: upload a resume, write an "about me" blurb,
   and fill an answer bank of label → answer pairs.
2. Open a job application (e.g. a Workday tenant) and click the toolbar icon.
3. The extension scans the page, runs the two-stage matcher, and shows what it
   found — **without filling anything**.
4. Click **Fill all matched**, or fill fields individually.
5. For open-ended questions, click **Write with AI** to draft an answer from your
   resume + blurb, then **Rewrite** with guidance to iterate.

### Matching (two stages, §4)

- **Stage 1** — free, instant, deterministic. Standardized identity/contact
  fields only (name, email, phone, LinkedIn/GitHub) via `autocomplete` tokens and
  input types. Zero API calls.
- **Stage 2** — one batched AI call maps every remaining varied-wording question
  (work authorization, sponsorship, relocation, "how did you hear", …) to answer
  bank entries, with a confidence threshold so weak guesses are left blank.
  For dropdown fields the model also sees the available option texts and must
  confirm the stored answer maps to a real option before committing — a mismatch
  returns no fill rather than a wrong one. Two Stage 2 strategies are under eval:
  a single batched call (v1) vs. one parallel call per field (v2).

## Build & load

```bash
npm install
npm run build           # bundles into dist/
```

Then in Chrome: `chrome://extensions` → enable **Developer mode** → **Load
unpacked** → select the `dist/` folder. Open the extension's **Options** to
configure your profile and Anthropic API key.

`npm run build:watch` rebuilds on change while developing.

## Test

```bash
npm test                # vitest, jsdom — 73 tests across the core logic
npm run lint
```

The pure logic (matcher, drafter, storage, field detection, React-safe filling,
Workday adapter, overlay, matching engine) is covered by unit tests. The browser
edges (background SDK call, resume PDF/DOCX extraction) are thin and verified
manually in a real browser.

## Architecture

```
src/
  lib/
    settings.js        defaults, storage keys, export schema version
    storage.js         chrome.storage.local wrapper + export/import
    matcher.js         Stage 1 rules + Stage 2 prompt/parse (pure)
    drafter.js         Write-with-AI prompt construction (pure)
    engine.js          matching orchestration (Stage 1 -> batched Stage 2)
  dom/
    field-detector.js  field detection + robust label resolution
    field-filler.js    React-safe value setting + native <select> + highlight
  adapters/
    base.js            generic native-form adapter
    workday.js         Workday custom-combobox widgets
    registry.js        host -> adapter selection
  content/
    content-script.js  on-demand entry: scan, match, render overlay, fill
    overlay.js         shadow-DOM in-page overlay
  background/
    background.js      Anthropic SDK proxy + toolbar activation + open options
  dashboard/
    dashboard.html/css/js   options page
    resume-parser.js   file-type routing (pure, injectable backends)
    resume-backends.js pdf.js + mammoth (vendored, runtime-loaded)
evals/                 promptfoo eval harness (see evals/README.md)
```

Field detection + filling is an **adapter** so Greenhouse/Lever/Ashby adapters
can be added later without touching the core. The Anthropic API key lives only in
the background worker; the content script sends prompts, never the key.

## Data & privacy

All data (resume text, blurb, answer bank, settings, API key) is stored locally
via `chrome.storage.local`. No sync, no server, no analytics. Use **Export /
Import** in the dashboard to back up or move to another device.

## Models

Defaults: `claude-haiku-4-5` for matching (cheap, batched) and `claude-sonnet-4-6`
for drafting (better quality). Both are configurable in the dashboard.

## Evals

The matcher and drafter prompts are validated with [promptfoo](https://promptfoo.dev).
The eval prompts import the extension's real prompt builders, so they can't drift.
See [`evals/README.md`](evals/README.md). The harness is scaffolded with clearly
marked placeholder cases for you to fill in and verify by hand.

## Scope (v1)

No job scraping, no auto-submit, no auto-login/CAPTCHA, no multi-step wizard
navigation, no cloud sync. The extension assists a human actively filling a form.
