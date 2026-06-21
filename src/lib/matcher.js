// Matching engine (§4).
//
// Stage 1 — deterministic, free, instant. Restricted to genuinely standardized
// identity/contact signals (autocomplete tokens + input types). Anything squishy
// is intentionally left to Stage 2.
//
// Stage 2 — a single batched LLM call maps the remaining varied-wording questions
// to answer-bank entries. This module builds the prompt and parses the response;
// the actual network call lives in the background worker.

const STANDARD_KINDS = [
  "given-name",
  "family-name",
  "full-name",
  "email",
  "tel",
  "url-linkedin",
  "url-github",
  "url-generic",
];

function autocompleteTokens(field) {
  return String(field.autocomplete || "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function urlKindFromHints(field) {
  const hint = `${field.name || ""} ${field.label || ""} ${field.autocomplete || ""}`.toLowerCase();
  if (hint.includes("linkedin")) return "url-linkedin";
  if (hint.includes("github")) return "url-github";
  return "url-generic";
}

// Classify a detected page field using only reliable, standardized signals.
// Returns one of STANDARD_KINDS, or null if it isn't a standardized field.
export function detectFieldKind(field) {
  const type = String(field.type || "").toLowerCase();
  const tokens = autocompleteTokens(field);

  if (type === "email" || tokens.includes("email")) return "email";
  // The autocomplete spec uses "tel" plus granular variants (tel-national,
  // tel-country-code, …) — treat any tel* token as a phone field.
  if (type === "tel" || tokens.some((t) => t === "tel" || t.startsWith("tel-"))) return "tel";
  if (tokens.includes("given-name")) return "given-name";
  if (tokens.includes("family-name")) return "family-name";
  if (tokens.includes("name")) return "full-name";

  if (type === "url" || tokens.includes("url")) return urlKindFromHints(field);

  return null;
}

// Classify an answer-bank entry by its label. Only the standardized identity/
// contact kinds are recognized here — varied-wording entries return null and are
// matched by Stage 2.
export function detectBankKind(entry) {
  const label = String(entry.label || "").toLowerCase().trim();
  if (!label) return null;

  if (label.includes("linkedin")) return "url-linkedin";
  if (label.includes("github")) return "url-github";

  if (/\be-?mail\b/.test(label)) return "email";
  if (/\b(phone|mobile|tel|cell)\b/.test(label)) return "tel";

  if (/\b(first name|given name|firstname)\b/.test(label)) return "given-name";
  if (/\b(last name|family name|surname|lastname)\b/.test(label)) return "family-name";
  if (label === "name" || /\b(full name|fullname|full legal name|legal name)\b/.test(label))
    return "full-name";

  if (/\b(website|web site|portfolio|personal site|personal website)\b/.test(label) || label === "url")
    return "url-generic";

  return null;
}

// Stage 1: match standardized page fields to standardized bank entries.
// Returns { matches, unmatchedFieldIds }. Every field Stage 1 does not fill is
// reported as unmatched so the caller can hand it to Stage 2.
export function stage1Match(fields, bankEntries) {
  const entriesByKind = new Map();
  for (const entry of bankEntries) {
    const kind = detectBankKind(entry);
    if (kind && !entriesByKind.has(kind)) entriesByKind.set(kind, entry);
  }

  const matches = [];
  const unmatchedFieldIds = [];
  for (const field of fields) {
    const kind = detectFieldKind(field);
    const entry = kind ? entriesByKind.get(kind) : undefined;
    if (entry) {
      matches.push({ fieldId: field.id, entryId: entry.id, kind, source: "stage1" });
    } else {
      unmatchedFieldIds.push(field.id);
    }
  }
  return { matches, unmatchedFieldIds };
}

const MATCH_SYSTEM_PROMPT = `You map job-application form questions to entries in a user's saved answer bank.

You are given a list of QUESTIONS (each with an id and the visible label shown on the form) and a list of ANSWER BANK entries (each with an id, a label, and the saved answer).

For each question, decide which single answer-bank entry best answers it, or none if no entry is a good fit. Questions are phrased differently at every company, so match on meaning, not wording: e.g. "Are you legally authorized to work in the United States?" matches a "Work authorization" entry; "Do you now or in the future require sponsorship?" matches a "Require sponsorship?" entry.

Only map a question when you are confident the entry genuinely answers it. When in doubt, return null — a wrong fill is worse than a blank field. Never map two unrelated concepts together (e.g. do not map a salary question to a relocation entry).

DROPDOWN QUESTIONS: Some questions include [options: ...] listing the available choices. A match requires BOTH conditions:
  1. The question is semantically similar to the bank entry's label/answer concept.
  2. One of the available options accurately represents the user's stored answer — not merely the closest available choice, but a genuine fit. Ask yourself: "Would selecting this option misrepresent the user?" If yes, return bank_entry_id: null even if condition 1 was met. Choosing a least-wrong option is worse than leaving the field blank.
When both conditions are met, set "selected_option" to the exact verbatim option text.

For non-dropdown questions, omit "selected_option" or set it to null.

Respond with ONLY a JSON object, no prose, in exactly this shape:
{"matches": [{"question_id": "<id>", "bank_entry_id": "<id or null>", "confidence": <number 0..1>, "selected_option": "<exact option text or null>"}]}
Include one object for every question. confidence is your calibrated certainty that the mapping is correct.`;

// Build the Stage-2 request payload. Returns { system, user } strings; the
// background worker wraps these into a Messages API call.
//
// KEEP IN SYNC with evals/matcher/prompt.js — that eval validates this exact prompt.
export function buildMatchPrompt({ questions, answerBank }) {
  const questionLines = questions
    .map((q) => {
      const opts =
        q.options && q.options.length
          ? ` [options: ${q.options.map((o) => JSON.stringify(o)).join(", ")}]`
          : "";
      return `- id=${q.id}: ${JSON.stringify(q.label)}${opts}`;
    })
    .join("\n");
  const bankLines = answerBank
    .map((b) => `- id=${b.id}: label=${JSON.stringify(b.label)} answer=${JSON.stringify(b.answer)}`)
    .join("\n");

  const user = `QUESTIONS:\n${questionLines}\n\nANSWER BANK:\n${bankLines}\n\nReturn the JSON mapping now.`;
  return { system: MATCH_SYSTEM_PROMPT, user };
}

// Extract the first balanced top-level JSON object from a model response,
// tolerating markdown fences and surrounding prose. String-aware so braces that
// appear inside string values (e.g. "q{1}") don't throw off the brace counter.
function extractJsonObject(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  const start = candidate.indexOf("{");
  if (start === -1) throw new Error("No JSON object found in matcher response");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return candidate.slice(start, i + 1);
    }
  }
  throw new Error("Unterminated JSON object in matcher response");
}

// Parse the Stage-2 response into [{fieldId, entryId, confidence}], dropping
// null mappings and any below the confidence threshold.
export function parseMatchResponse(text, { threshold }) {
  const parsed = JSON.parse(extractJsonObject(String(text)));
  const matches = Array.isArray(parsed.matches) ? parsed.matches : [];
  const out = [];
  for (const m of matches) {
    if (m == null) continue;
    const entryId = m.bank_entry_id;
    const confidence = typeof m.confidence === "number" ? m.confidence : 0;
    if (entryId != null && entryId !== "none" && confidence >= threshold) {
      const selectedOption = m.selected_option != null && m.selected_option !== "null" ? m.selected_option : null;
      out.push({ fieldId: m.question_id, entryId, confidence, selectedOption });
    }
  }
  return out;
}

const MATCH_V2_SYSTEM_PROMPT = `You map a single job-application form question to the best entry in a user's saved answer bank.

You are given ONE QUESTION (with an id and the visible label shown on the form) and a list of ANSWER BANK entries (each with an id, a label, and the saved answer).

Decide which single answer-bank entry best answers the question, or none if no entry is a good fit. Match on meaning, not wording: e.g. "Are you legally authorized to work in the United States?" matches a "Work authorization" entry; "Do you now or in the future require sponsorship?" matches a "Require sponsorship?" entry.

Only return a match when you are confident the entry genuinely answers this specific question. When in doubt, return null — a wrong fill is worse than a blank field.

DROPDOWN QUESTIONS: If the question includes [options: ...] listing the available choices, a match requires BOTH conditions:
  1. The question is semantically similar to the bank entry's label/answer concept.
  2. One of the available options accurately represents the user's stored answer — not merely the closest available choice, but a genuine fit. Ask yourself: "Would selecting this option misrepresent the user?" If yes, return bank_entry_id: null even if condition 1 was met. Choosing a least-wrong option is worse than leaving the field blank.
When both conditions are met, set "selected_option" to the exact verbatim option text.

For non-dropdown questions, omit "selected_option" or set it to null.

Respond with ONLY a JSON object, no prose, in exactly this shape:
{"bank_entry_id": "<id or null>", "confidence": <number 0..1>, "selected_option": "<exact option text or null>"}
confidence is your calibrated certainty that the mapping is correct.`;

// Build a Stage-2 v2 request payload for a single question.
// Returns { system, user } strings.
export function buildMatchPromptV2({ question, answerBank }) {
  const bankLines = answerBank
    .map((b) => `- id=${b.id}: label=${JSON.stringify(b.label)} answer=${JSON.stringify(b.answer)}`)
    .join("\n");

  const opts =
    question.options && question.options.length
      ? ` [options: ${question.options.map((o) => JSON.stringify(o)).join(", ")}]`
      : "";
  const user = `QUESTION:\n- id=${question.id}: ${JSON.stringify(question.label)}${opts}\n\nANSWER BANK:\n${bankLines}\n\nReturn the JSON mapping now.`;
  return { system: MATCH_V2_SYSTEM_PROMPT, user };
}

// Parse a single-question Stage-2 v2 response into {fieldId, entryId, confidence}
// or null if no match / below threshold.
export function parseMatchResponseV2(text, { fieldId, threshold }) {
  const parsed = JSON.parse(extractJsonObject(String(text)));
  const entryId = parsed.bank_entry_id;
  const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0;
  if (entryId == null || entryId === "null" || entryId === "none" || confidence < threshold) {
    return null;
  }
  const selectedOption = parsed.selected_option != null && parsed.selected_option !== "null" ? parsed.selected_option : null;
  return { fieldId, entryId, confidence, selectedOption };
}

export { STANDARD_KINDS };
