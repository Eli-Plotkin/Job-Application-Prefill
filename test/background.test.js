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
let getMock;
let openOptionsPage;

function setupChrome(storageGet) {
  getMock = vi.fn(storageGet);
  openOptionsPage = vi.fn();
  messageListener = null;
  actionListener = null;
  globalThis.chrome = {
    runtime: {
      onMessage: { addListener: (fn) => (messageListener = fn) },
      openOptionsPage,
    },
    action: { onClicked: { addListener: (fn) => (actionListener = fn) } },
    scripting: { executeScript: vi.fn() },
    storage: { local: { get: getMock, set: vi.fn().mockResolvedValue(undefined) } },
  };
}

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
