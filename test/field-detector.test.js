import { describe, it, expect, beforeEach } from "vitest";
import {
  resolveLabel,
  detectFields,
  getFieldElement,
  FIELD_ID_ATTR,
} from "../src/dom/field-detector.js";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("resolveLabel", () => {
  it("uses <label for> association", () => {
    document.body.innerHTML = `
      <label for="e">Email Address</label>
      <input id="e" type="email">`;
    expect(resolveLabel(document.getElementById("e"))).toBe("Email Address");
  });

  it("uses aria-labelledby (joining referenced elements)", () => {
    document.body.innerHTML = `
      <span id="l1">Work</span><span id="l2">Authorization</span>
      <input id="w" aria-labelledby="l1 l2">`;
    expect(resolveLabel(document.getElementById("w"))).toBe("Work Authorization");
  });

  it("uses aria-label", () => {
    document.body.innerHTML = `<input id="p" aria-label="Phone number">`;
    expect(resolveLabel(document.getElementById("p"))).toBe("Phone number");
  });

  it("uses a wrapping <label>", () => {
    document.body.innerHTML = `<label>Full name <input id="n"></label>`;
    expect(resolveLabel(document.getElementById("n"))).toBe("Full name");
  });

  it("falls back to placeholder, then a prettified name", () => {
    document.body.innerHTML = `<input id="a" placeholder="Why us?">`;
    expect(resolveLabel(document.getElementById("a"))).toBe("Why us?");
    document.body.innerHTML = `<input id="b" name="linkedInProfile">`;
    expect(resolveLabel(document.getElementById("b")).toLowerCase()).toContain("linked");
  });
});

describe("detectFields", () => {
  it("detects text-like inputs, textareas, and selects with resolved metadata", () => {
    document.body.innerHTML = `
      <label for="email">Email</label>
      <input id="email" type="email" autocomplete="email" name="email">
      <label for="why">Why do you want to work here?</label>
      <textarea id="why" name="why"></textarea>
      <label for="country">Country</label>
      <select id="country" name="country"><option>US</option></select>`;
    const fields = detectFields(document);
    const byName = Object.fromEntries(fields.map((f) => [f.name, f]));

    expect(byName.email).toMatchObject({
      type: "email",
      autocomplete: "email",
      label: "Email",
      tag: "input",
    });
    expect(byName.why).toMatchObject({ tag: "textarea", openEnded: true, label: "Why do you want to work here?" });
    expect(byName.country).toMatchObject({ tag: "select", type: "select" });
  });

  it("excludes hidden, disabled, and non-fillable inputs", () => {
    document.body.innerHTML = `
      <input id="a" type="text">
      <input id="b" type="hidden">
      <input id="c" type="submit">
      <input id="d" type="password">
      <input id="e" type="text" disabled>
      <input id="f" type="text" style="display:none">
      <input id="g" type="text" aria-hidden="true">`;
    const ids = detectFields(document).map((f) => f.el.id);
    expect(ids).toEqual(["a"]);
  });

  it("assigns a stable id that round-trips back to the element", () => {
    document.body.innerHTML = `<input id="x" type="text">`;
    const [f] = detectFields(document);
    expect(f.el.getAttribute(FIELD_ID_ATTR)).toBe(f.id);
    expect(getFieldElement(document, f.id)).toBe(document.getElementById("x"));
  });

  it("returns an empty list when there are no fillable fields", () => {
    document.body.innerHTML = `<div>no fields here</div>`;
    expect(detectFields(document)).toEqual([]);
  });
});
