import { describe, it, expect, beforeEach } from "vitest";
import {
  getSettings,
  setSettings,
  getResume,
  setResume,
  getBlurb,
  setBlurb,
  getAnswerBank,
  setAnswerBank,
  exportAll,
  importAll,
  newId,
} from "../src/lib/storage.js";
import { DEFAULT_SETTINGS } from "../src/lib/settings.js";

beforeEach(async () => {
  await chrome.storage.local.clear();
});

describe("settings", () => {
  it("returns defaults when nothing is stored", async () => {
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("merges a patch over existing settings and persists", async () => {
    await setSettings({ apiKey: "sk-test", matchModel: "claude-haiku-4-5" });
    const s = await getSettings();
    expect(s.apiKey).toBe("sk-test");
    expect(s.draftModel).toBe(DEFAULT_SETTINGS.draftModel); // untouched default preserved
  });
});

describe("resume / blurb / answer bank", () => {
  it("round-trips resume text and filename", async () => {
    await setResume({ text: "resume body", fileName: "cv.pdf" });
    expect(await getResume()).toEqual({ text: "resume body", fileName: "cv.pdf" });
  });

  it("round-trips the blurb", async () => {
    await setBlurb("about me");
    expect(await getBlurb()).toBe("about me");
  });

  it("defaults the answer bank to an empty array", async () => {
    expect(await getAnswerBank()).toEqual([]);
  });

  it("round-trips answer bank entries", async () => {
    const entries = [{ id: newId(), label: "Email", answer: "a@b.com" }];
    await setAnswerBank(entries);
    expect(await getAnswerBank()).toEqual(entries);
  });
});

describe("newId", () => {
  it("generates unique ids", () => {
    const ids = new Set(Array.from({ length: 200 }, () => newId()));
    expect(ids.size).toBe(200);
  });
});

describe("export / import", () => {
  it("exports a versioned payload with all user data", async () => {
    await setResume({ text: "rt", fileName: "f.pdf" });
    await setBlurb("blurb");
    await setAnswerBank([{ id: "1", label: "Email", answer: "a@b.com" }]);
    await setSettings({ apiKey: "sk-xyz" });

    const payload = await exportAll();
    expect(payload.version).toBeGreaterThanOrEqual(1);
    expect(payload.data.resumeText).toBe("rt");
    expect(payload.data.blurb).toBe("blurb");
    expect(payload.data.answerBank).toEqual([{ id: "1", label: "Email", answer: "a@b.com" }]);
    expect(payload.data.settings.apiKey).toBe("sk-xyz");
  });

  it("restores a previously exported payload after a clear", async () => {
    await setResume({ text: "rt", fileName: "f.pdf" });
    await setBlurb("blurb");
    await setAnswerBank([{ id: "1", label: "Email", answer: "a@b.com" }]);
    await setSettings({ apiKey: "sk-xyz", matchConfidenceThreshold: 0.8 });
    const payload = await exportAll();

    await chrome.storage.local.clear();
    await importAll(payload);

    expect(await getResume()).toEqual({ text: "rt", fileName: "f.pdf" });
    expect(await getBlurb()).toBe("blurb");
    expect(await getAnswerBank()).toEqual([{ id: "1", label: "Email", answer: "a@b.com" }]);
    const s = await getSettings();
    expect(s.apiKey).toBe("sk-xyz");
    expect(s.matchConfidenceThreshold).toBe(0.8);
  });

  it("rejects a malformed import payload", async () => {
    await expect(importAll({ nope: true })).rejects.toThrow();
    await expect(importAll(null)).rejects.toThrow();
  });
});
