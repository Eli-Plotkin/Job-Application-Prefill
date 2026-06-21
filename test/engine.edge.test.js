import { describe, it, expect, vi } from "vitest";
import { runMatching } from "../src/lib/engine.js";

const F = (over) => ({ id: "f", label: "L", type: "text", tag: "input", autocomplete: "", name: "n", ...over });
const emailF = { id: "fe", label: "Email", type: "email", tag: "input", autocomplete: "email", name: "email" };
const BANK = [
  { id: "be", label: "Email", answer: "a@b.com" },
  { id: "ba", label: "Work authorization", answer: "Yes" },
];

const reply = (matches) => Promise.resolve(JSON.stringify({ matches }));

describe("runMatching — orchestration edge cases", () => {
  it("runs Stage 1 only when complete is null (no API key)", async () => {
    const { results } = await runMatching({
      fields: [emailF, F({ id: "fa", label: "Authorized to work?" })],
      answerBank: BANK,
      threshold: 0.6,
      complete: null,
    });
    const byId = Object.fromEntries(results.map((r) => [r.field.id, r]));
    expect(byId.fe.status).toBe("matched"); // stage 1
    expect(byId.fa.status).toBe("unmatched"); // no AI available
  });

  it("does NOT call the model when the answer bank is empty", async () => {
    const complete = vi.fn();
    const { results } = await runMatching({
      fields: [F({ id: "fa", label: "Authorized to work?" })],
      answerBank: [],
      threshold: 0.6,
      complete,
    });
    expect(complete).not.toHaveBeenCalled();
    expect(results[0].status).toBe("unmatched");
  });

  it("treats a hallucinated (nonexistent) bank id as unmatched", async () => {
    const complete = vi.fn(() => reply([{ question_id: "fa", bank_entry_id: "DOES_NOT_EXIST", confidence: 0.99 }]));
    const { results } = await runMatching({
      fields: [F({ id: "fa", label: "Authorized to work?" })],
      answerBank: BANK,
      threshold: 0.6,
      complete,
    });
    expect(results[0].status).toBe("unmatched");
    expect(results[0].entry).toBeNull();
  });

  it("ignores a mapping for a field id that is not on the page", async () => {
    const complete = vi.fn(() => reply([{ question_id: "ghost", bank_entry_id: "ba", confidence: 1 }]));
    const { results } = await runMatching({
      fields: [F({ id: "fa", label: "Authorized to work?" })],
      answerBank: BANK,
      threshold: 0.6,
      complete,
    });
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("unmatched");
  });

  it("keeps the Stage 1 match if Stage 2 also returns the same field", async () => {
    // Email matched in stage 1; pretend the model also (wrongly) returns it.
    const complete = vi.fn(() => reply([{ question_id: "fe", bank_entry_id: "ba", confidence: 1 }]));
    const { results } = await runMatching({
      fields: [emailF, F({ id: "fa", label: "Authorized to work?" })],
      answerBank: BANK,
      threshold: 0.6,
      complete,
    });
    const fe = results.find((r) => r.field.id === "fe");
    expect(fe.match.source).toBe("stage1");
    expect(fe.entry.id).toBe("be");
  });

  it("makes exactly one batched Stage 2 call for many unmatched fields", async () => {
    const complete = vi.fn(() => reply([]));
    await runMatching({
      fields: [F({ id: "a", label: "Q1" }), F({ id: "b", label: "Q2" }), F({ id: "c", label: "Q3" })],
      answerBank: BANK,
      threshold: 0.6,
      complete,
    });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0][0].user).toContain("Q1");
    expect(complete.mock.calls[0][0].user).toContain("Q3");
  });

  it("propagates an error thrown by complete", async () => {
    const complete = vi.fn(() => Promise.reject(new Error("network down")));
    await expect(
      runMatching({ fields: [F({ id: "a" })], answerBank: BANK, threshold: 0.6, complete }),
    ).rejects.toThrow("network down");
  });

  it("returns no results and skips the model for an empty page", async () => {
    const complete = vi.fn();
    const { results } = await runMatching({ fields: [], answerBank: BANK, threshold: 0.6, complete });
    expect(results).toEqual([]);
    expect(complete).not.toHaveBeenCalled();
  });

  it("leaves a below-threshold Stage 2 guess unmatched", async () => {
    const complete = vi.fn(() => reply([{ question_id: "fa", bank_entry_id: "ba", confidence: 0.4 }]));
    const { results } = await runMatching({
      fields: [F({ id: "fa", label: "Authorized to work?" })],
      answerBank: BANK,
      threshold: 0.6,
      complete,
    });
    expect(results[0].status).toBe("unmatched");
  });
});
