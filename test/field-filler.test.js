import { describe, it, expect, beforeEach } from "vitest";
import {
  setNativeValue,
  fillTextField,
  fillField,
  HIGHLIGHT_ATTR,
} from "../src/dom/field-filler.js";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("setNativeValue", () => {
  it("sets the value on an input via the native setter", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    setNativeValue(input, "hello");
    expect(input.value).toBe("hello");
  });

  it("sets the value on a textarea", () => {
    const ta = document.createElement("textarea");
    document.body.appendChild(ta);
    setNativeValue(ta, "multi\nline");
    expect(ta.value).toBe("multi\nline");
  });

  it("bypasses a React-style overridden instance setter and updates the real node value", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    const nativeGet = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    ).get;
    // Simulate React's value tracker: an instance setter that swallows writes.
    let instanceSetterSaw = null;
    Object.defineProperty(input, "value", {
      configurable: true,
      get() {
        return nativeGet.call(this);
      },
      set(v) {
        instanceSetterSaw = v; // React's tracker would intercept here
      },
    });
    setNativeValue(input, "typed");
    // The instance setter must be bypassed...
    expect(instanceSetterSaw).toBeNull();
    // ...and the real DOM node value updated via the prototype setter.
    expect(nativeGet.call(input)).toBe("typed");
  });
});

describe("fillTextField", () => {
  it("dispatches bubbling input and change events", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    const seen = [];
    input.addEventListener("input", (e) => seen.push(["input", e.bubbles]));
    input.addEventListener("change", (e) => seen.push(["change", e.bubbles]));
    fillTextField(input, "abc");
    expect(input.value).toBe("abc");
    expect(seen).toEqual([
      ["input", true],
      ["change", true],
    ]);
  });

  it("marks the field as filled for scan-review highlighting", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    fillTextField(input, "abc", { highlight: true });
    expect(input.getAttribute(HIGHLIGHT_ATTR)).toBe("true");
  });

  it("does not highlight when disabled", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    fillTextField(input, "abc", { highlight: false });
    expect(input.getAttribute(HIGHLIGHT_ATTR)).toBeNull();
  });
});

describe("fillField dispatcher", () => {
  it("fills a native <select> by matching option text/value and fires change", () => {
    const select = document.createElement("select");
    select.innerHTML = `<option value="">--</option><option value="us">United States</option>`;
    document.body.appendChild(select);
    let changed = false;
    select.addEventListener("change", () => (changed = true));
    const ok = fillField(select, "United States");
    expect(ok).toBe(true);
    expect(select.value).toBe("us");
    expect(changed).toBe(true);
  });

  it("returns false when a select has no matching option", () => {
    const select = document.createElement("select");
    select.innerHTML = `<option value="">--</option><option value="ca">Canada</option>`;
    document.body.appendChild(select);
    expect(fillField(select, "Germany")).toBe(false);
  });

  it("routes text inputs and textareas through fillTextField", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    expect(fillField(input, "x")).toBe(true);
    expect(input.value).toBe("x");
  });
});
