// Property/fuzz tests: throw hundreds of randomized field+bank scenarios through
// the matching pipeline and assert the core invariants always hold. Uses a seeded
// PRNG so any failure reproduces deterministically.
import { describe, it, expect } from "vitest";
import { stage1Match } from "../src/lib/matcher.js";
import { runMatching } from "../src/lib/engine.js";

function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}
const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length)];

const FIELD_TYPES = ["email", "tel", "url", "text", "textarea", "number", "search"];
const LABELS = [
  "Email", "Phone", "First name", "Last name", "LinkedIn", "GitHub", "Website",
  "Are you authorized to work in the US?", "Require sponsorship?", "Willing to relocate?",
  "How did you hear about us?", "Why do you want to work here?", "Salary expectations",
  "Desired start date", "Pronouns", "Veteran status",
];
const BANK_LABELS = [
  "Email", "Phone", "First name", "Last name", "LinkedIn", "GitHub", "Portfolio website",
  "Work authorization", "Require sponsorship?", "Willing to relocate?", "How did you hear about us?",
];

function makeScenario(rnd) {
  const nFields = 1 + Math.floor(rnd() * 8);
  const fields = Array.from({ length: nFields }, (_, i) => {
    const type = pick(rnd, FIELD_TYPES);
    const tag = type === "textarea" ? "textarea" : "input";
    return {
      id: `f${i}`,
      label: pick(rnd, LABELS),
      type: tag === "textarea" ? "textarea" : type,
      tag,
      autocomplete: rnd() < 0.4 ? pick(rnd, ["email", "tel", "url", "given-name", "family-name", "name", ""]) : "",
      name: `n${i}`,
    };
  });
  const nBank = Math.floor(rnd() * 8);
  const bank = Array.from({ length: nBank }, (_, i) => ({
    id: `b${i}`,
    label: pick(rnd, BANK_LABELS),
    answer: `ans-${i}`,
  }));
  return { fields, bank };
}

// A fake model that maps each question (read from the prompt) to a random bank id
// — sometimes a nonexistent one, sometimes null — with a random confidence.
function makeFakeComplete(rnd, bank) {
  return (prompt) => {
    const questionsSection = prompt.user.split("ANSWER BANK:")[0];
    const ids = [...questionsSection.matchAll(/- id=(\S+):/g)].map((m) => m[1]);
    const matches = ids.map((id) => {
      const roll = rnd();
      let bankId = null;
      if (roll < 0.4 && bank.length) bankId = pick(rnd, bank).id;
      else if (roll < 0.5) bankId = "HALLUCINATED";
      return { question_id: id, bank_entry_id: bankId, confidence: Math.round(rnd() * 100) / 100 };
    });
    return Promise.resolve(JSON.stringify({ matches }));
  };
}

describe("stage1Match invariants", () => {
  it("partitions every field into exactly one of matched/unmatched", () => {
    const rnd = lcg(12345);
    for (let n = 0; n < 300; n++) {
      const { fields, bank } = makeScenario(rnd);
      const { matches, unmatchedFieldIds } = stage1Match(fields, bank);
      const matchedIds = matches.map((m) => m.fieldId);
      const all = [...matchedIds, ...unmatchedFieldIds].sort();
      expect(all).toEqual(fields.map((f) => f.id).sort());
      // No field is both matched and unmatched.
      expect(new Set(matchedIds).size + new Set(unmatchedFieldIds).size).toBe(fields.length);
      // Every matched entry id exists in the bank.
      for (const m of matches) expect(bank.some((b) => b.id === m.entryId)).toBe(true);
    }
  });

  it("is deterministic for identical input", () => {
    const rnd = lcg(999);
    for (let n = 0; n < 100; n++) {
      const { fields, bank } = makeScenario(rnd);
      expect(stage1Match(fields, bank)).toEqual(stage1Match(fields, bank));
    }
  });
});

describe("runMatching invariants", () => {
  it("never violates the result contract across many random scenarios", async () => {
    const rnd = lcg(2024);
    const threshold = 0.6;
    for (let n = 0; n < 250; n++) {
      const { fields, bank } = makeScenario(rnd);
      const complete = makeFakeComplete(rnd, bank);
      const { results, matchMap } = await runMatching({ fields, answerBank: bank, threshold, complete });

      // 1. Exactly one result per field, in order, ids preserved.
      expect(results.map((r) => r.field.id)).toEqual(fields.map((f) => f.id));

      for (const r of results) {
        // 2. matched <=> entry present.
        expect(r.status === "matched").toBe(r.entry !== null);
        if (r.status === "matched") {
          // 3. The entry is a real bank entry.
          expect(bank.some((b) => b.id === r.entry.id)).toBe(true);
          expect(typeof r.entry.answer).toBe("string");
          // 4. A matched result has a match record with a known source.
          expect(["stage1", "stage2"]).toContain(r.match.source);
        } else {
          expect(r.match).toBeNull();
        }
      }

      // 5. matchMap never references a hallucinated id as a *matched* result.
      for (const r of results) {
        if (r.status === "matched") expect(r.match.entryId).not.toBe("HALLUCINATED");
      }

      // 6. matchMap may contain stage-2 entries pointing at hallucinated ids, but
      //    those never surface as matched results (covered by #2/#3 above).
      expect(matchMap instanceof Map).toBe(true);
    }
  });
});
