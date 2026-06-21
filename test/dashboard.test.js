// Drives the real dashboard.js against the real dashboard.html markup, with the
// in-memory chrome.storage stub. Verifies render-from-storage and the answer-bank
// + settings interactions that live only in the dashboard layer.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  setSettings,
  getSettings,
  setBlurb,
  setAnswerBank,
  getAnswerBank,
} from "../src/lib/storage.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(__dirname, "../src/dashboard/dashboard.html"), "utf8");
// Body markup minus the <script> tags (we import dashboard.js ourselves).
const BODY = HTML.split("<body>")[1].split("</body>")[0].replace(/<script[\s\S]*?<\/script>/g, "");

const flush = () => new Promise((r) => setTimeout(r));
const $ = (id) => document.getElementById(id);

async function loadDashboard() {
  vi.resetModules();
  document.body.innerHTML = BODY;
  await import("../src/dashboard/dashboard.js");
  await flush();
}

beforeEach(async () => {
  await chrome.storage.local.clear();
  // jsdom lacks these; the export path touches them.
  globalThis.URL.createObjectURL = vi.fn(() => "blob:x");
  globalThis.URL.revokeObjectURL = vi.fn();
});

describe("dashboard — render from storage", () => {
  it("populates inputs and answer rows from stored data", async () => {
    await setSettings({ apiKey: "sk-123", matchModel: "mm", draftModel: "dm", matchConfidenceThreshold: 0.7, highlightFilled: false });
    await setBlurb("hello blurb");
    await setAnswerBank([
      { id: "1", label: "Email", answer: "a@b.com" },
      { id: "2", label: "Phone", answer: "555" },
    ]);

    await loadDashboard();

    expect($("api-key").value).toBe("sk-123");
    expect($("match-model").value).toBe("mm");
    expect($("draft-model").value).toBe("dm");
    expect($("threshold").value).toBe("0.7");
    expect($("highlight").checked).toBe(false);
    expect($("blurb").value).toBe("hello blurb");
    expect($("answer-list").querySelectorAll(".answer-row")).toHaveLength(2);
    expect($("answer-empty").hidden).toBe(true);
  });

  it("shows the empty-state message when there are no answers", async () => {
    await loadDashboard();
    expect($("answer-list").querySelectorAll(".answer-row")).toHaveLength(0);
    expect($("answer-empty").hidden).toBe(false);
  });
});

describe("dashboard — answer bank interactions", () => {
  it("adds a blank answer row and persists it", async () => {
    await loadDashboard();
    $("answer-add").click();
    await flush();
    expect($("answer-list").querySelectorAll(".answer-row")).toHaveLength(1);
    expect(await getAnswerBank()).toHaveLength(1);
  });

  it("seeds the starter examples and persists them", async () => {
    await loadDashboard();
    $("answer-seed").click();
    await flush();
    const stored = await getAnswerBank();
    expect(stored.length).toBeGreaterThanOrEqual(8);
    expect(stored.some((e) => /sponsorship/i.test(e.label))).toBe(true);
    expect($("answer-empty").hidden).toBe(true);
  });

  it("edits a row's label/answer and persists the change", async () => {
    await setAnswerBank([{ id: "1", label: "Email", answer: "a@b.com" }]);
    await loadDashboard();
    const [labelInput, answerInput] = $("answer-list").querySelectorAll(".answer-row input");
    labelInput.value = "Work email";
    labelInput.dispatchEvent(new Event("input"));
    answerInput.value = "me@work.com";
    answerInput.dispatchEvent(new Event("input"));
    await flush();
    await new Promise((r) => setTimeout(r, 450)); // debounced persist (400ms)
    const stored = await getAnswerBank();
    expect(stored[0]).toEqual({ id: "1", label: "Work email", answer: "me@work.com" });
  });

  it("deletes a row and persists the removal", async () => {
    await setAnswerBank([
      { id: "1", label: "Email", answer: "a@b.com" },
      { id: "2", label: "Phone", answer: "555" },
    ]);
    await loadDashboard();
    $("answer-list").querySelector(".answer-row .del").click();
    await flush();
    const stored = await getAnswerBank();
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe("2");
  });
});

describe("dashboard — settings clamping", () => {
  it("clamps an out-of-range threshold and falls back to 0.6 on garbage", async () => {
    vi.useFakeTimers();
    try {
      document.body.innerHTML = BODY;
      vi.resetModules();
      await import("../src/dashboard/dashboard.js");
      await vi.advanceTimersByTimeAsync(0);

      $("threshold").value = "1.5";
      $("threshold").dispatchEvent(new Event("input"));
      await vi.advanceTimersByTimeAsync(500);
      expect((await getSettings()).matchConfidenceThreshold).toBe(1);

      $("threshold").value = "-0.5";
      $("threshold").dispatchEvent(new Event("input"));
      await vi.advanceTimersByTimeAsync(500);
      expect((await getSettings()).matchConfidenceThreshold).toBe(0);

      $("threshold").value = "";
      $("threshold").dispatchEvent(new Event("input"));
      await vi.advanceTimersByTimeAsync(500);
      expect((await getSettings()).matchConfidenceThreshold).toBe(0.6);
    } finally {
      vi.useRealTimers();
    }
  });

  it("trims and persists the API key on input", async () => {
    await loadDashboard();
    $("api-key").value = "  sk-trimmed  ";
    $("api-key").dispatchEvent(new Event("input"));
    await new Promise((r) => setTimeout(r, 450));
    expect((await getSettings()).apiKey).toBe("sk-trimmed");
  });
});

describe("dashboard — export", () => {
  it("builds a downloadable JSON blob", async () => {
    // jsdom can't navigate; stub the download anchor's click.
    const clickStub = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await setBlurb("x");
    await loadDashboard();
    $("export").click();
    await flush();
    clickStub.mockRestore();
    expect(globalThis.URL.createObjectURL).toHaveBeenCalled();
    const blob = globalThis.URL.createObjectURL.mock.calls[0][0];
    expect(blob).toBeInstanceOf(Blob);
  });
});
