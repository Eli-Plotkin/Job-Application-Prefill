import { describe, it, expect, beforeEach } from "vitest";
import {
  getSettings,
  setSettings,
  getResume,
  setResume,
  getBlurb,
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

describe("settings isolation & merging", () => {
  it("returns a fresh object each call (mutation can't corrupt defaults)", async () => {
    const a = await getSettings();
    a.apiKey = "leaked";
    const b = await getSettings();
    expect(b.apiKey).toBe("");
    expect(DEFAULT_SETTINGS.apiKey).toBe("");
  });

  it("merges successive partial patches", async () => {
    await setSettings({ apiKey: "k1" });
    await setSettings({ matchModel: "m" });
    const s = await getSettings();
    expect(s.apiKey).toBe("k1");
    expect(s.matchModel).toBe("m");
    expect(s.draftModel).toBe(DEFAULT_SETTINGS.draftModel);
  });
});

describe("resume / blurb / answer bank defaults & coercion", () => {
  it("defaults a partially-stored resume's filename to empty", async () => {
    await chrome.storage.local.set({ resumeText: "body only" });
    expect(await getResume()).toEqual({ text: "body only", fileName: "" });
  });

  it("coerces missing resume fields to empty strings", async () => {
    await setResume({});
    expect(await getResume()).toEqual({ text: "", fileName: "" });
  });

  it("defaults blurb to empty and answer bank to []", async () => {
    expect(await getBlurb()).toBe("");
    expect(await getAnswerBank()).toEqual([]);
  });

  it("coerces a null answer bank to []", async () => {
    await setAnswerBank(null);
    expect(await getAnswerBank()).toEqual([]);
  });
});

describe("export", () => {
  it("exports defaults and empty collections on a fresh profile", async () => {
    const p = await exportAll();
    expect(p.version).toBeGreaterThanOrEqual(1);
    expect(p.data.resumeText).toBe("");
    expect(p.data.answerBank).toEqual([]);
    expect(p.data.settings).toEqual(DEFAULT_SETTINGS);
  });

  it("merges stored partial settings with defaults in the export", async () => {
    await chrome.storage.local.set({ settings: { apiKey: "only-key" } });
    const p = await exportAll();
    expect(p.data.settings.apiKey).toBe("only-key");
    expect(p.data.settings.matchModel).toBe(DEFAULT_SETTINGS.matchModel);
  });
});

describe("import — partial, malformed, and coercion", () => {
  it("only writes the keys present in the payload, leaving others intact", async () => {
    await setSettings({ apiKey: "keep-me" });
    await importAll({ data: { blurb: "new blurb" } });
    expect(await getBlurb()).toBe("new blurb");
    expect((await getSettings()).apiKey).toBe("keep-me");
  });

  it("coerces a non-array answerBank to []", async () => {
    await importAll({ data: { answerBank: "oops" } });
    expect(await getAnswerBank()).toEqual([]);
  });

  it("merges imported partial settings with defaults", async () => {
    await importAll({ data: { settings: { matchConfidenceThreshold: 0.9 } } });
    const s = await getSettings();
    expect(s.matchConfidenceThreshold).toBe(0.9);
    expect(s.matchModel).toBe(DEFAULT_SETTINGS.matchModel);
  });

  it("rejects malformed payloads", async () => {
    await expect(importAll(null)).rejects.toThrow();
    await expect(importAll({})).rejects.toThrow();
    await expect(importAll({ data: null })).rejects.toThrow();
    await expect(importAll("nope")).rejects.toThrow();
  });

  it("is a no-op (no throw) for a payload whose data has no recognized keys", async () => {
    await setBlurbDirect("preexisting");
    await importAll({ data: { unrelated: 1 } });
    expect(await getBlurb()).toBe("preexisting");
  });
});

async function setBlurbDirect(v) {
  await chrome.storage.local.set({ blurb: v });
}

describe("newId", () => {
  it("produces unique, prefixed ids", () => {
    const ids = Array.from({ length: 500 }, () => newId());
    expect(new Set(ids).size).toBe(500);
    expect(ids.every((id) => id.startsWith("id-"))).toBe(true);
  });
});
