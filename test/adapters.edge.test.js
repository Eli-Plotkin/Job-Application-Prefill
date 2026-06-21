import { describe, it, expect, beforeEach } from "vitest";
import { BaseAdapter } from "../src/adapters/base.js";
import { WorkdayAdapter } from "../src/adapters/workday.js";
import { getAdapter } from "../src/adapters/registry.js";
import { FIELD_ID_ATTR } from "../src/dom/field-detector.js";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("WorkdayAdapter.matches — host edge cases", () => {
  it("accepts real Workday tenant hosts (any case)", () => {
    for (const h of [
      "acme.wd5.myworkdayjobs.com",
      "wd103.myworkdayjobs.com",
      "myworkdayjobs.com",
      "acme.wd1.myworkday.com",
      "myworkday.com",
      "ACME.WD5.MYWORKDAYJOBS.COM",
    ]) {
      expect(WorkdayAdapter.matches(h), h).toBe(true);
    }
  });

  it("rejects look-alike and unrelated hosts (no false positives)", () => {
    for (const h of [
      "myworkdayjobs.com.evil.com",
      "notmyworkdayjobs.com",
      "myworkdayjobs.evil.com",
      "boards.greenhouse.io",
      "jobs.lever.co",
      "example.com",
      "",
      undefined,
    ]) {
      expect(WorkdayAdapter.matches(h), String(h)).toBe(false);
    }
  });
});

describe("getAdapter", () => {
  it("returns Workday for tenant hosts and Base otherwise", () => {
    expect(getAdapter("x.wd5.myworkdayjobs.com")).toBeInstanceOf(WorkdayAdapter);
    expect(getAdapter("greenhouse.io")).toBeInstanceOf(BaseAdapter);
    expect(getAdapter("greenhouse.io")).not.toBeInstanceOf(WorkdayAdapter);
  });

  it("defaults to the base adapter for the local test host", () => {
    expect(getAdapter()).toBeInstanceOf(BaseAdapter);
  });
});

describe("BaseAdapter.fill — element resolution", () => {
  it("re-resolves the element by id when the original node was replaced", () => {
    document.body.innerHTML = `<input id="orig" type="text">`;
    const adapter = new BaseAdapter();
    const [f] = adapter.detect(document);
    // Simulate a framework swapping the node for a fresh one carrying the same id.
    const fresh = f.el.cloneNode();
    document.body.replaceChild(fresh, f.el);
    expect(f.el.isConnected).toBe(false);

    expect(adapter.fill(f, "value")).toBe(true);
    expect(fresh.value).toBe("value");
  });

  it("returns false when the element cannot be found at all", () => {
    const adapter = new BaseAdapter();
    expect(adapter.fill({ id: "ghost", el: null }, "x")).toBe(false);
  });
});

describe("WorkdayAdapter — combobox detection & filling", () => {
  it("detects role=combobox and aria-haspopup=menu widgets", () => {
    document.body.innerHTML = `
      <span id="l1">Role</span><div role="combobox" aria-labelledby="l1"></div>
      <span id="l2">Menu</span><button aria-haspopup="menu" aria-labelledby="l2">Pick</button>`;
    const combos = new WorkdayAdapter().detect(document).filter((f) => f.type === "combobox");
    expect(combos.map((c) => c.label).sort()).toEqual(["Menu", "Role"]);
  });

  it("skips an aria-hidden combobox", () => {
    document.body.innerHTML = `<button aria-haspopup="listbox" aria-hidden="true">x</button>`;
    expect(new WorkdayAdapter().detect(document).filter((f) => f.type === "combobox")).toHaveLength(0);
  });

  it("finds options rendered to the document when there is no aria-controls", () => {
    document.body.innerHTML = `<button id="b" aria-haspopup="listbox">Select</button><div id="pop"></div>`;
    const b = document.getElementById("b");
    let picked = null;
    b.addEventListener("click", () => {
      document.getElementById("pop").innerHTML = `<div role="option">Yes</div><div role="option">No</div>`;
      document
        .getElementById("pop")
        .querySelectorAll('[role="option"]')
        .forEach((o) => o.addEventListener("click", () => (picked = o.textContent)));
    });
    const adapter = new WorkdayAdapter();
    const [combo] = adapter.detect(document).filter((f) => f.type === "combobox");
    expect(adapter.fill(combo, "No")).toBe(true);
    expect(picked).toBe("No");
  });

  it("returns false when the listbox never renders options", () => {
    document.body.innerHTML = `<button id="b" aria-haspopup="listbox" aria-controls="lb">Select</button><div id="lb" role="listbox"></div>`;
    const adapter = new WorkdayAdapter();
    const [combo] = adapter.detect(document).filter((f) => f.type === "combobox");
    expect(adapter.fill(combo, "Anything")).toBe(false);
  });

  it("prefers an exact option match over a partial (contains) match", () => {
    document.body.innerHTML = `<button id="b" aria-haspopup="listbox" aria-controls="lb">Select</button><div id="lb" role="listbox"></div>`;
    let picked = null;
    document.getElementById("b").addEventListener("click", () => {
      document.getElementById("lb").innerHTML = `<div role="option">United States Minor Outlying Islands</div><div role="option">United States</div>`;
      document
        .getElementById("lb")
        .querySelectorAll('[role="option"]')
        .forEach((o) => o.addEventListener("click", () => (picked = o.textContent.trim())));
    });
    const adapter = new WorkdayAdapter();
    const [combo] = adapter.detect(document).filter((f) => f.type === "combobox");
    expect(adapter.fill(combo, "United States")).toBe(true);
    expect(picked).toBe("United States");
  });

  it("does not double-detect a native field as a combobox", () => {
    document.body.innerHTML = `<input id="n" type="text" name="firstName">`;
    const fields = new WorkdayAdapter().detect(document);
    expect(fields.filter((f) => f.el && f.el.id === "n")).toHaveLength(1);
    expect(fields.find((f) => f.el && f.el.id === "n").type).toBe("text");
  });
});
