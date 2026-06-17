// End-to-end of the layer the content script orchestrates: detect → Stage 1 +
// batched Stage 2 match → fill native fields + a Workday combobox → Write-with-AI.
// The model call is faked the way the real one behaves (reads the prompt, returns
// a JSON mapping / a draft string).
import { describe, it, expect, beforeEach } from "vitest";
import { getAdapter } from "../src/adapters/registry.js";
import { WorkdayAdapter } from "../src/adapters/workday.js";
import { runMatching } from "../src/lib/engine.js";
import { buildDraftPrompt } from "../src/lib/drafter.js";

const ANSWER_BANK = [
  { id: "b-email", label: "Email", answer: "eli@example.com" },
  { id: "b-auth", label: "Work authorization", answer: "Yes" },
  { id: "b-country", label: "Country of residence", answer: "United States" },
];

// Fake matcher: parse the question lines out of the prompt and map by meaning,
// exactly the shape the real model returns.
function fakeMatchComplete(prompt) {
  const lines = [...prompt.user.matchAll(/id=(\S+): "([^"]+)"/g)];
  const matches = lines.map(([, id, label]) => {
    const l = label.toLowerCase();
    if (l.includes("authorized to work")) return { question_id: id, bank_entry_id: "b-auth", confidence: 0.96 };
    if (l.includes("country")) return { question_id: id, bank_entry_id: "b-country", confidence: 0.9 };
    return { question_id: id, bank_entry_id: null, confidence: 0.0 };
  });
  return Promise.resolve(JSON.stringify({ matches }));
}

beforeEach(() => {
  document.body.innerHTML = `
    <label for="email">Email</label>
    <input id="email" type="email" autocomplete="email" name="email">

    <label for="auth">Are you legally authorized to work in the US?</label>
    <input id="auth" type="text" name="q_auth">

    <label for="why">Why do you want to work here?</label>
    <textarea id="why" name="q_why"></textarea>

    <label id="clbl">Country</label>
    <button id="cbtn" aria-labelledby="clbl" aria-haspopup="listbox" aria-controls="clist">Select One</button>
    <div id="clist" role="listbox"></div>`;

  // Workday renders listbox options on open.
  const btn = document.getElementById("cbtn");
  const list = document.getElementById("clist");
  btn.addEventListener("click", () => {
    list.innerHTML = `<div role="option">United States</div><div role="option">Canada</div>`;
    list.querySelectorAll('[role="option"]').forEach((opt) =>
      opt.addEventListener("click", () => (btn.textContent = opt.textContent.trim())),
    );
  });
});

describe("end-to-end fill flow", () => {
  it("matches, fills standardized + AI-matched fields, and drafts an open-ended one", async () => {
    const adapter = getAdapter("acme.wd5.myworkdayjobs.com");
    expect(adapter).toBeInstanceOf(WorkdayAdapter);

    const fields = adapter.detect(document);
    // email, auth, why (native) + country combobox.
    expect(fields).toHaveLength(4);

    const { results } = await runMatching({
      fields,
      answerBank: ANSWER_BANK,
      threshold: 0.6,
      complete: fakeMatchComplete,
    });

    const emailR = results.find((r) => r.field.name === "email");
    const authR = results.find((r) => r.field.name === "q_auth");
    const whyR = results.find((r) => r.field.name === "q_why");
    const countryR = results.find((r) => r.field.type === "combobox");

    expect(emailR.match.source).toBe("stage1");
    expect(authR.match.source).toBe("stage2");
    expect(countryR.status).toBe("matched");
    expect(whyR.status).toBe("unmatched"); // open-ended → Write with AI only

    // Fill all matched (what the "Fill all matched" button does).
    for (const r of results) {
      if (r.status === "matched") adapter.fill(r.field, r.entry.answer, { highlight: true });
    }

    expect(document.getElementById("email").value).toBe("eli@example.com");
    expect(document.getElementById("auth").value).toBe("Yes");
    expect(document.getElementById("cbtn").textContent).toBe("United States");
    // Highlighted for scan-review.
    expect(document.getElementById("email").getAttribute("data-apply-assistant-filled")).toBe("true");
    // The open-ended field is untouched until the user writes with AI.
    expect(document.getElementById("why").value).toBe("");

    // Write with AI on the open-ended field.
    const draftPrompt = buildDraftPrompt({
      question: whyR.field.label,
      resumeText: "Built real-time robotics systems in C++.",
      blurb: "I love hard systems problems.",
    });
    expect(draftPrompt.user).toContain("Why do you want to work here?");
    const fakeDraft = "I'm excited by your real-time systems work, which lines up with my robotics background.";
    adapter.fill(whyR.field, fakeDraft, { highlight: true });
    expect(document.getElementById("why").value).toBe(fakeDraft);
  });
});
