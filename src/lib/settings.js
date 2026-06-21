// Central defaults and storage keys for Apply Assistant.
//
// Models: per the spec (§8, §11.5) use a cheap model for the batched semantic
// match and a stronger model for open-ended drafting. Both are user-configurable
// in the dashboard.
export const DEFAULT_SETTINGS = Object.freeze({
  apiKey: "",
  matchModel: "claude-haiku-4-5",
  draftModel: "claude-sonnet-4-6",
  // Stage-2 confidence cutoff: below this a guess is treated as "no match" so a
  // weak guess never fills a field wrong (§4 edge cases, §11.2).
  matchConfidenceThreshold: 0.6,
  // Visually highlight filled fields so the user can scan-review (§11.1).
  highlightFilled: true,
});

// chrome.storage.local keys.
export const STORAGE_KEYS = Object.freeze({
  resumeText: "resumeText",
  resumeFileName: "resumeFileName",
  blurb: "blurb",
  answerBank: "answerBank",
  settings: "settings",
  spendLog: "spendLog",
});

// Schema version for export/import payloads.
export const EXPORT_VERSION = 1;
