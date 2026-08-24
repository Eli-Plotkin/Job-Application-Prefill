import { describe, it, expect, vi, beforeEach } from "vitest";

// Fake the Anthropic SDK so no network is touched.
const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    constructor(opts) {
      this.opts = opts;
      this.messages = { create };
    }
  },
}));

const flush = () => new Promise((r) => setTimeout(r));

let messageListener;
let actionListener;
let tabsUpdatedListener;
let getMock;
let openOptionsPage;

function setupChrome(storageGet) {
  getMock = vi.fn(storageGet);
  openOptionsPage = vi.fn();
  messageListener = null;
  actionListener = null;
  tabsUpdatedListener = null;
  globalThis.chrome = {
    runtime: {
      onMessage: { addListener: (fn) => (messageListener = fn) },
      openOptionsPage,
    },
    action: {
      onClicked: { addListener: (fn) => (actionListener = fn) },
      setBadgeText: vi.fn().mockResolvedValue(undefined),
      setBadgeBackgroundColor: vi.fn().mockResolvedValue(undefined),
      setTitle: vi.fn().mockResolvedValue(undefined),
    },
    tabs: { onUpdated: { addListener: (fn) => (tabsUpdatedListener = fn) } },
    scripting: { executeScript: vi.fn() },
    storage: { local: { get: getMock, set: vi.fn().mockResolvedValue(undefined) } },
  };
}

// Title text the most recent setTitle call wrote, for assertion convenience.
const lastTitle = () => chrome.action.setTitle.mock.calls.at(-1)[0].title;

async function loadBackground(storageGet) {
  vi.resetModules();
  create.mockReset();
  setupChrome(storageGet);
  await import("../src/background/background.js");
}

beforeEach(() => {
  create.mockReset();
});

describe("background AA_COMPLETE broker", () => {
  it("calls the Messages API and returns concatenated text blocks", async () => {
    await loadBackground(async () => ({ settings: { apiKey: "sk-test", matchModel: "claude-haiku-4-5" } }));
    create.mockResolvedValue({
      content: [
        { type: "thinking", thinking: "ignore me" },
        { type: "text", text: "hello" },
        { type: "text", text: "world" },
      ],
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    const sendResponse = vi.fn();
    const ret = messageListener(
      { type: "AA_COMPLETE", model: "claude-haiku-4-5", system: "sys", user: "usr", maxTokens: 256 },
      {},
      sendResponse,
    );
    expect(ret).toBe(true); // keeps the channel open for async response
    await flush();

    expect(create).toHaveBeenCalledWith({
      model: "claude-haiku-4-5",
      max_tokens: 256,
      system: "sys",
      messages: [{ role: "user", content: "usr" }],
    });
    expect(sendResponse).toHaveBeenCalledWith({ ok: true, text: "hello\nworld" });
  });

  it("falls back to the configured match model and a default max_tokens", async () => {
    await loadBackground(async () => ({ settings: { apiKey: "sk", matchModel: "fallback-model" } }));
    create.mockResolvedValue({ content: [{ type: "text", text: "x" }], usage: { input_tokens: 1, output_tokens: 1 } });

    messageListener({ type: "AA_COMPLETE", system: "s", user: "u" }, {}, vi.fn());
    await flush();
    const arg = create.mock.calls[0][0];
    expect(arg.model).toBe("fallback-model");
    expect(arg.max_tokens).toBe(1024);
  });

  it("records a model outside the pricing table as unpriced rather than free", async () => {
    await loadBackground(async () => ({ settings: { apiKey: "sk", matchModel: "some-other-model" } }));
    create.mockResolvedValue({
      content: [{ type: "text", text: "x" }],
      usage: { input_tokens: 1000, output_tokens: 1000 },
    });

    messageListener({ type: "AA_COMPLETE", system: "s", user: "u" }, {}, vi.fn());
    await flush();

    const written = chrome.storage.local.set.mock.calls.at(-1)[0].spendLog;
    expect(written.lifetimeUsd).toBe(0);
    expect(written.unpricedCalls).toBe(1);
  });

  it("prices a known model and adds it to the spend log", async () => {
    await loadBackground(async () => ({ settings: { apiKey: "sk", matchModel: "claude-haiku-4-5" } }));
    create.mockResolvedValue({
      content: [{ type: "text", text: "x" }],
      usage: { input_tokens: 1_000_000, output_tokens: 0 },
    });

    messageListener({ type: "AA_COMPLETE", system: "s", user: "u" }, {}, vi.fn());
    await flush();

    const written = chrome.storage.local.set.mock.calls.at(-1)[0].spendLog;
    expect(written.lifetimeUsd).toBeCloseTo(0.8, 10); // 1M input tokens @ $0.80/MTok
    expect(written.unpricedCalls).toBe(0);
  });

  it("responds with an error when no API key is configured", async () => {
    await loadBackground(async () => ({})); // no settings stored → empty key
    const sendResponse = vi.fn();
    messageListener({ type: "AA_COMPLETE", system: "s", user: "u" }, {}, sendResponse);
    await flush();
    expect(create).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: "No API key set." });
  });

  it("surfaces an API error back to the caller", async () => {
    await loadBackground(async () => ({ settings: { apiKey: "sk" } }));
    create.mockRejectedValue(new Error("429 rate limited"));
    const sendResponse = vi.fn();
    messageListener({ type: "AA_COMPLETE", system: "s", user: "u" }, {}, sendResponse);
    await flush();
    expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: "429 rate limited" });
  });

  it("opens the dashboard on AA_OPEN_DASHBOARD and ignores unknown messages", async () => {
    await loadBackground(async () => ({}));
    expect(messageListener({ type: "AA_OPEN_DASHBOARD" }, {}, vi.fn())).toBe(false);
    expect(openOptionsPage).toHaveBeenCalled();
    expect(messageListener({ type: "SOMETHING_ELSE" }, {}, vi.fn())).toBe(false);
  });

  it("registers a toolbar click handler that injects the content script", async () => {
    await loadBackground(async () => ({}));
    expect(typeof actionListener).toBe("function");
    await actionListener({ id: 42 });
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 42 },
      files: ["content-script.js"],
    });
  });

  it("does nothing on a toolbar click with no tab id", async () => {
    await loadBackground(async () => ({}));
    await actionListener({});
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  });
});

describe("toolbar activation feedback", () => {
  beforeEach(() => {
    chrome?.action?.setBadgeText?.mockClear?.();
  });

  it("clears any stale badge after a successful injection", async () => {
    await loadBackground(async () => ({}));
    chrome.scripting.executeScript.mockResolvedValue([]);
    await actionListener({ id: 7 });
    expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ tabId: 7, text: "" });
    expect(lastTitle()).toBe("Activate Apply Assistant on this page");
  });

  it("badges the tab instead of failing silently when injection is refused", async () => {
    await loadBackground(async () => ({}));
    chrome.scripting.executeScript.mockRejectedValue(new Error("Cannot access contents of the page."));
    await actionListener({ id: 7 });

    expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ tabId: 7, text: "!" });
    expect(chrome.action.setBadgeBackgroundColor).toHaveBeenCalledWith({ tabId: 7, color: "#B91C1C" });
    expect(lastTitle()).toMatch(/can’t run on this page/);
  });

  it("names browser pages specifically, from the URL or the thrown error", async () => {
    await loadBackground(async () => ({}));
    chrome.scripting.executeScript.mockRejectedValue(new Error("Cannot access a chrome:// URL"));
    await actionListener({ id: 7 }); // no tab.url — activeTab was never granted
    expect(lastTitle()).toMatch(/browser pages/);

    await actionListener({ id: 7, url: "chrome://settings" });
    expect(lastTitle()).toMatch(/browser pages/);
  });

  it("names the Web Store specifically", async () => {
    await loadBackground(async () => ({}));
    chrome.scripting.executeScript.mockRejectedValue(new Error("The extensions gallery cannot be scripted."));
    await actionListener({ id: 7, url: "https://chromewebstore.google.com/detail/x" });
    expect(lastTitle()).toMatch(/Web Store/);
  });

  it("tells the user how to enable file:// access", async () => {
    await loadBackground(async () => ({}));
    chrome.scripting.executeScript.mockRejectedValue(new Error("Cannot access contents of the page."));
    await actionListener({ id: 7, url: "file:///Users/x/form.html" });
    expect(lastTitle()).toMatch(/Allow access to file URLs/);
  });

  it("clears the badge once the tab navigates, since the verdict is now stale", async () => {
    await loadBackground(async () => ({}));
    expect(typeof tabsUpdatedListener).toBe("function");

    tabsUpdatedListener(7, { status: "loading" });
    await flush();
    expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ tabId: 7, text: "" });

    chrome.action.setBadgeText.mockClear();
    tabsUpdatedListener(7, { status: "complete" }); // not a fresh navigation
    await flush();
    expect(chrome.action.setBadgeText).not.toHaveBeenCalled();
  });

  it("survives the tab being closed mid-click", async () => {
    await loadBackground(async () => ({}));
    chrome.scripting.executeScript.mockRejectedValue(new Error("No tab with id: 7."));
    chrome.action.setBadgeText.mockRejectedValue(new Error("No tab with id: 7."));
    await expect(actionListener({ id: 7 })).resolves.toBeUndefined();
  });
});
