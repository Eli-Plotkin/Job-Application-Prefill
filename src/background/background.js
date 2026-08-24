// Background service worker (§3.3). Holds the API key, brokers the single
// generic completion call used by both the semantic matcher and the drafter, and
// opens the dashboard from the toolbar. No user data is sent anywhere except the
// configured Anthropic API.
import Anthropic from "@anthropic-ai/sdk";
import { getSettings, recordSpend } from "../lib/storage.js";

// Prices in USD per million tokens (Anthropic published rates).
// Matched by prefix so versioned model IDs (e.g. claude-haiku-4-5-20251001) resolve correctly.
const MODEL_PRICING = {
  "claude-haiku-4-5":  { input: 0.80, output: 4.00 },
  "claude-sonnet-4-6": { input: 3.00, output: 15.00 },
};

// Returns the call's cost in USD, or null when the model isn't in the pricing
// table. Null is distinct from 0: the dashboard exposes model names as free text,
// so an unrecognized model must be reported as unpriced rather than as free.
function computeCostUsd(model, inputTokens, outputTokens) {
  const key = Object.keys(MODEL_PRICING).find((k) => model.startsWith(k));
  if (!key) return null;
  const { input, output } = MODEL_PRICING[key];
  return (inputTokens * input + outputTokens * output) / 1_000_000;
}

async function complete({ model, system, user, maxTokens }) {
  const settings = await getSettings();
  if (!settings.apiKey) {
    throw new Error("No API key set.");
  }
  const resolvedModel = model || settings.matchModel;
  const client = new Anthropic({ apiKey: settings.apiKey, dangerouslyAllowBrowser: true });
  const resp = await client.messages.create({
    model: resolvedModel,
    max_tokens: maxTokens || 1024,
    system,
    messages: [{ role: "user", content: user }],
  });
  const usd = computeCostUsd(resolvedModel, resp.usage.input_tokens, resp.usage.output_tokens);
  // Fire-and-forget so spend bookkeeping never delays or fails the completion.
  recordSpend({ usd: usd ?? 0, priced: usd !== null }).catch(() => {});
  return resp.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "AA_COMPLETE") {
    complete(msg)
      .then((text) => sendResponse({ ok: true, text }))
      .catch((err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
    return true; // keep the channel open for the async response
  }
  if (msg && msg.type === "AA_OPEN_DASHBOARD") {
    chrome.runtime.openOptionsPage();
    return false;
  }
  return false;
});

// ---- Toolbar activation ----------------------------------------------------

const DEFAULT_TITLE = "Activate Apply Assistant on this page";

// Chrome refuses content-script injection on browser-internal pages, the Web
// Store, and file:// URLs without an explicit opt-in. Injection is attempted
// first and the failure classified afterwards, because on exactly those pages
// `activeTab` is never granted — so `tab.url` is usually withheld from us and
// the thrown error is the only reliable signal.
// Ordered most-specific first. Only strong signals are used: a matching URL, or
// an error string Chrome emits for exactly one cause. The generic host-permission
// message ("Extension manifest must request permission…") is deliberately NOT
// treated as a browser-page marker — it accompanies several unrelated refusals.
function unavailableReason(tab, err) {
  const url = String((tab && tab.url) || "");
  const msg = String((err && err.message) || err || "");
  const openOne = "Open a job application and try again.";

  if (/chromewebstore\.google\.com|chrome\.google\.com\/webstore/i.test(url) ||
      /gallery cannot be scripted/i.test(msg)) {
    return `Chrome blocks extensions on the Web Store. ${openOne}`;
  }
  if (/^file:\/\//i.test(url)) {
    return "Turn on “Allow access to file URLs” in this extension’s details to use it on local files.";
  }
  if (/^(chrome|edge|brave|about|devtools|view-source|chrome-extension):/i.test(url) ||
      /chrome:\/\//i.test(msg)) {
    return `Chrome blocks extensions on browser pages. ${openOne}`;
  }
  return `Apply Assistant can’t run on this page. ${openOne}`;
}

// Badge + tooltip are the only channels available when injection fails: we
// cannot render in-page UI on a page we were just refused access to. Both are
// scoped to the tab so one bad page never mislabels the others.
async function showUnavailable(tabId, reason) {
  try {
    await chrome.action.setBadgeText({ tabId, text: "!" });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: "#B91C1C" });
    await chrome.action.setTitle({ tabId, title: `Apply Assistant — ${reason}` });
  } catch {
    // Tab closed between the click and the badge write — nothing to report to.
  }
}

async function clearUnavailable(tabId) {
  try {
    await chrome.action.setBadgeText({ tabId, text: "" });
    await chrome.action.setTitle({ tabId, title: DEFAULT_TITLE });
  } catch {
    // Tab is gone; its per-tab badge state went with it.
  }
}

// Toolbar click → inject the content script on demand and activate it. Injecting
// only on click is what makes the extension inert until the user asks for it.
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content-script.js"],
    });
    await clearUnavailable(tab.id);
  } catch (e) {
    await showUnavailable(tab.id, unavailableReason(tab, e));
  }
});

// A navigation makes any previous "can't run here" verdict stale.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo && changeInfo.status === "loading") clearUnavailable(tabId);
});
