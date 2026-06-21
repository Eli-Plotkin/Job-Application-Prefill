import { describe, it, expect, beforeEach, vi } from "vitest";
import { Overlay } from "../src/content/overlay.js";

beforeEach(() => {
  document.body.innerHTML = "";
});

const flush = () => new Promise((r) => setTimeout(r));
const q = (o, sel) => o.shadow.querySelector(sel);
const qa = (o, sel) => Array.from(o.shadow.querySelectorAll(sel));

const matched = (id, label, ans, over = {}) => ({
  field: { id, label, tag: "input", type: "text", ...over },
  entry: { id: "b-" + id, label, answer: ans },
  status: "matched",
});
const unmatched = (id, label, over = {}) => ({
  field: { id, label, tag: "textarea", type: "textarea", ...over },
  entry: null,
  status: "unmatched",
});

describe("Overlay — empty & disabled states", () => {
  it("shows an empty state and disables Fill-all when nothing was detected", () => {
    const o = new Overlay({}).mount();
    o.render([]);
    expect(q(o, ".empty")).toBeTruthy();
    const fillAll = q(o, '[data-action="fill-all"]');
    expect(fillAll.disabled).toBe(true);
    expect(fillAll.textContent).toContain("0");
    expect(q(o, ".subtitle").textContent).toMatch(/0 fields detected · 0 matched/);
  });

  it("reports detected and matched counts in the subtitle", () => {
    const o = new Overlay({}).mount();
    o.render([matched("f1", "Email", "a@b.com"), unmatched("f2", "Why?")]);
    expect(q(o, ".subtitle").textContent).toMatch(/2 fields detected · 1 matched/);
  });
});

describe("Overlay — per-field controls", () => {
  it("shows Fill (not Write) for a matched free-text field", () => {
    const o = new Overlay({}).mount();
    o.render([matched("f1", "Cover letter", "...", { tag: "textarea", type: "textarea" })]);
    expect(qa(o, '[data-action="fill"]')).toHaveLength(1);
    expect(qa(o, '[data-action="write"]')).toHaveLength(0);
  });

  it("shows neither Fill nor Write for an unmatched select", () => {
    const o = new Overlay({}).mount();
    o.render([{ field: { id: "f", label: "Country", tag: "select", type: "select" }, entry: null, status: "unmatched" }]);
    expect(qa(o, '[data-action="fill"]')).toHaveLength(0);
    expect(qa(o, '[data-action="write"]')).toHaveLength(0);
    expect(q(o, "[data-badge]").textContent).toMatch(/no match/i);
  });

  it("does not flip the badge to Filled when onFillField resolves false", async () => {
    const onFillField = vi.fn().mockResolvedValue(false);
    const o = new Overlay({ onFillField }).mount();
    o.render([matched("f1", "Email", "a@b.com")]);
    q(o, '[data-action="fill"]').click();
    await flush();
    expect(q(o, "[data-badge]").textContent).toMatch(/found matching/i);
  });
});

describe("Overlay — Write → Rewrite → Regenerate flow", () => {
  it("drives the full drafting interaction", async () => {
    const onWrite = vi.fn().mockResolvedValue("a draft");
    const o = new Overlay({ onWrite }).mount();
    o.render([unmatched("f2", "Why do you want to work here?")]);

    const write = q(o, '[data-action="write"]');
    expect(write.textContent).toBe("Write with AI");

    // First click → draft (guidance = null), button becomes Rewrite.
    write.click();
    await flush();
    expect(onWrite).toHaveBeenCalledWith("f2", null);
    expect(write.textContent).toBe("Rewrite");
    expect(write.dataset.mode).toBe("rewrite");
    expect(q(o, "[data-badge]").textContent).toBe("Drafted");

    // Second click → opens the guidance box.
    const guidance = q(o, '[data-guidance="f2"]');
    expect(guidance.classList.contains("open")).toBe(false);
    write.click();
    expect(guidance.classList.contains("open")).toBe(true);

    // Type guidance and Regenerate → onWrite called with the guidance text.
    const ta = guidance.querySelector("textarea");
    ta.value = "make it shorter";
    guidance.querySelector("button").click();
    await flush();
    expect(onWrite).toHaveBeenLastCalledWith("f2", "make it shorter");
    expect(q(o, "[data-badge]").textContent).toBe("Rewritten");
    expect(guidance.classList.contains("open")).toBe(false);
  });
});

describe("Overlay — error handling & lifecycle", () => {
  it("surfaces a callback error on the button, then restores it", async () => {
    vi.useFakeTimers();
    const onFillAll = vi.fn().mockRejectedValue(new Error("boom"));
    const o = new Overlay({ onFillAll }).mount();
    o.render([matched("f1", "Email", "a@b.com")]);
    const fillAll = q(o, '[data-action="fill-all"]');
    const original = fillAll.textContent;

    fillAll.click();
    await vi.advanceTimersByTimeAsync(0); // flush rejection
    expect(fillAll.textContent).toBe("Error");
    expect(q(o, ".error").textContent).toMatch(/boom/);

    await vi.advanceTimersByTimeAsync(1600); // reset timer
    expect(fillAll.textContent).toBe(original);
    expect(fillAll.disabled).toBe(false);
    vi.useRealTimers();
  });

  it("invokes onOpenDashboard from the Dashboard button", () => {
    const onOpenDashboard = vi.fn();
    const o = new Overlay({ onOpenDashboard }).mount();
    o.render([]);
    q(o, '[data-action="dashboard"]').click();
    expect(onOpenDashboard).toHaveBeenCalled();
  });

  it("closes via the × button and calls onClose", () => {
    const onClose = vi.fn();
    const o = new Overlay({ onClose }).mount();
    o.render([]);
    q(o, '[data-action="close"]').click();
    expect(onClose).toHaveBeenCalled();
    expect(document.getElementById("apply-assistant-root")).toBeNull();
  });

  it("can be destroyed twice without throwing", () => {
    const o = new Overlay({}).mount();
    o.render([]);
    expect(() => {
      o.destroy();
      o.destroy();
    }).not.toThrow();
  });
});
