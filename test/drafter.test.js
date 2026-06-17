import { describe, it, expect } from "vitest";
import { buildDraftPrompt, buildRewritePrompt } from "../src/lib/drafter.js";

const ctx = {
  question: "Why do you want to work here?",
  resumeText: "Built a robotics control system in C++.",
  blurb: "I'm a systems engineer who loves hard real-time problems.",
};

describe("buildDraftPrompt", () => {
  it("includes question, resume, and blurb, and constrains voice + honesty", () => {
    const p = buildDraftPrompt(ctx);
    expect(p.user).toContain("Why do you want to work here?");
    expect(p.user).toContain("robotics control system");
    expect(p.user).toContain("systems engineer");
    // First person + no fabrication are the load-bearing instructions (§5).
    expect(p.system).toMatch(/first person/i);
    expect(p.system).toMatch(/(do not (make up|fabricate|invent)|not supported)/i);
  });
});

describe("buildRewritePrompt", () => {
  it("includes the previous draft and the user's guidance", () => {
    const p = buildRewritePrompt({
      ...ctx,
      previousDraft: "I want to work here because robotics is cool.",
      guidance: "make it shorter and less casual",
    });
    expect(p.user).toContain("I want to work here because robotics is cool.");
    expect(p.user).toContain("make it shorter and less casual");
    expect(p.system).toMatch(/first person/i);
  });

  it("works with empty guidance (regenerate using the prior draft)", () => {
    const p = buildRewritePrompt({
      ...ctx,
      previousDraft: "An earlier answer.",
      guidance: "",
    });
    expect(p.user).toContain("An earlier answer.");
    // Must still be a valid, non-empty prompt.
    expect(p.user.length).toBeGreaterThan(0);
  });
});
