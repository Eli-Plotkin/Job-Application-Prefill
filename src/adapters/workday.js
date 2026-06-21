// Workday adapter (§7) — the priority target.
//
// Most Workday text fields are real <input>/<textarea> elements (handled by the
// base path), but dropdowns/multiselects are custom React widgets: a button with
// aria-haspopup="listbox" that opens a separate listbox of role="option" divs.
// Filling those means simulating the real interaction, not setting `.value`.
import { BaseAdapter } from "./base.js";
import { detectFields, resolveLabel, getFieldElement, FIELD_ID_ATTR } from "../dom/field-detector.js";
import { highlight } from "../dom/field-filler.js";

const COMBOBOX_SELECTOR =
  'button[aria-haspopup="listbox"], [role="combobox"], button[aria-haspopup="menu"]';

function simulateClick(el) {
  for (const type of ["pointerdown", "mousedown", "mouseup", "click"]) {
    el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
  }
  if (typeof el.click === "function") el.click();
}

export class WorkdayAdapter extends BaseAdapter {
  static id = "workday";

  static matches(host) {
    const h = String(host || "").toLowerCase();
    // Workday tenants are company.wdN.myworkdayjobs.com (and some myworkday.com).
    // Anchored to the end so "myworkdayjobs.com.evil.com" does NOT match.
    return /(^|\.)myworkdayjobs\.com$/.test(h) || /(^|\.)myworkday\.com$/.test(h);
  }

  detect(root = document) {
    const native = detectFields(root);
    const seen = new Set(native.map((f) => f.el));
    const comboboxes = [];
    let counter = native.length;
    for (const el of root.querySelectorAll(COMBOBOX_SELECTOR)) {
      if (seen.has(el)) continue;
      if (el.hasAttribute("hidden") || el.getAttribute("aria-hidden") === "true") continue;
      const id = `aa-field-${counter++}`;
      el.setAttribute(FIELD_ID_ATTR, id);
      comboboxes.push({
        id,
        el,
        tag: el.tagName.toLowerCase(),
        type: "combobox",
        openEnded: false,
        label: resolveLabel(el),
        autocomplete: "",
        name: el.getAttribute("name") || el.getAttribute("data-automation-id") || "",
      });
    }
    return [...native, ...comboboxes];
  }

  fill(field, value, opts = {}) {
    if (field.type === "combobox") {
      const el = field.el && field.el.isConnected ? field.el : getFieldElement(document, field.id);
      if (!el) return false;
      return fillWorkdayCombobox(el, value, opts);
    }
    return super.fill(field, value, opts);
  }
}

// Open a Workday custom combobox and click the option whose visible text matches
// `value` (exact match preferred, then case-insensitive contains).
export function fillWorkdayCombobox(buttonEl, value, { highlight: doHighlight = true } = {}) {
  simulateClick(buttonEl);

  const doc = buttonEl.ownerDocument || document;
  const controlsId = buttonEl.getAttribute("aria-controls");
  const container = (controlsId && doc.getElementById(controlsId)) || doc;
  const options = Array.from(container.querySelectorAll('[role="option"]'));
  if (options.length === 0) return false;

  const wanted = String(value).trim().toLowerCase();
  const exact = options.find((o) => o.textContent.trim().toLowerCase() === wanted);
  const partial = options.find((o) => o.textContent.trim().toLowerCase().includes(wanted));
  const option = exact || partial;
  if (!option) return false;

  simulateClick(option);
  if (doHighlight) highlight(buttonEl);
  return true;
}
