// Field filling (§7). Setting `.value` on a React-controlled input is silently
// reverted unless the change goes through the native value setter and proper
// input/change events are dispatched. This module handles that generically, plus
// native <select>s. ATS-specific custom widgets are handled by adapters.

export const HIGHLIGHT_ATTR = "data-apply-assistant-filled";

function nativeValueSetter(el) {
  const proto =
    typeof HTMLTextAreaElement !== "undefined" && el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, "value");
  return desc && desc.set;
}

// Set an input/textarea value using the prototype's native setter so a
// framework-overridden instance setter (React's value tracker) can't swallow it.
export function setNativeValue(el, value) {
  const setter = nativeValueSetter(el);
  if (setter) {
    setter.call(el, value);
  } else {
    el.value = value;
  }
}

export function highlight(el) {
  el.setAttribute(HIGHLIGHT_ATTR, "true");
}

export function unhighlightAll(root = document) {
  root.querySelectorAll(`[${HIGHLIGHT_ATTR}]`).forEach((el) => el.removeAttribute(HIGHLIGHT_ATTR));
}

function dispatch(el, type) {
  el.dispatchEvent(new Event(type, { bubbles: true }));
}

// Fill a text input or textarea and notify any framework listening.
export function fillTextField(el, value, { highlight: doHighlight = true } = {}) {
  if (typeof el.focus === "function") el.focus();
  setNativeValue(el, value);
  dispatch(el, "input");
  dispatch(el, "change");
  if (typeof el.blur === "function") el.blur();
  if (doHighlight) highlight(el);
  return true;
}

// Fill a native <select> by matching an option's visible text or value
// (case-insensitive). Returns false if nothing matches.
export function fillNativeSelect(el, value, { highlight: doHighlight = true } = {}) {
  const wanted = String(value).trim().toLowerCase();
  const option = Array.from(el.options).find(
    (o) =>
      o.value.trim().toLowerCase() === wanted ||
      o.textContent.trim().toLowerCase() === wanted,
  );
  if (!option) return false;
  el.value = option.value;
  dispatch(el, "input");
  dispatch(el, "change");
  if (doHighlight) highlight(el);
  return true;
}

// Generic dispatcher: route a detected element to the right fill strategy.
export function fillField(el, value, opts = {}) {
  const tag = el.tagName ? el.tagName.toLowerCase() : "";
  if (tag === "select") return fillNativeSelect(el, value, opts);
  if (tag === "textarea" || tag === "input") return fillTextField(el, value, opts);
  // Unknown element type — let an adapter handle it.
  return false;
}
