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
    expect(q(o, "[data-badge]").textContent).toMatch(/no saved answer/i);
  });

  it("reports a failed fill instead of silently claiming success", async () => {
    const onFillField = vi.fn().mockResolvedValue(false);
    const o = new Overlay({ onFillField }).mount();
    o.render([matched("f1", "Email", "a@b.com")]);
    q(o, '[data-action="fill"]').click();
    await flush();
    expect(q(o, "[data-badge]").textContent).not.toMatch(/filled/i);
    expect(q(o, "[data-badge]").textContent).toMatch(/couldn’t fill/i);
    expect(q(o, ".banner.error")).toBeTruthy();
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

describe("Overlay — Fill-all reports per-field outcomes", () => {
  it("marks the fields that took the value and flags the ones that didn't", async () => {
    const onFillAll = vi.fn().mockResolvedValue({ filled: ["f1"], failed: ["f2"] });
    const o = new Overlay({ onFillAll }).mount();
    o.render([matched("f1", "Email", "a@b.com"), matched("f2", "Country", "Narnia")]);

    q(o, '[data-action="fill-all"]').click();
    await flush();

    const badge = (id) => qa(o, "[data-badge]").find((b) => b.getAttribute("data-badge") === id).textContent;
    expect(badge("f1")).toMatch(/filled/i);
    expect(badge("f2")).toMatch(/couldn’t fill/i);
    // The failure has to be stated, not just implied by a badge the user may not re-read.
    expect(q(o, ".banner.error").textContent).toMatch(/1 field couldn’t be filled/i);
  });

  it("says nothing when every field filled cleanly", async () => {
    const onFillAll = vi.fn().mockResolvedValue({ filled: ["f1"], failed: [] });
    const o = new Overlay({ onFillAll }).mount();
    o.render([matched("f1", "Email", "a@b.com")]);

    q(o, '[data-action="fill-all"]').click();
    await flush();

    expect(q(o, "[data-badge]").textContent).toMatch(/filled/i);
    expect(q(o, ".banner.error")).toBeNull();
  });

  it("replaces a previous banner rather than stacking copies", async () => {
    const onFillAll = vi.fn().mockResolvedValue({ filled: [], failed: ["f1"] });
    const o = new Overlay({ onFillAll }).mount();
    o.render([matched("f1", "Email", "a@b.com")]);

    q(o, '[data-action="fill-all"]').click();
    await flush();
    q(o, '[data-action="fill-all"]').click();
    await flush();

    expect(qa(o, ".banner")).toHaveLength(1);
  });
});

describe("Overlay — loading state", () => {
  it("shows skeleton rows so the panel never sits blank during a scan", () => {
    const o = new Overlay({}).mount();
    o.renderLoading("Scanning this page…");
    expect(qa(o, ".skeleton").length).toBeGreaterThan(0);
    expect(q(o, ".subtitle").textContent).toBe("Scanning this page…");
    // Close stays reachable while the scan is in flight.
    expect(q(o, '[data-action="close"]')).toBeTruthy();
  });

  it("is fully replaced by the results render", () => {
    const o = new Overlay({}).mount();
    o.renderLoading();
    o.render([matched("f1", "Email", "a@b.com")]);
    expect(qa(o, ".skeleton")).toHaveLength(0);
    expect(qa(o, "[data-row]")).toHaveLength(1);
  });
});

describe("Overlay — empty answer bank", () => {
  it("blames the empty bank rather than the matcher", () => {
    const o = new Overlay({}).mount();
    o.render([unmatched("f1", "Why do you want to work here?")], { emptyBank: true });

    expect(q(o, ".guide-text").textContent).toMatch(/answer bank is empty/i);
    expect(q(o, "[data-badge]").textContent).toMatch(/no saved answers/i);
  });

  it("offers a route to the dashboard from the empty-bank guidance", () => {
    const onOpenDashboard = vi.fn();
    const o = new Overlay({ onOpenDashboard }).mount();
    o.render([unmatched("f1", "Why?")], { emptyBank: true });

    q(o, ".guide button").click();
    expect(onOpenDashboard).toHaveBeenCalled();
  });

  it("shows no guidance when the bank has entries", () => {
    const o = new Overlay({}).mount();
    o.render([unmatched("f1", "Why?")]);
    expect(q(o, ".guide")).toBeNull();
    expect(q(o, "[data-badge]").textContent).toMatch(/no saved answer for this/i);
  });
});
