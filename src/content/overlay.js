// In-page overlay (§3.2). Rendered in a shadow root so the page's CSS can't
// clobber it and ours can't leak out. Presents per-field status, a "Fill all
// matched" action, per-field fill, and per-field "Write with AI" / "Rewrite".
//
// The overlay is dumb about *how* things happen — all real work is delegated to
// injected callbacks (onFillAll, onFillField, onWrite, onRescan, onClose,
// onOpenDashboard). It only manages presentation and busy state.
import { isFreeText } from "../dom/field-detector.js";

// Local brand fonts, loaded from the extension's own packaged files (declared as
// web_accessible_resources). Skipped silently where chrome.runtime is absent
// (tests) — the CSS falls back to a system stack.
function fontFaceCss() {
  const get =
    typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getURL
      ? (p) => chrome.runtime.getURL(p)
      : null;
  if (!get) return "";
  return `
@font-face{font-family:"AA Hanken";src:url(${get("fonts/hanken-grotesk.woff2")}) format("woff2");font-weight:400 700;font-display:swap;}
@font-face{font-family:"AA Spectral";src:url(${get("fonts/spectral-600.woff2")}) format("woff2");font-weight:600;font-display:swap;}
@font-face{font-family:"AA Mono";src:url(${get("fonts/ibm-plex-mono-500.woff2")}) format("woff2");font-weight:500;font-display:swap;}`;
}

const STYLE = `
:host {
  all: initial;
  --paper: #ffffff;
  --ink: #111111;
  --muted: #888888;
  --line: #e2e2e6;
  --line-soft: #efefef;
  --accent: #71717a;
  --accent-ink: #ffffff;
  --accent-soft: #f4f4f5;
  --silver: #c4c4cc;
  --ok: #166534;
  --ok-soft: #dcfce7;
  --no: #991b1b;
  --no-soft: #fee2e2;
  --ui: "AA Hanken", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --serif: "AA Spectral", Georgia, serif;
  --mono: "AA Mono", ui-monospace, Menlo, monospace;
}
* { box-sizing: border-box; }

.panel {
  position: fixed; top: 18px; right: 18px; width: 350px; max-height: 84vh;
  background: var(--paper); color: var(--ink);
  font-family: var(--ui); font-size: 14px; line-height: 1.45;
  border: 1px solid var(--line); border-radius: 14px;
  box-shadow: inset 0 1px 0 var(--silver), 0 4px 16px -8px rgba(0,0,0,0.12), 0 24px 60px -22px rgba(0,0,0,0.18);
  display: flex; flex-direction: column; overflow: hidden;
  z-index: 2147483647;
  animation: aa-in .34s cubic-bezier(.22,1,.36,1) both;
}
@keyframes aa-in { from { opacity: 0; transform: translateY(-8px) scale(.98); } to { opacity: 1; transform: none; } }

.header { padding: 14px 16px 13px; border-bottom: 1px solid var(--line-soft); background:
  linear-gradient(180deg, var(--line-soft), transparent); }
.brand { display: flex; align-items: center; gap: 9px; }
.glyph {
  width: 26px; height: 26px; border-radius: 7px; flex: none;
  background: var(--ink); color: #ffffff;
  display: grid; place-items: center; font-family: var(--serif); font-size: 16px; line-height: 1;
  box-shadow: 0 0 0 1px var(--silver);
}
.brand .name { font-weight: 700; font-size: 14px; letter-spacing: -0.01em; }
.brand .x {
  margin-left: auto; cursor: pointer; border: none; background: none; color: var(--muted);
  font-size: 20px; line-height: 1; padding: 0 2px; border-radius: 6px;
}
.brand .x:hover { color: var(--ink); }
.subtitle { font-family: var(--mono); font-size: 11px; color: var(--muted); margin-top: 7px; letter-spacing: .01em; }

.actions { display: flex; gap: 8px; margin-top: 12px; }
button.btn {
  font: inherit; font-weight: 600; font-size: 12.5px; padding: 8px 12px; border-radius: 9px;
  border: 1px solid var(--ink); background: var(--ink); color: var(--accent-ink); cursor: pointer;
  transition: transform .12s ease, box-shadow .12s ease, background .15s ease, border-color .15s ease;
}
button.btn:hover { transform: translateY(-1px); box-shadow: 0 8px 16px -10px rgba(33,30,26,0.8); }
button.btn:active { transform: none; }
button.btn.ghost { background: transparent; color: var(--ink); border-color: var(--line); }
button.btn.ghost:hover { border-color: var(--ink); box-shadow: none; }
button.btn.ai { background: var(--ink); border-color: var(--ink); color: #fff; box-shadow: 0 0 0 1px var(--silver) inset; }
button.btn.small { padding: 6px 11px; font-size: 12px; border-radius: 8px; }
button.btn:disabled { opacity: .55; cursor: default; transform: none; box-shadow: none; }

.list { overflow-y: auto; padding: 6px; }
.list::-webkit-scrollbar { width: 10px; }
.list::-webkit-scrollbar-thumb { background: var(--line); border-radius: 8px; border: 3px solid var(--paper); }

.row { padding: 11px 11px 12px; border-radius: 10px; transition: background .15s ease; }
.row:hover { background: var(--line-soft); }
.row + .row { margin-top: 2px; }
.label { font-size: 13.5px; font-weight: 600; margin-bottom: 7px; word-break: break-word; line-height: 1.35; }
.meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.badge {
  font-family: var(--mono); font-size: 10.5px; font-weight: 500; letter-spacing: .02em;
  padding: 3px 9px; border-radius: 999px; display: inline-flex; align-items: center; gap: 5px;
  transition: background .2s ease, color .2s ease;
}
.badge::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; opacity: .85; }
.badge.matched { background: var(--ok-soft); color: var(--ok); }
.badge.unmatched { background: var(--no-soft); color: var(--no); }
.badge.filled { background: var(--accent-soft); color: #835012; }
.answer { font-family: var(--mono); font-size: 11.5px; color: var(--muted); margin-top: 6px; word-break: break-word; }
.answer .arrow { color: var(--accent); }
.btns { margin-top: 9px; display: flex; gap: 7px; flex-wrap: wrap; }
.guidance { margin-top: 8px; display: none; }
.guidance.open { display: block; animation: aa-in .2s ease both; }
.guidance textarea {
  width: 100%; min-height: 52px; font: inherit; font-size: 12.5px; padding: 8px 9px;
  border-radius: 8px; border: 1px solid var(--line); resize: vertical; color: var(--ink); background: #fff;
}
.guidance textarea:focus { outline: none; border-color: var(--silver); box-shadow: 0 0 0 3px var(--accent-soft); }

.empty { padding: 22px 16px; font-size: 13px; color: var(--muted); text-align: center; font-style: italic; }
.error { color: var(--no); background: var(--no-soft); font-size: 12px; padding: 10px 14px; line-height: 1.4; }
`;

function el(doc, tag, props = {}, children = []) {
  const node = doc.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("data-")) node.setAttribute(k, v);
    else node[k] = v;
  }
  for (const c of children) node.appendChild(c);
  return node;
}

export class Overlay {
  constructor(callbacks = {}, doc = document) {
    this.cb = callbacks;
    this.doc = doc;
    this.host = null;
    this.shadow = null;
    this.results = [];
  }

  mount(root = this.doc.body) {
    this.host = this.doc.createElement("div");
    this.host.id = "apply-assistant-root";
    root.appendChild(this.host);
    this.shadow = this.host.attachShadow({ mode: "open" });
    const style = this.doc.createElement("style");
    style.textContent = fontFaceCss() + STYLE;
    this.shadow.appendChild(style);
    this.container = el(this.doc, "div", { class: "panel" });
    this.shadow.appendChild(this.container);
    return this;
  }

  destroy() {
    if (this.host && this.host.parentNode) this.host.parentNode.removeChild(this.host);
    this.host = null;
    this.shadow = null;
  }

  matchedCount() {
    return this.results.filter((r) => r.status === "matched").length;
  }

  render(results) {
    this.results = results;
    this.container.textContent = "";
    this.container.appendChild(this._header());
    this.container.appendChild(this._list());
  }

  showError(message) {
    const err = el(this.doc, "div", { class: "error", text: message });
    this.container.appendChild(err);
  }

  _header() {
    const doc = this.doc;
    const x = el(doc, "button", { class: "x", text: "×", title: "Close", "data-action": "close" });
    x.addEventListener("click", () => {
      if (this.cb.onClose) this.cb.onClose();
      this.destroy();
    });
    const brand = el(doc, "div", { class: "brand" }, [
      el(doc, "span", { class: "glyph", text: "A" }),
      el(doc, "span", { class: "name", text: "Apply Assistant" }),
      x,
    ]);

    const matched = this.matchedCount();
    const subtitle = el(doc, "div", {
      class: "subtitle",
      text: `${this.results.length} fields detected · ${matched} matched`,
    });

    const fillAll = el(doc, "button", {
      class: "btn",
      "data-action": "fill-all",
      text: `Fill all matched (${matched})`,
    });
    fillAll.disabled = matched === 0;
    fillAll.addEventListener("click", () => this._run(fillAll, () => this.cb.onFillAll && this.cb.onFillAll()));

    const rescan = el(doc, "button", { class: "btn ghost", "data-action": "rescan", text: "Re-scan" });
    rescan.addEventListener("click", () => this.cb.onRescan && this.cb.onRescan());

    const dash = el(doc, "button", { class: "btn ghost", "data-action": "dashboard", text: "Dashboard" });
    dash.addEventListener("click", () => this.cb.onOpenDashboard && this.cb.onOpenDashboard());

    const actions = el(doc, "div", { class: "actions" }, [fillAll, rescan, dash]);
    return el(doc, "div", { class: "header" }, [brand, subtitle, actions]);
  }

  _list() {
    const doc = this.doc;
    if (this.results.length === 0) {
      return el(doc, "div", { class: "list" }, [
        el(doc, "div", { class: "empty", text: "No fillable fields found on this step." }),
      ]);
    }
    const list = el(doc, "div", { class: "list" });
    for (const r of this.results) list.appendChild(this._row(r));
    return list;
  }

  _row(result) {
    const doc = this.doc;
    const fieldId = result.field.id;
    const row = el(doc, "div", { class: "row", "data-row": fieldId });

    row.appendChild(el(doc, "div", { class: "label", text: result.field.label || "(unlabeled field)" }));

    const matched = result.status === "matched";
    const badge = el(doc, "span", {
      class: `badge ${matched ? "matched" : "unmatched"}`,
      "data-badge": fieldId,
      text: matched ? "Found matching question" : "No matching question",
    });
    row.appendChild(el(doc, "div", { class: "meta" }, [badge]));

    if (matched && result.entry) {
      const ans = el(doc, "div", { class: "answer" }, [
        el(doc, "span", { class: "arrow", text: "→ " }),
        el(doc, "span", { text: result.entry.answer }),
      ]);
      row.appendChild(ans);
    }

    const btns = el(doc, "div", { class: "btns" });
    if (matched) {
      const fill = el(doc, "button", { class: "btn small", "data-action": "fill", "data-field": fieldId, text: "Fill" });
      fill.addEventListener("click", () =>
        this._run(fill, async () => {
          const ok = await (this.cb.onFillField && this.cb.onFillField(fieldId));
          if (ok !== false) this._markFilled(fieldId, badge, fill);
        }),
      );
      btns.appendChild(fill);
    }

    if (!matched && isFreeText(result.field)) {
      const write = el(doc, "button", {
        class: "btn ai small",
        "data-action": "write",
        "data-field": fieldId,
        text: "Write with AI",
      });
      const guidance = this._guidanceBox(fieldId, badge);
      write.addEventListener("click", () => {
        if (write.dataset.mode === "rewrite") {
          guidance.classList.toggle("open");
          return;
        }
        this._run(write, async () => {
          await (this.cb.onWrite && this.cb.onWrite(fieldId, null));
          this._toRewrite(write, badge);
        });
      });
      btns.appendChild(write);
      row.appendChild(btns);
      row.appendChild(guidance);
      return row;
    }

    row.appendChild(btns);
    return row;
  }

  _guidanceBox(fieldId, badge) {
    const doc = this.doc;
    const ta = el(doc, "textarea", { placeholder: "Optional: how should I revise it? (e.g. shorter, more technical)" });
    const go = el(doc, "button", { class: "btn ai small", text: "Regenerate" });
    const box = el(doc, "div", { class: "guidance", "data-guidance": fieldId }, [ta, el(doc, "div", { class: "btns" }, [go])]);
    go.addEventListener("click", () =>
      this._run(go, async () => {
        await (this.cb.onWrite && this.cb.onWrite(fieldId, ta.value || ""));
        badge.className = "badge filled";
        badge.textContent = "Rewritten";
        box.classList.remove("open");
      }),
    );
    return box;
  }

  _toRewrite(writeBtn, badge) {
    writeBtn.textContent = "Rewrite";
    writeBtn.dataset.mode = "rewrite";
    writeBtn.classList.remove("ai");
    writeBtn.classList.add("ghost");
    badge.className = "badge filled";
    badge.textContent = "Drafted";
  }

  _markFilled(fieldId, badge, btn) {
    badge.className = "badge filled";
    badge.textContent = "Filled";
    btn.textContent = "Filled ✓";
  }

  // Run an async callback with a busy state on the triggering button.
  async _run(btn, fn) {
    const prev = btn.textContent;
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = "…";
    try {
      await fn();
    } catch (e) {
      btn.textContent = "Error";
      this.showError(String((e && e.message) || e));
      setTimeout(() => {
        btn.textContent = prev;
        btn.disabled = false;
      }, 1500);
      return;
    }
    btn.disabled = false;
    if (btn.textContent === "…") btn.textContent = original;
  }
}
