import { describe, it, expect, beforeEach } from "vitest";
import { resolveLabel, detectFields, getFieldElement, isFreeText } from "../src/dom/field-detector.js";

beforeEach(() => {
  document.body.innerHTML = "";
});
const byId = (id) => document.getElementById(id);

describe("resolveLabel — precedence and fallbacks", () => {
  it("prefers aria-labelledby over every other source", () => {
    document.body.innerHTML = `
      <span id="L">From ARIA</span>
      <label for="x">From label-for</label>
      <label><input id="x" aria-labelledby="L" aria-label="From aria-label" placeholder="From placeholder" name="fromName"></label>`;
    expect(resolveLabel(byId("x"))).toBe("From ARIA");
  });

  it("falls back through aria-label → label[for] → placeholder → name", () => {
    document.body.innerHTML = `<input id="a" aria-label="AL" placeholder="PH" name="NM">`;
    expect(resolveLabel(byId("a"))).toBe("AL");
    document.body.innerHTML = `<label for="b">LF</label><input id="b" placeholder="PH" name="NM">`;
    expect(resolveLabel(byId("b"))).toBe("LF");
    document.body.innerHTML = `<input id="c" placeholder="PH" name="NM">`;
    expect(resolveLabel(byId("c"))).toBe("PH");
    document.body.innerHTML = `<input id="d" name="how_did_you_hear">`;
    expect(resolveLabel(byId("d"))).toBe("how did you hear");
  });

  it("skips missing aria-labelledby ids and joins the present ones", () => {
    document.body.innerHTML = `<span id="p1">Work</span><input id="w" aria-labelledby="p1 missing">`;
    expect(resolveLabel(byId("w"))).toBe("Work");
  });

  it("resolves label[for] when the id contains CSS-special characters", () => {
    document.body.innerHTML = `<label for="a:b.c">Tricky</label><input id="a:b.c">`;
    expect(resolveLabel(byId("a:b.c"))).toBe("Tricky");
  });

  it("strips nested controls from a wrapping label", () => {
    document.body.innerHTML = `<label>Country <select id="s"><option>United States</option></select></label>`;
    expect(resolveLabel(byId("s"))).toBe("Country");
    document.body.innerHTML = `<label>Email <input id="i"> <button>?</button></label>`;
    expect(resolveLabel(byId("i"))).toBe("Email");
  });

  it("prettifies camelCase, snake_case, and kebab names", () => {
    document.body.innerHTML = `<input id="x" name="linkedInProfileUrl">`;
    expect(resolveLabel(byId("x"))).toBe("linked In Profile Url");
    document.body.innerHTML = `<input id="y" name="first-name">`;
    expect(resolveLabel(byId("y"))).toBe("first name");
  });

  it("returns empty string for a control with no label, name, or id", () => {
    document.body.innerHTML = `<input class="anon">`;
    expect(resolveLabel(document.querySelector(".anon"))).toBe("");
  });

  it("falls back to a prettified id when there is no name", () => {
    document.body.innerHTML = `<input id="middle_initial">`;
    expect(resolveLabel(byId("middle_initial"))).toBe("middle initial");
  });
});

describe("detectFields — exclusions and metadata", () => {
  it("excludes readonly and aria-readonly controls", () => {
    document.body.innerHTML = `
      <input id="a" type="text">
      <input id="b" type="text" readonly>
      <textarea id="c" readonly></textarea>
      <input id="d" type="text" aria-readonly="true">`;
    expect(detectFields(document).map((f) => f.el.id)).toEqual(["a"]);
  });

  it("excludes controls hidden by an aria-hidden or [hidden] ancestor (inactive wizard steps)", () => {
    document.body.innerHTML = `
      <div aria-hidden="true"><input id="step1" type="text"></div>
      <div hidden><input id="step3" type="text"></div>
      <div><input id="step2" type="text"></div>`;
    expect(detectFields(document).map((f) => f.el.id)).toEqual(["step2"]);
  });

  it("detects all text-like input types and lowercases the type", () => {
    document.body.innerHTML = `
      <input id="t" type="TEXT">
      <input id="s" type="search">
      <input id="n" type="number">
      <input id="u" type="url">
      <input id="p" type="tel">
      <input id="x">`;
    const types = Object.fromEntries(detectFields(document).map((f) => [f.el.id, f.type]));
    expect(types).toEqual({ t: "text", s: "search", n: "number", u: "url", p: "tel", x: "text" });
  });

  it("assigns sequential ids and round-trips each through getFieldElement", () => {
    document.body.innerHTML = `<input id="a"><textarea id="b"></textarea><select id="c" name="c"><option>x</option></select>`;
    const fields = detectFields(document);
    expect(fields.map((f) => f.id)).toEqual(["aa-field-0", "aa-field-1", "aa-field-2"]);
    for (const f of fields) expect(getFieldElement(document, f.id)).toBe(f.el);
  });

  it("flags openEnded only for textareas", () => {
    document.body.innerHTML = `<input id="a"><textarea id="b"></textarea><select id="c" name="c"><option>x</option></select>`;
    const open = Object.fromEntries(detectFields(document).map((f) => [f.el.id, f.openEnded]));
    expect(open).toEqual({ a: false, b: true, c: false });
  });
});

describe("isFreeText — narrowed to genuine prose fields", () => {
  it("is true for textareas and plain text inputs", () => {
    expect(isFreeText({ tag: "textarea", type: "textarea" })).toBe(true);
    expect(isFreeText({ tag: "input", type: "text" })).toBe(true);
    expect(isFreeText({ tag: "input", type: "" })).toBe(true);
  });

  it("is false for email/tel/url/number/search inputs and selects", () => {
    for (const type of ["email", "tel", "url", "number", "search"]) {
      expect(isFreeText({ tag: "input", type }), type).toBe(false);
    }
    expect(isFreeText({ tag: "select", type: "select" })).toBe(false);
    expect(isFreeText({ tag: "button", type: "combobox" })).toBe(false);
  });
});
