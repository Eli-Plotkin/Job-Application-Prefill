import { describe, it, expect, vi } from "vitest";
import { runMatching } from "../src/lib/engine.js";

const fields = [
  { id: "f-email", label: "Email", type: "email", tag: "input", autocomplete: "email", name: "email" },
  { id: "f-auth", label: "Are you authorized to work in the US?", type: "text", tag: "input", autocomplete: "", name: "q1" },
  { id: "f-essay", label: "Why do you want to work here?", type: "textarea", tag: "textarea", autocomplete: "", name: "q2" },
];
const answerBank = [
  { id: "b-email", label: "Email", answer: "a@b.com" },
  { id: "b-auth", label: "Work authorization", answer: "Yes" },
];

describe("runMatching", () => {
  it("uses Stage 1 only when every unmatched field would be empty-handed (no AI call needed if all matched)", async () => {
    const complete = vi.fn();
    const onlyStandard = [fields[0]];
    const { results } = await runMatching({
      fields: onlyStandard,
      answerBank,
      threshold: 0.6,
      complete,
    });
    expect(complete).not.toHaveBeenCalled();
    expect(results[0].status).toBe("matched");
    expect(results[0].entry.id).toBe("b-email");
    expect(results[0].match.source).toBe("stage1");
  });

  it("runs a single batched Stage 2 call for the varied-wording fields", async () => {
    const complete = vi.fn().mockResolvedValue(
      JSON.stringify({
        matches: [
          { question_id: "f-auth", bank_entry_id: "b-auth", confidence: 0.95 },
          { question_id: "f-essay", bank_entry_id: null, confidence: 0.0 },
        ],
      }),
    );
    const { results } = await runMatching({ fields, answerBank, threshold: 0.6, complete });

    // Exactly one batched call, regardless of how many fields are unmatched.
    expect(complete).toHaveBeenCalledTimes(1);
    const promptArg = complete.mock.calls[0][0];
    expect(promptArg.user).toContain("authorized to work");
    expect(promptArg.user).toContain("Why do you want to work here?");

    const byId = Object.fromEntries(results.map((r) => [r.field.id, r]));
    expect(byId["f-email"].status).toBe("matched"); // stage 1
    expect(byId["f-auth"].status).toBe("matched"); // stage 2
    expect(byId["f-auth"].match.source).toBe("stage2");
    expect(byId["f-essay"].status).toBe("unmatched"); // open-ended, left for Write with AI
  });

  it("does not call the model when there are no unmatched fields", async () => {
    const complete = vi.fn();
    await runMatching({ fields: [fields[0]], answerBank, threshold: 0.6, complete });
    expect(complete).not.toHaveBeenCalled();
  });

  it("applies the confidence threshold (low-confidence guess → unmatched)", async () => {
    const complete = vi.fn().mockResolvedValue(
      JSON.stringify({ matches: [{ question_id: "f-auth", bank_entry_id: "b-auth", confidence: 0.3 }] }),
    );
    const { results } = await runMatching({
      fields: [fields[1]],
      answerBank,
      threshold: 0.6,
      complete,
    });
    expect(results[0].status).toBe("unmatched");
  });
});
