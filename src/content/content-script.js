// Content script entry (§3.2). Injected on demand when the user activates the
// extension. Does nothing until activate() runs: then it scans the page, runs
// the matching engine, and renders the overlay. Nothing is filled until the user
// clicks. All heavy logic lives in tested modules; this file is just wiring.
import { getAdapter } from "../adapters/registry.js";
import { runMatching } from "../lib/engine.js";
import { buildDraftPrompt, buildRewritePrompt } from "../lib/drafter.js";
import { getAnswerBank, getResume, getBlurb, getSettings } from "../lib/storage.js";
import { Overlay } from "./overlay.js";

function completeViaBackground(prompt, model, maxTokens) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: "AA_COMPLETE", model, maxTokens, system: prompt.system, user: prompt.user },
      (resp) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!resp) return reject(new Error("No response from the background worker."));
        if (!resp.ok) return reject(new Error(resp.error || "Request failed."));
        resolve(resp.text);
      },
    );
  });
}

function humanError(e) {
  const msg = String((e && e.message) || e);
  if (/api key/i.test(msg)) return msg + " Open the Apply Assistant dashboard to add it.";
  return msg;
}

function createController() {
  let overlay = null;
  let adapter = null;
  let context = { answerBank: [], resumeText: "", blurb: "", settings: null };
  let resultsByField = new Map();
  const drafts = new Map();

  async function loadContext() {
    const [answerBank, resume, blurb, settings] = await Promise.all([
      getAnswerBank(),
      getResume(),
      getBlurb(),
      getSettings(),
    ]);
    context = { answerBank, resumeText: resume.text, blurb, settings };
  }

  async function scanAndMatch() {
    adapter = getAdapter(location.hostname);
    const fields = adapter.detect(document);
    const { settings, answerBank } = context;
    // Without an API key, run Stage 1 only so the user still sees standardized
    // matches instead of an all-or-nothing failure.
    const complete = settings.apiKey
      ? (prompt) => completeViaBackground(prompt, settings.matchModel, 1024)
      : null;
    const { results } = await runMatching({
      fields,
      answerBank,
      threshold: settings.matchConfidenceThreshold,
      complete,
    });
    resultsByField = new Map(results.map((r) => [r.field.id, r]));
    return results;
  }

  const callbacks = {
    onClose() {
      overlay = null;
    },
    onOpenDashboard() {
      chrome.runtime.sendMessage({ type: "AA_OPEN_DASHBOARD" });
    },
    async onRescan() {
      await loadContext();
      overlay.render(await scanAndMatch());
    },
    async onFillAll() {
      for (const r of resultsByField.values()) {
        if (r.status === "matched") {
          adapter.fill(r.field, r.entry.answer, { highlight: context.settings.highlightFilled });
        }
      }
    },
    async onFillField(fieldId) {
      const r = resultsByField.get(fieldId);
      if (!r || !r.entry) return false;
      return adapter.fill(r.field, r.entry.answer, { highlight: context.settings.highlightFilled });
    },
    async onWrite(fieldId, guidance) {
      const r = resultsByField.get(fieldId);
      const { resumeText, blurb, settings } = context;
      const question = r.field.label;
      const prompt =
        guidance == null
          ? buildDraftPrompt({ question, resumeText, blurb })
          : buildRewritePrompt({
              question,
              resumeText,
              blurb,
              previousDraft: drafts.get(fieldId) || "",
              guidance,
            });
      const text = await completeViaBackground(prompt, settings.draftModel, 1024);
      drafts.set(fieldId, text);
      adapter.fill(r.field, text, { highlight: settings.highlightFilled });
      return text;
    },
  };

  async function activate() {
    if (!overlay) {
      overlay = new Overlay(callbacks);
      overlay.mount();
    }
    try {
      await loadContext();
      const results = await scanAndMatch();
      overlay.render(results);
      if (!context.settings.apiKey) {
        overlay.showError("No API key set — only standardized fields were matched. Add a key in the dashboard for AI matching and drafting.");
      }
    } catch (e) {
      overlay.render([]);
      overlay.showError(humanError(e));
    }
  }

  return { activate };
}

(function () {
  const KEY = "__APPLY_ASSISTANT__";
  if (window[KEY]) {
    window[KEY].activate();
    return;
  }
  const controller = createController();
  Object.defineProperty(window, KEY, { value: controller, configurable: true });
  controller.activate();
})();
