// Thin wrapper over chrome.storage.local (§6, §10). All user data lives locally;
// nothing is synced. Export/import is the v1 backup + device-transfer mechanism.
import { DEFAULT_SETTINGS, STORAGE_KEYS, EXPORT_VERSION } from "./settings.js";

export async function getSettings() {
  const got = await chrome.storage.local.get(STORAGE_KEYS.settings);
  return { ...DEFAULT_SETTINGS, ...(got[STORAGE_KEYS.settings] || {}) };
}

export async function setSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ [STORAGE_KEYS.settings]: next });
  return next;
}

export async function getResume() {
  const got = await chrome.storage.local.get([
    STORAGE_KEYS.resumeText,
    STORAGE_KEYS.resumeFileName,
  ]);
  return {
    text: got[STORAGE_KEYS.resumeText] || "",
    fileName: got[STORAGE_KEYS.resumeFileName] || "",
  };
}

export async function setResume({ text, fileName }) {
  await chrome.storage.local.set({
    [STORAGE_KEYS.resumeText]: text || "",
    [STORAGE_KEYS.resumeFileName]: fileName || "",
  });
}

export async function getBlurb() {
  const got = await chrome.storage.local.get(STORAGE_KEYS.blurb);
  return got[STORAGE_KEYS.blurb] || "";
}

export async function setBlurb(blurb) {
  await chrome.storage.local.set({ [STORAGE_KEYS.blurb]: blurb || "" });
}

export async function getAnswerBank() {
  const got = await chrome.storage.local.get(STORAGE_KEYS.answerBank);
  return got[STORAGE_KEYS.answerBank] || [];
}

export async function setAnswerBank(entries) {
  await chrome.storage.local.set({ [STORAGE_KEYS.answerBank]: entries || [] });
}

// Stable-ish unique id for answer-bank rows and similar.
export function newId() {
  return (
    "id-" +
    Date.now().toString(36) +
    "-" +
    Math.random().toString(36).slice(2, 10)
  );
}

// Bundle all user data into a versioned, JSON-serializable payload.
export async function exportAll() {
  const all = await chrome.storage.local.get(null);
  return {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      resumeText: all[STORAGE_KEYS.resumeText] || "",
      resumeFileName: all[STORAGE_KEYS.resumeFileName] || "",
      blurb: all[STORAGE_KEYS.blurb] || "",
      answerBank: all[STORAGE_KEYS.answerBank] || [],
      settings: { ...DEFAULT_SETTINGS, ...(all[STORAGE_KEYS.settings] || {}) },
    },
  };
}

// Restore from an exportAll() payload. Throws on a structurally invalid file.
export async function importAll(payload) {
  if (!payload || typeof payload !== "object" || !payload.data || typeof payload.data !== "object") {
    throw new Error("Invalid import file: missing data");
  }
  const d = payload.data;
  const toSet = {};
  if ("resumeText" in d) toSet[STORAGE_KEYS.resumeText] = d.resumeText || "";
  if ("resumeFileName" in d) toSet[STORAGE_KEYS.resumeFileName] = d.resumeFileName || "";
  if ("blurb" in d) toSet[STORAGE_KEYS.blurb] = d.blurb || "";
  if ("answerBank" in d) toSet[STORAGE_KEYS.answerBank] = Array.isArray(d.answerBank) ? d.answerBank : [];
  if ("settings" in d) toSet[STORAGE_KEYS.settings] = { ...DEFAULT_SETTINGS, ...(d.settings || {}) };
  await chrome.storage.local.set(toSet);
}
