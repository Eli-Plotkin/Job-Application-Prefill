// Background service worker (§3.3). Holds the API key, brokers the single
// generic completion call used by both the semantic matcher and the drafter, and
// opens the dashboard from the toolbar. No user data is sent anywhere except the
// configured Anthropic API.
import Anthropic from "@anthropic-ai/sdk";
import { getSettings } from "../lib/storage.js";

async function complete({ model, system, user, maxTokens }) {
  const settings = await getSettings();
  if (!settings.apiKey) {
    throw new Error("No API key set.");
  }
  const client = new Anthropic({ apiKey: settings.apiKey, dangerouslyAllowBrowser: true });
  const resp = await client.messages.create({
    model: model || settings.matchModel,
    max_tokens: maxTokens || 1024,
    system,
    messages: [{ role: "user", content: user }],
  });
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

// Toolbar click → inject the content script on demand and activate it. Injecting
// only on click is what makes the extension inert until the user asks for it.
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content-script.js"],
    });
  } catch (e) {
    // Some pages (chrome://, the Web Store) disallow injection — nothing to do.
    console.warn("Apply Assistant: cannot run on this page.", e);
  }
});
