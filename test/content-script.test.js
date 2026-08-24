// Wiring tests for the content script. The heavy logic lives in modules that
// have their own suites; what is unique here is the orchestration — the scan
// guard, fill-outcome collection, and what gets handed to the overlay.
//
// The module is a self-executing IIFE, so `await import(...)` IS an activation.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { HIGHLIGHT_ATTR } from "../src/dom/field-filler.js";

const { overlays, adapterRef } = vi.hoisted(() => ({
  overlays: [],
  adapterRef: { current: null },
}));

// Spy overlay: captures the callbacks the controller passes in, so tests can
// invoke onFillAll/onRescan the way a real click would.
vi.mock("../src/content/overlay.js", () => ({
  Overlay: class {
    constructor(cb) {
      this.cb = cb;
      this.calls = [];
      this.mount = vi.fn(() => this);
      this.destroy = vi.fn();
      this.render = vi.fn((...a) => this.calls.push(["render", ...a]));
      this.renderLoading = vi.fn((...a) => this.calls.push(["renderLoading", ...a]));
      this.showError = vi.fn((...a) => this.calls.push(["showError", ...a]));
      overlays.push(this);
    }
  },
}));

// Fake adapter so fill outcomes are controllable — a real one would depend on
// live DOM behavior that the field-filler suite already covers.
vi.mock("../src/adapters/registry.js", () => ({
  getAdapter: () => adapterRef.current,
}));

const CONTENT_SCRIPT = "../src/content/content-script.js";
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async (n = 6) => { for (let i = 0; i < n; i++) await tick(); };

// A field descriptor as the detector would emit one.
const field = (id, label, over = {}) => ({
  id, label, tag: "input", type: "text", autocomplete: "", name: "", ...over,
});
const emailField = (id = "f-email") => field(id, "Email", { type: "email", autocomplete: "email" });

function fakeAdapter({ fields = [], fill = () => true } = {}) {
  return { detect: vi.fn(() => fields), fill: vi.fn(fill) };
}

async function seed({ answerBank = [], settings = {} } = {}) {
  await chrome.storage.local.set({
    answerBank,
    settings: { apiKey: "", matchConfidenceThreshold: 0.6, highlightFilled: true, ...settings },
    resumeText: "",
    blurb: "",
  });
}

// Fresh module registry + a cleared window key, so the IIFE really re-activates.
async function activateFresh() {
  overlays.length = 0;
  delete window.__APPLY_ASSISTANT__;
  vi.resetModules();
  await import(CONTENT_SCRIPT);
  await settle();
  return overlays[0];
}

beforeEach(async () => {
  await chrome.storage.local.clear();
  document.body.innerHTML = "";
  adapterRef.current = fakeAdapter();
  chrome.runtime.sendMessage = vi.fn();
  chrome.runtime.lastError = null;
});

afterEach(() => {
  delete window.__APPLY_ASSISTANT__;
});

describe("activation — the panel never sits blank", () => {
  it("paints the loading state before any async work, then replaces it", async () => {
    await seed();
    adapterRef.current = fakeAdapter({ fields: [emailField()] });

    const o = await activateFresh();

    expect(o.mount).toHaveBeenCalled();
    const kinds = o.calls.map((c) => c[0]);
    expect(kinds.indexOf("renderLoading")).toBeLessThan(kinds.indexOf("render"));
    expect(o.renderLoading).toHaveBeenCalledWith("Scanning this page…");
  });

  it("labels a re-scan differently from a first scan", async () => {
    await seed();
    const o = await activateFresh();
    o.renderLoading.mockClear();

    await o.cb.onRescan();
    await settle();

    expect(o.renderLoading).toHaveBeenCalledWith("Re-scanning this page…");
  });

  it("hands the matched results to the overlay", async () => {
    await seed({ answerBank: [{ id: "b1", label: "Email", answer: "a@b.com" }] });
    adapterRef.current = fakeAdapter({ fields: [emailField()] });

    const o = await activateFresh();

    const [results] = o.render.mock.calls[0];
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("matched");
    expect(results[0].entry.answer).toBe("a@b.com");
  });
});

describe("scan guard — a repeat click must not buy a second Stage 2 call", () => {
  // Stalls the first storage read so a scan is genuinely mid-flight.
  function stallStorage() {
    const realGet = chrome.storage.local.get;
    let release;
    const gate = new Promise((r) => (release = r));
    let stalled = false;
    chrome.storage.local.get = vi.fn(async (keys) => {
      if (!stalled) { stalled = true; await gate; }
      return realGet(keys);
    });
    return { release: () => { release(); chrome.storage.local.get = realGet; } };
  }

  it("ignores a second activation while the first scan is still running", async () => {
    await seed();
    const gate = stallStorage();

    overlays.length = 0;
    delete window.__APPLY_ASSISTANT__;
    vi.resetModules();
    await import(CONTENT_SCRIPT);
    await tick(); // first scan is now parked inside loadContext

    const o = overlays[0];
    expect(o.renderLoading).toHaveBeenCalledTimes(1);

    await window.__APPLY_ASSISTANT__.activate(); // the impatient second click
    expect(o.renderLoading).toHaveBeenCalledTimes(1); // still one — nothing re-ran

    gate.release();
    await settle();
    expect(o.render).toHaveBeenCalledTimes(1);
  });

  it("releases the guard after a scan finishes, so later scans still run", async () => {
    await seed();
    const o = await activateFresh();
    expect(o.render).toHaveBeenCalledTimes(1);

    await o.cb.onRescan();
    await settle();

    expect(o.render).toHaveBeenCalledTimes(2);
  });

  it("releases the guard even when the scan throws, so one blip can't wedge it", async () => {
    await seed();
    adapterRef.current = {
      detect: vi.fn(() => { throw new Error("detect exploded"); }),
      fill: vi.fn(),
    };
    const o = await activateFresh();
    expect(o.showError).toHaveBeenCalledWith(expect.stringMatching(/detect exploded/));

    // Recovering adapter — the next scan must be allowed to proceed.
    adapterRef.current = fakeAdapter({ fields: [emailField()] });
    await o.cb.onRescan();
    await settle();

    expect(o.render).toHaveBeenCalledTimes(2);
  });
});

describe("fill all — reports what actually happened", () => {
  const bank = [{ id: "b1", label: "Email", answer: "a@b.com" }];

  it("reports every field as filled when the adapter accepts them", async () => {
    await seed({ answerBank: bank });
    adapterRef.current = fakeAdapter({ fields: [emailField("f1")], fill: () => true });
    const o = await activateFresh();

    expect(await o.cb.onFillAll()).toEqual({ filled: ["f1"], failed: [] });
  });

  it("separates the fields the adapter refused from the ones it took", async () => {
    await seed({ answerBank: bank });
    adapterRef.current = fakeAdapter({
      fields: [emailField("f1"), emailField("f2")],
      fill: (f) => f.id !== "f2", // f2 rejects, e.g. no option matches
    });
    const o = await activateFresh();

    const outcome = await o.cb.onFillAll();
    expect(outcome.filled).toEqual(["f1"]);
    expect(outcome.failed).toEqual(["f2"]);
  });

  it("skips unmatched fields entirely rather than counting them either way", async () => {
    await seed({ answerBank: bank }); // no key → Stage 1 only, so "Why us?" can't match
    adapterRef.current = fakeAdapter({
      fields: [emailField("f1"), field("f2", "Why do you want to work here?")],
    });
    const o = await activateFresh();

    const outcome = await o.cb.onFillAll();
    expect(outcome.filled).toEqual(["f1"]);
    expect(outcome.failed).toEqual([]);
    expect(adapterRef.current.fill).toHaveBeenCalledTimes(1);
  });

  it("forwards the highlight setting to the adapter", async () => {
    await seed({ answerBank: bank, settings: { highlightFilled: false } });
    adapterRef.current = fakeAdapter({ fields: [emailField("f1")] });
    const o = await activateFresh();

    await o.cb.onFillAll();
    expect(adapterRef.current.fill).toHaveBeenCalledWith(
      expect.objectContaining({ id: "f1" }), "a@b.com", { highlight: false },
    );
  });
});

describe("per-field fill", () => {
  it("returns false for an id that was never matched, without touching the adapter", async () => {
    await seed();
    adapterRef.current = fakeAdapter({ fields: [field("f1", "Why?")] });
    const o = await activateFresh();

    expect(await o.cb.onFillField("f1")).toBe(false);
    expect(await o.cb.onFillField("does-not-exist")).toBe(false);
    expect(adapterRef.current.fill).not.toHaveBeenCalled();
  });
});

describe("empty answer bank", () => {
  it("flags the empty bank so the overlay can stop blaming the matcher", async () => {
    await seed({ answerBank: [] });
    adapterRef.current = fakeAdapter({ fields: [field("f1", "Why?")] });
    const o = await activateFresh();

    expect(o.render).toHaveBeenCalledWith(expect.anything(), { emptyBank: true });
  });

  it("does not flag it when the bank has entries", async () => {
    await seed({ answerBank: [{ id: "b1", label: "Email", answer: "a@b.com" }] });
    adapterRef.current = fakeAdapter({ fields: [emailField()] });
    const o = await activateFresh();

    expect(o.render).toHaveBeenCalledWith(expect.anything(), { emptyBank: false });
  });
});

describe("stale highlights", () => {
  it("clears highlights from a previous scan before rendering new results", async () => {
    await seed();
    const stale = document.createElement("input");
    stale.setAttribute(HIGHLIGHT_ATTR, "true");
    document.body.appendChild(stale);

    await activateFresh();

    expect(stale.hasAttribute(HIGHLIGHT_ATTR)).toBe(false);
  });
});

describe("API key handling", () => {
  it("runs Stage 1 only and says why when no key is set", async () => {
    await seed({ answerBank: [{ id: "b1", label: "Email", answer: "a@b.com" }] });
    adapterRef.current = fakeAdapter({
      fields: [emailField("f1"), field("f2", "Describe a hard problem you solved")],
    });

    const o = await activateFresh();

    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    expect(o.showError).toHaveBeenCalledWith(expect.stringMatching(/No API key set/));
    const [results] = o.render.mock.calls[0];
    expect(results.find((r) => r.field.id === "f1").status).toBe("matched");
    expect(results.find((r) => r.field.id === "f2").status).toBe("unmatched");
  });

  it("sends Stage 2 through the background worker when a key is set", async () => {
    await seed({
      answerBank: [{ id: "b1", label: "Sponsorship", answer: "No" }],
      settings: { apiKey: "sk-test", matchModel: "claude-haiku-4-5" },
    });
    adapterRef.current = fakeAdapter({ fields: [field("f1", "Will you require visa sponsorship?")] });
    chrome.runtime.sendMessage = vi.fn((msg, cb) =>
      cb({ ok: true, text: JSON.stringify({ matches: [{ question_id: "f1", bank_entry_id: "b1", confidence: 0.95 }] }) }),
    );

    const o = await activateFresh();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "AA_COMPLETE", model: "claude-haiku-4-5" }),
      expect.any(Function),
    );
    expect(o.showError).not.toHaveBeenCalled();
    const [results] = o.render.mock.calls[0];
    expect(results[0].status).toBe("matched");
  });
});

describe("error surfaces", () => {
  const withKey = {
    answerBank: [{ id: "b1", label: "Sponsorship", answer: "No" }],
    settings: { apiKey: "sk-test" },
  };
  const oneUnmatchedField = () => fakeAdapter({ fields: [field("f1", "Will you require sponsorship?")] });

  it("clears stale results and shows the message when a scan fails", async () => {
    await seed(withKey);
    adapterRef.current = oneUnmatchedField();
    chrome.runtime.sendMessage = vi.fn((msg, cb) => cb({ ok: false, error: "429 rate limited" }));

    const o = await activateFresh();

    expect(o.render).toHaveBeenCalledWith([]);
    expect(o.showError).toHaveBeenCalledWith(expect.stringMatching(/429 rate limited/));
  });

  it("points at the dashboard when the failure is a missing API key", async () => {
    await seed(withKey);
    adapterRef.current = oneUnmatchedField();
    chrome.runtime.sendMessage = vi.fn((msg, cb) => cb({ ok: false, error: "No API key set." }));

    const o = await activateFresh();

    expect(o.showError).toHaveBeenCalledWith(expect.stringMatching(/Open the Apply Assistant dashboard/));
  });

  it("surfaces a chrome.runtime.lastError from the background channel", async () => {
    await seed(withKey);
    adapterRef.current = oneUnmatchedField();
    chrome.runtime.sendMessage = vi.fn((msg, cb) => {
      chrome.runtime.lastError = { message: "Extension context invalidated." };
      cb(undefined);
      chrome.runtime.lastError = null;
    });

    const o = await activateFresh();

    expect(o.showError).toHaveBeenCalledWith(expect.stringMatching(/context invalidated/i));
  });

  it("surfaces a missing response as its own error rather than a crash", async () => {
    await seed(withKey);
    adapterRef.current = oneUnmatchedField();
    chrome.runtime.sendMessage = vi.fn((msg, cb) => cb(undefined));

    const o = await activateFresh();

    expect(o.showError).toHaveBeenCalledWith(expect.stringMatching(/No response from the background worker/));
  });
});

describe("re-injection", () => {
  it("reuses the existing controller instead of building a second one", async () => {
    await seed();
    await activateFresh();
    expect(overlays).toHaveLength(1);

    // Toolbar clicked again: Chrome re-runs the file against the same window.
    vi.resetModules();
    await import(CONTENT_SCRIPT);
    await settle();

    expect(overlays).toHaveLength(1); // no second Overlay was constructed
    expect(overlays[0].render).toHaveBeenCalledTimes(2); // but it did re-scan
  });
});
