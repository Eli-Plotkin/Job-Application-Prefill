import { describe, it, expect } from "vitest";
import {
  detectFieldKind,
  detectBankKind,
  stage1Match,
  buildMatchPrompt,
  parseMatchResponse,
} from "../src/lib/matcher.js";

const field = (over = {}) => ({ id: "f", label: "", type: "text", autocomplete: "", name: "", ...over });
const bank = (over = {}) => ({ id: "b", label: "", answer: "", ...over });

describe("detectFieldKind — edge cases", () => {
  it("is case-insensitive on type and autocomplete", () => {
    expect(detectFieldKind(field({ type: "EMAIL" }))).toBe("email");
    expect(detectFieldKind(field({ autocomplete: "GIVEN-NAME" }))).toBe("given-name");
    expect(detectFieldKind(field({ autocomplete: "Family-Name" }))).toBe("family-name");
  });

  it("handles multi-token autocomplete with section/scope modifiers", () => {
    expect(detectFieldKind(field({ autocomplete: "section-blue shipping given-name" }))).toBe("given-name");
    expect(detectFieldKind(field({ autocomplete: "billing email" }))).toBe("email");
  });

  it("treats all tel* autocomplete variants as phone", () => {
    for (const ac of ["tel", "tel-national", "tel-country-code", "tel-area-code", "tel-local"]) {
      expect(detectFieldKind(field({ autocomplete: ac }))).toBe("tel");
    }
  });

  it("does not mistake username/nickname/cc-name for a name field", () => {
    expect(detectFieldKind(field({ autocomplete: "username" }))).toBeNull();
    expect(detectFieldKind(field({ autocomplete: "nickname" }))).toBeNull();
    expect(detectFieldKind(field({ autocomplete: "cc-name" }))).toBeNull();
  });

  it("prefers email when type=email even if autocomplete says tel", () => {
    expect(detectFieldKind(field({ type: "email", autocomplete: "tel" }))).toBe("email");
  });

  it("disambiguates url fields, with linkedin winning over github when both present", () => {
    expect(detectFieldKind(field({ type: "url", name: "linkedin_github" }))).toBe("url-linkedin");
    expect(detectFieldKind(field({ type: "url", label: "GitHub repo" }))).toBe("url-github");
    expect(detectFieldKind(field({ autocomplete: "url" }))).toBe("url-generic");
  });

  it("returns null for empty or whitespace-only signals", () => {
    expect(detectFieldKind(field())).toBeNull();
    expect(detectFieldKind(field({ autocomplete: "   " }))).toBeNull();
    expect(detectFieldKind({})).toBeNull();
  });
});

describe("detectBankKind — edge cases", () => {
  it("matches assorted real-world identity/contact labels", () => {
    const cases = {
      "E-mail": "email",
      "EMAIL ADDRESS": "email",
      "Cell phone": "tel",
      "Mobile Number": "tel",
      "Given Name": "given-name",
      Surname: "family-name",
      "Family Name": "family-name",
      "Full Legal Name": "full-name",
      "Legal Name": "full-name",
      Name: "full-name",
      "LinkedIn Profile URL": "url-linkedin",
      GitHub: "url-github",
      Website: "url-generic",
      "Personal website": "url-generic",
      Portfolio: "url-generic",
    };
    for (const [label, kind] of Object.entries(cases)) {
      expect(detectBankKind(bank({ label })), label).toBe(kind);
    }
  });

  it("does NOT false-match name-like-but-different labels", () => {
    for (const label of ["Company name", "Username", "User name", "Project name", "Nickname"]) {
      expect(detectBankKind(bank({ label })), label).toBeNull();
    }
  });

  it("returns null for varied-wording questions and empty labels", () => {
    expect(detectBankKind(bank({ label: "How did you hear about us?" }))).toBeNull();
    expect(detectBankKind(bank({ label: "Salary expectations" }))).toBeNull();
    expect(detectBankKind(bank({ label: "" }))).toBeNull();
    expect(detectBankKind(bank({ label: "   " }))).toBeNull();
  });
});

describe("stage1Match — edge cases", () => {
  it("uses the first bank entry of a kind when duplicates exist", () => {
    const fields = [field({ id: "f1", type: "email" })];
    const entries = [bank({ id: "b1", label: "Email" }), bank({ id: "b2", label: "Email address" })];
    expect(stage1Match(fields, entries).matches[0].entryId).toBe("b1");
  });

  it("preserves field order in unmatchedFieldIds", () => {
    const fields = [field({ id: "a" }), field({ id: "b" }), field({ id: "c" })];
    expect(stage1Match(fields, []).unmatchedFieldIds).toEqual(["a", "b", "c"]);
  });

  it("handles empty fields and empty bank without error", () => {
    expect(stage1Match([], [])).toEqual({ matches: [], unmatchedFieldIds: [] });
    expect(stage1Match([field({ id: "x", type: "email" })], [])).toEqual({
      matches: [],
      unmatchedFieldIds: ["x"],
    });
  });
});

describe("buildMatchPrompt — edge cases", () => {
  it("escapes quotes and newlines in labels so the format stays intact", () => {
    const p = buildMatchPrompt({
      questions: [{ id: "q1", label: 'Do you "require" \n sponsorship?' }],
      answerBank: [{ id: "b1", label: "Sponsorship", answer: 'No "really"' }],
    });
    expect(p.user).toContain('\\"require\\"');
    expect(p.user).not.toMatch(/\n\s*sponsorship\?":/); // raw newline didn't break a line
    expect(p.user).toContain("q1");
    expect(p.user).toContain("b1");
  });

  it("does not crash on empty questions or bank", () => {
    const p = buildMatchPrompt({ questions: [], answerBank: [] });
    expect(typeof p.system).toBe("string");
    expect(typeof p.user).toBe("string");
  });
});

describe("parseMatchResponse — edge cases", () => {
  const J = (matches) => JSON.stringify({ matches });

  it("includes a match whose confidence exactly equals the threshold", () => {
    const r = parseMatchResponse(J([{ question_id: "q1", bank_entry_id: "b1", confidence: 0.6 }]), { threshold: 0.6 });
    expect(r).toEqual([{ fieldId: "q1", entryId: "b1", confidence: 0.6, selectedOption: null }]);
  });

  it('drops the string "none" and null entry ids', () => {
    const r = parseMatchResponse(
      J([
        { question_id: "q1", bank_entry_id: "none", confidence: 1 },
        { question_id: "q2", bank_entry_id: null, confidence: 1 },
      ]),
      { threshold: 0.5 },
    );
    expect(r).toEqual([]);
  });

  it("treats a missing/non-numeric confidence as 0", () => {
    const r = parseMatchResponse(J([{ question_id: "q1", bank_entry_id: "b1" }]), { threshold: 0.1 });
    expect(r).toEqual([]);
    const r0 = parseMatchResponse(J([{ question_id: "q1", bank_entry_id: "b1" }]), { threshold: 0 });
    expect(r0).toEqual([{ fieldId: "q1", entryId: "b1", confidence: 0, selectedOption: null }]);
  });

  it("parses correctly even when a string value contains braces", () => {
    const text = '{"matches":[{"question_id":"q{1}","bank_entry_id":"b}1{","confidence":0.9}]}';
    expect(parseMatchResponse(text, { threshold: 0.5 })).toEqual([
      { fieldId: "q{1}", entryId: "b}1{", confidence: 0.9, selectedOption: null },
    ]);
  });

  it("tolerates surrounding prose and code fences and whitespace", () => {
    const inner = J([{ question_id: "q1", bank_entry_id: "b1", confidence: 1 }]);
    expect(parseMatchResponse(`Sure! Here:\n${inner}\nDone.`, { threshold: 0.5 })).toHaveLength(1);
    expect(parseMatchResponse("```json\n" + inner + "\n```", { threshold: 0.5 })).toHaveLength(1);
    expect(parseMatchResponse("\n\n  " + inner + "  \n", { threshold: 0.5 })).toHaveLength(1);
  });

  it("returns [] when matches is missing, null, or not an array", () => {
    expect(parseMatchResponse("{}", { threshold: 0.5 })).toEqual([]);
    expect(parseMatchResponse('{"matches":null}', { threshold: 0.5 })).toEqual([]);
    expect(parseMatchResponse('{"matches":{"a":1}}', { threshold: 0.5 })).toEqual([]);
  });

  it("throws on output containing no JSON object", () => {
    expect(() => parseMatchResponse("no json here", { threshold: 0.5 })).toThrow();
    expect(() => parseMatchResponse("[1,2,3]", { threshold: 0.5 })).toThrow();
  });

  it("skips null elements inside the matches array", () => {
    const r = parseMatchResponse(
      '{"matches":[null,{"question_id":"q1","bank_entry_id":"b1","confidence":1}]}',
      { threshold: 0.5 },
    );
    expect(r).toEqual([{ fieldId: "q1", entryId: "b1", confidence: 1, selectedOption: null }]);
  });
});
