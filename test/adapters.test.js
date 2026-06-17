import { describe, it, expect, beforeEach } from "vitest";
import { BaseAdapter } from "../src/adapters/base.js";
import { WorkdayAdapter } from "../src/adapters/workday.js";
import { getAdapter } from "../src/adapters/registry.js";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("registry", () => {
  it("selects the Workday adapter on a Workday tenant host", () => {
    expect(getAdapter("acme.wd5.myworkdayjobs.com")).toBeInstanceOf(WorkdayAdapter);
  });

  it("falls back to the base adapter elsewhere", () => {
    const a = getAdapter("boards.greenhouse.io");
    expect(a).toBeInstanceOf(BaseAdapter);
    expect(a).not.toBeInstanceOf(WorkdayAdapter);
  });
});

describe("BaseAdapter", () => {
  it("detects native fields and fills them", () => {
    document.body.innerHTML = `<label for="e">Email</label><input id="e" type="email">`;
    const adapter = new BaseAdapter();
    const fields = adapter.detect(document);
    expect(fields).toHaveLength(1);
    const ok = adapter.fill(fields[0], "a@b.com");
    expect(ok).toBe(true);
    expect(document.getElementById("e").value).toBe("a@b.com");
  });
});

describe("WorkdayAdapter", () => {
  it("matches Workday tenant hostnames", () => {
    expect(WorkdayAdapter.matches("acme.wd1.myworkdayjobs.com")).toBe(true);
    expect(WorkdayAdapter.matches("jobs.lever.co")).toBe(false);
  });

  it("detects a custom listbox combobox as a fillable field with its label", () => {
    document.body.innerHTML = `
      <label id="lbl">Country</label>
      <button aria-labelledby="lbl" aria-haspopup="listbox" aria-controls="lb">Select One</button>
      <div id="lb" role="listbox"></div>`;
    const adapter = new WorkdayAdapter();
    const fields = adapter.detect(document);
    const combo = fields.find((f) => f.type === "combobox");
    expect(combo).toBeTruthy();
    expect(combo.label).toBe("Country");
  });

  it("fills a custom combobox by opening it and clicking the matching option", () => {
    document.body.innerHTML = `
      <label id="lbl">Country</label>
      <button id="btn" aria-labelledby="lbl" aria-haspopup="listbox" aria-controls="lb">Select One</button>
      <div id="lb" role="listbox"></div>`;
    const btn = document.getElementById("btn");
    const lb = document.getElementById("lb");
    // Simulate Workday rendering options into the listbox when the button is clicked.
    let selected = null;
    btn.addEventListener("click", () => {
      lb.innerHTML = `
        <div role="option">United States</div>
        <div role="option">Canada</div>`;
      lb.querySelectorAll('[role="option"]').forEach((opt) =>
        opt.addEventListener("click", () => {
          selected = opt.textContent.trim();
          btn.textContent = selected;
        }),
      );
    });

    const adapter = new WorkdayAdapter();
    const [combo] = adapter.detect(document).filter((f) => f.type === "combobox");
    const ok = adapter.fill(combo, "Canada");
    expect(ok).toBe(true);
    expect(selected).toBe("Canada");
    expect(btn.textContent).toBe("Canada");
  });

  it("returns false when no option matches the combobox value", () => {
    document.body.innerHTML = `
      <label id="lbl">Country</label>
      <button id="btn" aria-labelledby="lbl" aria-haspopup="listbox" aria-controls="lb">Select One</button>
      <div id="lb" role="listbox"></div>`;
    document.getElementById("btn").addEventListener("click", () => {
      document.getElementById("lb").innerHTML = `<div role="option">France</div>`;
    });
    const adapter = new WorkdayAdapter();
    const [combo] = adapter.detect(document).filter((f) => f.type === "combobox");
    expect(adapter.fill(combo, "Germany")).toBe(false);
  });

  it("still fills native Workday text inputs through the generic path", () => {
    document.body.innerHTML = `<input id="n" type="text" data-automation-id="legalNameSection_firstName">`;
    const adapter = new WorkdayAdapter();
    const field = adapter.detect(document).find((f) => f.tag === "input");
    expect(adapter.fill(field, "Eli")).toBe(true);
    expect(document.getElementById("n").value).toBe("Eli");
  });
});
