import { describe, it, expect } from "vitest";
import {
  detectFieldKind,
  detectBankKind,
  stage1Match,
  buildMatchPrompt,
  parseMatchResponse,
} from "../src/lib/matcher.js";

const field = (over = {}) => ({
  id: "f1",
  label: "",
  type: "text",
  autocomplete: "",
  name: "",
  ...over,
});

const bank = (over = {}) => ({ id: "b1", label: "", answer: "", ...over });

describe("detectFieldKind (Stage 1 standardized signals)", () => {
  it("detects email from input type", () => {
    expect(detectFieldKind(field({ type: "email" }))).toBe("email");
  });

  it("detects email from autocomplete token", () => {
    expect(detectFieldKind(field({ autocomplete: "email" }))).toBe("email");
  });

  it("detects tel from type or autocomplete", () => {
    expect(detectFieldKind(field({ type: "tel" }))).toBe("tel");
    expect(detectFieldKind(field({ autocomplete: "tel" }))).toBe("tel");
  });

  it("detects given-name and family-name from autocomplete", () => {
    expect(detectFieldKind(field({ autocomplete: "given-name" }))).toBe("given-name");
    expect(detectFieldKind(field({ autocomplete: "section-blue family-name" }))).toBe(
      "family-name",
    );
  });

  it("detects full-name from the exact 'name' token", () => {
    expect(detectFieldKind(field({ autocomplete: "name" }))).toBe("full-name");
  });

  it("disambiguates profile URLs by linkedin/github hints", () => {
    expect(detectFieldKind(field({ type: "url", name: "linkedinUrl" }))).toBe("url-linkedin");
    expect(detectFieldKind(field({ type: "url", label: "GitHub profile" }))).toBe("url-github");
    expect(detectFieldKind(field({ type: "url", label: "Portfolio" }))).toBe("url-generic");
  });

  it("returns null for non-standardized fields (belongs in Stage 2)", () => {
    expect(detectFieldKind(field({ type: "text", label: "Are you authorized to work in the US?" }))).toBeNull();
    expect(detectFieldKind(field({ type: "textarea", label: "Why do you want to work here?" }))).toBeNull();
  });
});

describe("detectBankKind", () => {
  it("maps common identity/contact labels to kinds", () => {
    expect(detectBankKind(bank({ label: "Email" }))).toBe("email");
    expect(detectBankKind(bank({ label: "Email Address" }))).toBe("email");
    expect(detectBankKind(bank({ label: "Phone" }))).toBe("tel");
    expect(detectBankKind(bank({ label: "Mobile number" }))).toBe("tel");
    expect(detectBankKind(bank({ label: "First name" }))).toBe("given-name");
    expect(detectBankKind(bank({ label: "Last Name" }))).toBe("family-name");
    expect(detectBankKind(bank({ label: "Full name" }))).toBe("full-name");
    expect(detectBankKind(bank({ label: "LinkedIn" }))).toBe("url-linkedin");
    expect(detectBankKind(bank({ label: "GitHub URL" }))).toBe("url-github");
    expect(detectBankKind(bank({ label: "Portfolio website" }))).toBe("url-generic");
  });

  it("returns null for varied-wording questions (Stage 2 territory)", () => {
    expect(detectBankKind(bank({ label: "Require sponsorship?" }))).toBeNull();
    expect(detectBankKind(bank({ label: "How did you hear about us?" }))).toBeNull();
  });
});

describe("stage1Match", () => {
  it("matches standardized fields to bank entries with zero API calls", () => {
    const fields = [
      field({ id: "f-email", type: "email" }),
      field({ id: "f-first", autocomplete: "given-name" }),
      field({ id: "f-work", label: "Authorized to work in US?" }),
    ];
    const entries = [
      bank({ id: "b-email", label: "Email" }),
      bank({ id: "b-first", label: "First name" }),
      bank({ id: "b-auth", label: "Work authorization" }),
    ];
    const { matches, unmatchedFieldIds } = stage1Match(fields, entries);
    expect(matches).toEqual([
      { fieldId: "f-email", entryId: "b-email", kind: "email", source: "stage1" },
      { fieldId: "f-first", entryId: "b-first", kind: "given-name", source: "stage1" },
    ]);
    // The work-auth field is standardized-signal-free → goes to Stage 2.
    expect(unmatchedFieldIds).toEqual(["f-work"]);
  });

  it("fills all of multiple page fields that share one bank entry", () => {
    const fields = [
      field({ id: "f-email1", type: "email" }),
      field({ id: "f-email2", type: "email" }),
    ];
    const entries = [bank({ id: "b-email", label: "Email" })];
    const { matches } = stage1Match(fields, entries);
    expect(matches.map((m) => m.fieldId)).toEqual(["f-email1", "f-email2"]);
    expect(matches.every((m) => m.entryId === "b-email")).toBe(true);
  });

  it("leaves a standardized field unmatched when no bank entry has that kind", () => {
    const fields = [field({ id: "f-email", type: "email" })];
    const entries = [bank({ id: "b-first", label: "First name" })];
    const { matches, unmatchedFieldIds } = stage1Match(fields, entries);
    expect(matches).toEqual([]);
    expect(unmatchedFieldIds).toEqual(["f-email"]);
  });
});

describe("buildMatchPrompt", () => {
  it("includes every question label and bank entry, and asks for JSON", () => {
    const prompt = buildMatchPrompt({
      questions: [{ id: "q1", label: "Do you require visa sponsorship?" }],
      answerBank: [{ id: "b1", label: "Require sponsorship?", answer: "No" }],
    });
    expect(prompt.system).toMatch(/json/i);
    expect(prompt.user).toContain("Do you require visa sponsorship?");
    expect(prompt.user).toContain("Require sponsorship?");
    expect(prompt.user).toContain("q1");
    expect(prompt.user).toContain("b1");
  });
});

describe("parseMatchResponse", () => {
  it("parses a clean mapping and drops null/low-confidence matches", () => {
    const text = JSON.stringify({
      matches: [
        { question_id: "q1", bank_entry_id: "b1", confidence: 0.95 },
        { question_id: "q2", bank_entry_id: "b2", confidence: 0.4 },
        { question_id: "q3", bank_entry_id: null, confidence: 0.0 },
      ],
    });
    const result = parseMatchResponse(text, { threshold: 0.6 });
    expect(result).toEqual([{ fieldId: "q1", entryId: "b1", confidence: 0.95 }]);
  });

  it("strips markdown code fences before parsing", () => {
    const text = "```json\n" + JSON.stringify({ matches: [{ question_id: "q1", bank_entry_id: "b1", confidence: 1 }] }) + "\n```";
    const result = parseMatchResponse(text, { threshold: 0.6 });
    expect(result).toEqual([{ fieldId: "q1", entryId: "b1", confidence: 1 }]);
  });

  it("throws on unparseable output", () => {
    expect(() => parseMatchResponse("not json at all", { threshold: 0.6 })).toThrow();
  });
});
