import { describe, it, expect, beforeEach, vi } from "vitest";
import { Overlay } from "../src/content/overlay.js";

beforeEach(() => {
  document.body.innerHTML = "";
});

function makeResults() {
  return [
    {
      field: { id: "f1", label: "Email", tag: "input", type: "email" },
      entry: { id: "b1", label: "Email", answer: "a@b.com" },
      status: "matched",
    },
    {
      field: { id: "f2", label: "Why do you want to work here?", tag: "textarea", type: "textarea" },
      entry: null,
      status: "unmatched",
    },
    {
      field: { id: "f3", label: "Country", tag: "select", type: "select" },
      entry: null,
      status: "unmatched",
    },
  ];
}

function q(overlay, sel) {
  return overlay.shadow.querySelectorAll(sel);
}

describe("Overlay", () => {
  it("renders one row per field with the correct status badge", () => {
    const overlay = new Overlay({});
    overlay.mount();
    overlay.render(makeResults());

    const rows = q(overlay, "[data-row]");
    expect(rows).toHaveLength(3);

    const badges = Array.from(q(overlay, "[data-badge]")).map((b) => b.textContent);
    expect(badges[0]).toMatch(/found/i);
    expect(badges[1]).toMatch(/no match/i);
  });

  it("shows a Fill button only for matched fields", () => {
    const overlay = new Overlay({});
    overlay.mount();
    overlay.render(makeResults());
    const fillButtons = q(overlay, '[data-action="fill"]');
    expect(fillButtons).toHaveLength(1);
    expect(fillButtons[0].getAttribute("data-field")).toBe("f1");
  });

  it("shows Write with AI only on unmatched free-text fields (not selects)", () => {
    const overlay = new Overlay({});
    overlay.mount();
    overlay.render(makeResults());
    const writeButtons = Array.from(q(overlay, '[data-action="write"]')).map((b) =>
      b.getAttribute("data-field"),
    );
    expect(writeButtons).toEqual(["f2"]); // textarea yes, select no
  });

  it("invokes onFillField when a Fill button is clicked", async () => {
    const onFillField = vi.fn().mockResolvedValue(true);
    const overlay = new Overlay({ onFillField });
    overlay.mount();
    overlay.render(makeResults());
    q(overlay, '[data-action="fill"]')[0].click();
    expect(onFillField).toHaveBeenCalledWith("f1");
  });

  it("invokes onFillAll when the header button is clicked", () => {
    const onFillAll = vi.fn().mockResolvedValue();
    const overlay = new Overlay({ onFillAll });
    overlay.mount();
    overlay.render(makeResults());
    overlay.shadow.querySelector('[data-action="fill-all"]').click();
    expect(onFillAll).toHaveBeenCalled();
  });

  it("invokes onWrite when Write with AI is clicked", async () => {
    const onWrite = vi.fn().mockResolvedValue("a draft");
    const overlay = new Overlay({ onWrite });
    overlay.mount();
    overlay.render(makeResults());
    q(overlay, '[data-action="write"]')[0].click();
    expect(onWrite).toHaveBeenCalledWith("f2", null);
  });

  it("reports the matched count in the Fill all button", () => {
    const overlay = new Overlay({});
    overlay.mount();
    overlay.render(makeResults());
    expect(overlay.shadow.querySelector('[data-action="fill-all"]').textContent).toMatch(/1/);
  });

  it("removes itself on destroy", () => {
    const overlay = new Overlay({});
    overlay.mount();
    expect(document.querySelector("#apply-assistant-root")).toBeTruthy();
    overlay.destroy();
    expect(document.querySelector("#apply-assistant-root")).toBeNull();
  });
});
