import { describe, it, expect } from "vitest";
import { buildDraftPrompt, buildRewritePrompt } from "../src/lib/drafter.js";

describe("buildDraftPrompt — edge cases", () => {
  it("marks missing resume/blurb as (none provided) without crashing", () => {
    const p = buildDraftPrompt({ question: "Why us?", resumeText: "", blurb: "" });
    expect(p.user).toContain("(none provided)");
    expect(p.user).toContain("Why us?");
  });

  it("handles undefined context fields", () => {
    const p = buildDraftPrompt({ question: "Q" });
    expect(typeof p.user).toBe("string");
    expect(p.user).toContain("Q");
  });

  it("always constrains first person and no fabrication", () => {
    const p = buildDraftPrompt({ question: "Q", resumeText: "R", blurb: "B" });
    expect(p.system).toMatch(/first person/i);
    expect(p.system).toMatch(/do not make up/i);
  });
});

describe("buildRewritePrompt — edge cases", () => {
  const base = { question: "Why us?", resumeText: "R", blurb: "B", previousDraft: "old draft" };

  it("uses the no-guidance branch for empty or whitespace-only guidance", () => {
    for (const guidance of ["", "   ", "\n\t"]) {
      const p = buildRewritePrompt({ ...base, guidance });
      expect(p.user).toMatch(/no specific guidance/i);
      expect(p.user).toContain("old draft");
    }
  });

  it("includes trimmed guidance when provided", () => {
    const p = buildRewritePrompt({ ...base, guidance: "  make it shorter  " });
    expect(p.user).toContain("make it shorter");
    expect(p.user).toContain("old draft");
  });

  it("includes an empty previous draft block without breaking", () => {
    const p = buildRewritePrompt({ ...base, previousDraft: "", guidance: "x" });
    expect(p.user).toContain("PREVIOUS DRAFT");
    expect(p.user).toContain("x");
  });
});
