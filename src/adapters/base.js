// Base ATS adapter (§7). The field-detection + fill layer is built as an adapter
// so Greenhouse/Lever/Ashby adapters can be added later without rewriting core
// logic. The base adapter handles standard native HTML forms.
import { detectFields, getFieldElement, resolveLabel } from "../dom/field-detector.js";
import { fillField } from "../dom/field-filler.js";

export class BaseAdapter {
  static id = "base";

  // Any host — base is the universal fallback.
  static matches() {
    return true;
  }

  // Return detected field descriptors for the given root.
  detect(root = document) {
    return detectFields(root);
  }

  // Fill a single detected field. `field` is a descriptor from detect();
  // `field.el` is re-resolved from the DOM in case the node was replaced.
  fill(field, value, opts = {}) {
    const el = field.el && field.el.isConnected ? field.el : getFieldElement(document, field.id);
    if (!el) return false;
    return fillField(el, value, opts);
  }

  // Re-resolve a label for a descriptor (used when re-scanning).
  labelFor(el) {
    return resolveLabel(el);
  }
}
