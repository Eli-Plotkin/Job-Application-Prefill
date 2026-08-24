# Apply Assistant

A Manifest V3 Chrome extension that fills job-application forms (Workday-first)
from a saved profile, with per-question AI drafting for open-ended questions. You
always review and click submit yourself — nothing is ever auto-submitted, and no
data leaves your machine except calls to your configured Anthropic API.

> **Note on `§` markers.** Comments throughout `src/` cite sections (`§4`, `§7`, …)
> of the internal design spec this was built against. That document isn't part of
> this repo; the markers are provenance, and every file is readable without it.

## Requirements

- **Node 18+** and Chrome 111+.
- **An Anthropic API key** ([console.anthropic.com](https://console.anthropic.com/settings/keys)),
  added in the dashboard. Without one the extension still runs, but only Stage 1
  matching works — roughly name/email/phone/profile-URL fields. Semantic matching
  and Write with AI both require the key.
- Cost is small but not zero: matching a typical application runs a fraction of a
  cent on the default model. The dasnhboard tracks weekly and lifetime spend.

## What it does

1. Configure once in the dashboard: upload a resume, write an "about me" blurb,
   and fill an answer bank of label → answer pairs.
2. Open a job application (e.g. a Workday tenant) and click the toolbar icon.
3. The extension scans the page, runs the two-stage matcher, and shows what it
   found — **without filling anything**.
4. Click **Fill all matched**, or fill fields individually.
5. For open-ended questions, click **Write with AI** to draft an answer from your
   resume + blurb, then **Rewrite** with guidance to iterate.

### Matching (two stages)

- **Stage 1** — free, instant, deterministic. Standardized identity/contact
  fields only (name, email, phone, LinkedIn/GitHub) via `autocomplete` tokens and
  input types. Zero API calls.
- **Stage 2** — one batched AI call maps every remaining varied-wording question
  (work authorization, sponsorship, relocation, "how did you hear", …) to answer
  bank entries, with a confidence threshold so weak guesses are left blank.
  For dropdown fields the model also sees the available option texts and must
  confirm the stored answer maps to a real option before committing — a mismatch
  returns no fill rather than a wrong one. A v2 strategy was evaluated that
  fired one parallel LLM call per unmatched field instead of a single batched
  call. It required a concurrency cap and inter-call delays to avoid rate limits,
  did not improve matching accuracy, and consumed significantly more tokens —
  so the single batched call was kept.

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
npm test                # vitest + jsdom — 211 tests across the core logic
npm run lint
```

The pure logic (matcher, drafter, storage, spend tracking, field detection,
React-safe filling, Workday adapter, overlay, matching engine) is covered by unit
tests. The browser edges (resume PDF/DOCX extraction) are thin and verified
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
preview/               static mockup of the dashboard for design iteration
scripts/               icon generation + font fetching (run by the build)
```

Field detection + filling is an **adapter** so Greenhouse/Lever/Ashby adapters
can be added later without touching the core. The Anthropic API key lives only in
the background worker; the content script sends prompts, never the key.

## Data & privacy

All data (resume text, blurb, answer bank, settings, API key) is stored locally
via `chrome.storage.local`. No sync, no server, no analytics. Use **Export /
Import** in the dashboard to back up or move to another device.

## Models & spend

Defaults: `claude-haiku-4-5` for matching (cheap, batched) and `claude-sonnet-4-6`
for drafting (better quality). Both are configurable in the dashboard.

The dashboard reports estimated weekly and lifetime API spend, computed in the
background worker from each response's token usage. Pricing is a small built-in
table keyed by model prefix — if you switch to a model that isn't in it, those
calls are counted as *unpriced* and called out in the dashboard rather than
silently counted as free.

## Evals

The Stage-2 matcher prompt is validated with [promptfoo](https://promptfoo.dev).
The eval imports the extension's real prompt builder, so it can't drift from what
ships. Five hand-authored suites cover direct, semantic, ambiguous, abstention,
and dropdown-option cases. See [`evals/README.md`](evals/README.md).

## Scope (v1)

No job scraping, no auto-submit, no auto-login/CAPTCHA, no multi-step wizard
navigation, no cloud sync. The extension assists a human actively filling a form.

## License

[MIT](LICENSE).
