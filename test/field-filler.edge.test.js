import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  setNativeValue,
  fillTextField,
  fillNativeSelect,
  fillField,
  highlight,
  unhighlightAll,
  HIGHLIGHT_ATTR,
} from "../src/dom/field-filler.js";

beforeEach(() => {
  document.body.innerHTML = "";
});

function mk(html) {
  document.body.innerHTML = html;
  return document.body.firstElementChild;
}

describe("setNativeValue", () => {
  it("coerces non-string values and handles empty strings", () => {
    const input = mk(`<input>`);
    setNativeValue(input, 42);
    expect(input.value).toBe("42");
    setNativeValue(input, "");
    expect(input.value).toBe("");
  });
});

describe("fillTextField", () => {
  it("focuses, sets value, fires bubbling input+change, blurs, and highlights by default", () => {
    const input = mk(`<input>`);
    const focus = vi.spyOn(input, "focus");
    const blur = vi.spyOn(input, "blur");
    const events = [];
    input.addEventListener("input", (e) => events.push(["input", e.bubbles]));
    input.addEventListener("change", (e) => events.push(["change", e.bubbles]));

    const ok = fillTextField(input, "hi");

    expect(ok).toBe(true);
    expect(input.value).toBe("hi");
    expect(events).toEqual([["input", true], ["change", true]]);
    expect(focus).toHaveBeenCalled();
    expect(blur).toHaveBeenCalled();
    expect(input.getAttribute(HIGHLIGHT_ATTR)).toBe("true");
  });
});

describe("fillNativeSelect", () => {
  const select = (opts) => mk(`<select>${opts}</select>`);

  it("matches by option value", () => {
    const s = select(`<option value="">--</option><option value="us">United States</option>`);
    expect(fillNativeSelect(s, "us")).toBe(true);
    expect(s.value).toBe("us");
  });

  it("matches by visible text, case-insensitively and trimming whitespace", () => {
    const s = select(`<option value="">--</option><option value="ca">  Canada  </option>`);
    expect(fillNativeSelect(s, "canada")).toBe(true);
    expect(s.value).toBe("ca");
  });

  it("dispatches input and change events", () => {
    const s = select(`<option value="x">X</option>`);
    const seen = [];
    s.addEventListener("input", () => seen.push("input"));
    s.addEventListener("change", () => seen.push("change"));
    fillNativeSelect(s, "X");
    expect(seen).toEqual(["input", "change"]);
  });

  it("returns false and leaves the value untouched when nothing matches", () => {
    const s = select(`<option value="a">Alpha</option><option value="b">Beta</option>`);
    s.value = "b";
    expect(fillNativeSelect(s, "Gamma")).toBe(false);
    expect(s.value).toBe("b");
    expect(s.getAttribute(HIGHLIGHT_ATTR)).toBeNull();
  });

  it("picks the first matching option among duplicates", () => {
    const s = select(`<option value="1">Dup</option><option value="2">Dup</option>`);
    fillNativeSelect(s, "Dup");
    expect(s.value).toBe("1");
  });
});

describe("fillField dispatcher", () => {
  it("routes select, input, and textarea correctly", () => {
    expect(fillField(mk(`<select><option value="a">A</option></select>`), "A")).toBe(true);
    expect(fillField(mk(`<input>`), "x")).toBe(true);
    expect(fillField(mk(`<textarea></textarea>`), "y")).toBe(true);
  });

  it("returns false for an unsupported element (e.g. a div or button)", () => {
    expect(fillField(mk(`<div></div>`), "x")).toBe(false);
    expect(fillField(mk(`<button></button>`), "x")).toBe(false);
  });
});

describe("highlight / unhighlightAll", () => {
  it("adds and clears the highlight marker across a root", () => {
    document.body.innerHTML = `<input id="a"><input id="b"><input id="c">`;
    highlight(document.getElementById("a"));
    highlight(document.getElementById("b"));
    expect(document.querySelectorAll(`[${HIGHLIGHT_ATTR}]`).length).toBe(2);
    unhighlightAll(document);
    expect(document.querySelectorAll(`[${HIGHLIGHT_ATTR}]`).length).toBe(0);
  });

  it("scopes unhighlightAll to the given root", () => {
    document.body.innerHTML = `<div id="in"><input id="a"></div><input id="b">`;
    highlight(document.getElementById("a"));
    highlight(document.getElementById("b"));
    unhighlightAll(document.getElementById("in"));
    expect(document.getElementById("a").getAttribute(HIGHLIGHT_ATTR)).toBeNull();
    expect(document.getElementById("b").getAttribute(HIGHLIGHT_ATTR)).toBe("true");
  });
});
