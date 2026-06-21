import { describe, it, expect, beforeEach, vi } from "vitest";
import { getAdapter } from "../src/adapters/registry.js";
import { runMatching } from "../src/lib/engine.js";
import { Overlay } from "../src/content/overlay.js";

beforeEach(() => {
  document.body.innerHTML = "";
});
const flush = () => new Promise((r) => setTimeout(r));

describe("multi-step Workday wizard", () => {
  it("only detects and fills the visible step", () => {
    document.body.innerHTML = `
      <section aria-hidden="true">
        <label for="s1">First name</label><input id="s1" autocomplete="given-name">
      </section>
      <section>
        <label for="s2">Email</label><input id="s2" type="email" autocomplete="email">
      </section>`;
    const adapter = getAdapter("acme.wd5.myworkdayjobs.com");
    const fields = adapter.detect(document);
    expect(fields.map((f) => f.el.id)).toEqual(["s2"]); // hidden step excluded
  });
});

describe("native <select> matched via Stage 2 fills correctly", () => {
  it("maps a non-standardized select and fills it through the base adapter", async () => {
    document.body.innerHTML = `
      <label for="c">Country of legal residence</label>
      <select id="c" name="country">
        <option value="">Select</option>
        <option value="us">United States</option>
        <option value="ca">Canada</option>
      </select>`;
    const adapter = getAdapter("boards.greenhouse.io");
    const fields = adapter.detect(document);
    const bank = [{ id: "b-country", label: "Country", answer: "United States" }];

    const complete = vi.fn(() =>
      Promise.resolve(JSON.stringify({ matches: [{ question_id: fields[0].id, bank_entry_id: "b-country", confidence: 0.95 }] })),
    );
    const { results } = await runMatching({ fields, answerBank: bank, threshold: 0.6, complete });
    expect(results[0].status).toBe("matched");

    const ok = adapter.fill(results[0].field, results[0].entry.answer);
    expect(ok).toBe(true);
    expect(document.getElementById("c").value).toBe("us");
  });
});

describe("no API key: Stage 1 only, overlay still useful", () => {
  it("matches standardized fields, leaves the rest for manual / Write with AI", async () => {
    document.body.innerHTML = `
      <label for="e">Email</label><input id="e" type="email" autocomplete="email">
      <label for="w">Why do you want to work here?</label><textarea id="w"></textarea>
      <label for="s">Country</label><select id="s" name="s"><option>US</option></select>`;
    const adapter = getAdapter("example.com");
    const fields = adapter.detect(document);
    const bank = [{ id: "b-email", label: "Email", answer: "a@b.com" }];

    const complete = vi.fn();
    const { results } = await runMatching({ fields, answerBank: bank, threshold: 0.6, complete: null });
    expect(complete).not.toHaveBeenCalled();

    const overlay = new Overlay({}).mount();
    overlay.render(results);

    // Email matched; textarea + select unmatched.
    const badges = Array.from(overlay.shadow.querySelectorAll("[data-badge]")).map((b) => b.textContent);
    expect(badges.filter((t) => /found/i.test(t))).toHaveLength(1);
    // Write with AI only on the unmatched textarea (not the select).
    expect(overlay.shadow.querySelectorAll('[data-action="write"]')).toHaveLength(1);
    overlay.destroy();
  });
});

describe("Fill all matched commits every matched answer", () => {
  it("fills duplicate emails and an AI-matched text field in one action", async () => {
    document.body.innerHTML = `
      <input id="e1" type="email"><input id="e2" type="email">
      <label for="auth">Legally authorized to work?</label><input id="auth" type="text" name="auth">`;
    const adapter = getAdapter("example.com");
    const fields = adapter.detect(document);
    const bank = [
      { id: "b-email", label: "Email", answer: "me@x.com" },
      { id: "b-auth", label: "Work authorization", answer: "Yes" },
    ];
    const authId = fields.find((f) => f.el.id === "auth").id;
    const complete = vi.fn(() =>
      Promise.resolve(JSON.stringify({ matches: [{ question_id: authId, bank_entry_id: "b-auth", confidence: 0.9 }] })),
    );

    const { results } = await runMatching({ fields, answerBank: bank, threshold: 0.6, complete });
    const resultsByField = new Map(results.map((r) => [r.field.id, r]));

    // Simulate the overlay's onFillAll.
    for (const r of resultsByField.values()) {
      if (r.status === "matched") adapter.fill(r.field, r.entry.answer, { highlight: true });
    }

    expect(document.getElementById("e1").value).toBe("me@x.com");
    expect(document.getElementById("e2").value).toBe("me@x.com");
    expect(document.getElementById("auth").value).toBe("Yes");
  });
});
