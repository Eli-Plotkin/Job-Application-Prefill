// Field detection + robust label resolution (§7).
//
// Workday gives custom questions generic auto-generated ids and puts the real
// meaning only in the visible label, so labels must be resolved from the full
// range of associations (label[for], aria-labelledby, aria-label, wrapping
// label) before falling back to placeholder/name.

export const FIELD_ID_ATTR = "data-apply-assistant-id";

const TEXT_INPUT_TYPES = new Set([
  "text",
  "email",
  "tel",
  "url",
  "search",
  "number",
  "",
]);

const EXCLUDED_INPUT_TYPES = new Set([
  "hidden",
  "submit",
  "button",
  "reset",
  "image",
  "file",
  "password",
  "checkbox",
  "radio",
]);

function collapse(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

// CSS.escape with a fallback for environments that don't expose it (e.g. jsdom).
function cssEscape(value) {
  const g = typeof globalThis !== "undefined" ? globalThis : undefined;
  if (g && g.CSS && typeof g.CSS.escape === "function") return g.CSS.escape(value);
  return String(value).replace(/["\\\]]/g, "\\$&");
}

function prettifyName(name) {
  return collapse(
    String(name || "")
      .replace(/[_\-.]+/g, " ")
      .replace(/([a-z])([A-Z])/g, "$1 $2"),
  );
}

// Resolve the human-visible label for a control, most reliable source first.
export function resolveLabel(el) {
  const labelledby = el.getAttribute("aria-labelledby");
  if (labelledby) {
    const text = labelledby
      .split(/\s+/)
      .map((id) => {
        const node = el.ownerDocument.getElementById(id);
        return node ? collapse(node.textContent) : "";
      })
      .filter(Boolean)
      .join(" ");
    if (text) return collapse(text);
  }

  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel && collapse(ariaLabel)) return collapse(ariaLabel);

  if (el.id) {
    const forLabel = el.ownerDocument.querySelector(`label[for="${cssEscape(el.id)}"]`);
    if (forLabel) return collapse(forLabel.textContent);
  }

  const wrapping = el.closest("label");
  if (wrapping) {
    // Remove the control's own text contribution (e.g. option text) heuristically.
    const text = collapse(wrapping.textContent);
    if (text) return text;
  }

  const placeholder = el.getAttribute("placeholder");
  if (placeholder && collapse(placeholder)) return collapse(placeholder);

  return prettifyName(el.getAttribute("name") || el.id || "");
}

function isVisible(el) {
  if (el.disabled) return false;
  if (el.hasAttribute("hidden")) return false;
  if (el.getAttribute("aria-hidden") === "true") return false;
  const style = el.getAttribute("style") || "";
  if (/display\s*:\s*none/i.test(style) || /visibility\s*:\s*hidden/i.test(style)) return false;
  if (el.closest("[hidden]")) return false;
  return true;
}

function fieldType(el) {
  const tag = el.tagName.toLowerCase();
  if (tag === "textarea") return "textarea";
  if (tag === "select") return "select";
  return (el.getAttribute("type") || "text").toLowerCase();
}

function isFillable(el) {
  const tag = el.tagName.toLowerCase();
  if (tag === "textarea" || tag === "select") return isVisible(el);
  if (tag === "input") {
    const type = (el.getAttribute("type") || "text").toLowerCase();
    if (EXCLUDED_INPUT_TYPES.has(type)) return false;
    if (!TEXT_INPUT_TYPES.has(type)) return false;
    return isVisible(el);
  }
  return false;
}

// Scan a root for fillable fields, returning descriptors with a stable id that
// is also written back onto each element so the overlay and fill steps can find
// it again later.
export function detectFields(root = document) {
  const candidates = root.querySelectorAll("input, textarea, select");
  const fields = [];
  let counter = 0;
  for (const el of candidates) {
    if (!isFillable(el)) continue;
    const id = `aa-field-${counter++}`;
    el.setAttribute(FIELD_ID_ATTR, id);
    const tag = el.tagName.toLowerCase();
    const type = fieldType(el);
    fields.push({
      id,
      el,
      tag,
      type,
      openEnded: tag === "textarea",
      label: resolveLabel(el),
      autocomplete: collapse(el.getAttribute("autocomplete") || ""),
      name: el.getAttribute("name") || "",
    });
  }
  return fields;
}

// Look an element back up by the synthetic id assigned during detection.
export function getFieldElement(root, id) {
  return root.querySelector(`[${FIELD_ID_ATTR}="${cssEscape(id)}"]`);
}

// True for fields that should offer "Write with AI" (free-text only).
export function isFreeText(field) {
  return field.tag === "textarea" || (field.tag === "input" && TEXT_INPUT_TYPES.has(field.type));
}
