// Dashboard logic (§3.1, §6). Wires the options page UI to chrome.storage.local
// via the storage wrapper. Vanilla DOM — no framework.
import {
  getSettings,
  setSettings,
  getResume,
  setResume,
  getBlurb,
  setBlurb,
  getAnswerBank,
  setAnswerBank,
  getSpendLog,
  exportAll,
  importAll,
  newId,
} from "../lib/storage.js";
import { parseResumeFile } from "./resume-parser.js";
import { resumeBackends } from "./resume-backends.js";

const $ = (id) => document.getElementById(id);

let toastTimer = null;
function toast(message, isError = false) {
  const t = $("toast");
  t.textContent = message;
  t.classList.toggle("error", isError);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2600);
}

function flashSaved(id) {
  const node = $(id);
  if (!node) return;
  node.textContent = "Saved";
  setTimeout(() => (node.textContent = ""), 1200);
}

function debounce(fn, ms) {
  let h;
  return (...args) => {
    clearTimeout(h);
    h = setTimeout(() => fn(...args), ms);
  };
}

// ---- Resume ----------------------------------------------------------------
async function renderResume() {
  const { text, fileName } = await getResume();
  const status = $("resume-status");
  const previewWrap = $("resume-preview-wrap");
  if (text) {
    status.textContent = `${fileName || "resume"} — used as AI context (${text.length.toLocaleString()} chars)`;
    status.classList.add("has-file");
    $("resume-button-label").textContent = "Replace resume";
    $("resume-preview").textContent = text.slice(0, 4000);
    previewWrap.hidden = false;
  } else {
    status.textContent = "No resume uploaded.";
    status.classList.remove("has-file");
    $("resume-button-label").textContent = "Upload resume";
    previewWrap.hidden = true;
  }
}

async function onResumeFile(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  toast("Parsing resume…");
  try {
    const text = await parseResumeFile(file, resumeBackends);
    if (!text) throw new Error("Could not extract any text from that file.");
    await setResume({ text, fileName: file.name });
    await renderResume();
    toast("Resume saved.");
  } catch (err) {
    toast(String(err.message || err), true);
  } finally {
    e.target.value = "";
  }
}

async function onResumeClear() {
  await setResume({ text: "", fileName: "" });
  await renderResume();
  toast("Resume removed.");
}

// ---- Blurb -----------------------------------------------------------------
async function renderBlurb() {
  $("blurb").value = await getBlurb();
}
const saveBlurb = debounce(async (value) => {
  await setBlurb(value);
  flashSaved("blurb-saved");
}, 500);

// ---- Answer bank -----------------------------------------------------------
let answerBank = [];

const STARTER_ROWS = [
  { label: "First name", answer: "" },
  { label: "Last name", answer: "" },
  { label: "Email", answer: "" },
  { label: "Phone", answer: "" },
  { label: "LinkedIn", answer: "" },
  { label: "GitHub", answer: "" },
  { label: "Authorized to work in the US?", answer: "Yes" },
  { label: "Require visa sponsorship?", answer: "No" },
  { label: "Willing to relocate?", answer: "Yes — SF, NYC, Seattle" },
  { label: "How did you hear about us?", answer: "Company website" },
];

const persistAnswers = debounce(async () => {
  await setAnswerBank(answerBank);
}, 400);

function renderAnswerBank() {
  const list = $("answer-list");
  list.textContent = "";
  $("answer-empty").hidden = answerBank.length > 0;

  answerBank.forEach((entry) => {
    const row = document.createElement("div");
    row.className = "answer-row";

    const label = document.createElement("input");
    label.type = "text";
    label.placeholder = "Question / label";
    label.value = entry.label;
    label.addEventListener("input", () => {
      entry.label = label.value;
      persistAnswers();
    });

    const answer = document.createElement("input");
    answer.type = "text";
    answer.placeholder = "Saved answer";
    answer.value = entry.answer;
    answer.addEventListener("input", () => {
      entry.answer = answer.value;
      persistAnswers();
    });

    const del = document.createElement("button");
    del.className = "btn danger del";
    del.type = "button";
    del.textContent = "Delete";
    del.addEventListener("click", async () => {
      answerBank = answerBank.filter((x) => x.id !== entry.id);
      await setAnswerBank(answerBank);
      renderAnswerBank();
    });

    row.append(label, answer, del);
    list.appendChild(row);
  });
}

async function addAnswer(label = "", answer = "") {
  answerBank.push({ id: newId(), label, answer });
  await setAnswerBank(answerBank);
  renderAnswerBank();
}

async function seedAnswers() {
  for (const r of STARTER_ROWS) answerBank.push({ id: newId(), ...r });
  await setAnswerBank(answerBank);
  renderAnswerBank();
  toast("Starter examples added.");
}

// ---- Settings --------------------------------------------------------------
async function renderSettings() {
  const s = await getSettings();
  $("api-key").value = s.apiKey;
  $("match-model").value = s.matchModel;
  $("draft-model").value = s.draftModel;
  $("threshold").value = s.matchConfidenceThreshold;
  $("highlight").checked = s.highlightFilled;
}

const saveSettings = debounce(async () => {
  const threshold = parseFloat($("threshold").value);
  await setSettings({
    apiKey: $("api-key").value.trim(),
    matchModel: $("match-model").value.trim(),
    draftModel: $("draft-model").value.trim(),
    matchConfidenceThreshold: Number.isFinite(threshold) ? Math.min(1, Math.max(0, threshold)) : 0.6,
    highlightFilled: $("highlight").checked,
  });
  flashSaved("settings-saved");
}, 400);

// ---- Spend -----------------------------------------------------------------
function formatUsd(usd) {
  if (usd < 0.01) return usd === 0 ? "$0.00" : "< $0.01";
  return "$" + usd.toFixed(usd >= 1 ? 2 : 4);
}

async function renderSpend() {
  const log = await getSpendLog();
  $("spend-weekly").textContent = formatUsd(log.weeklyUsd);
  $("spend-lifetime").textContent = formatUsd(log.lifetimeUsd);
}

// ---- Backup ----------------------------------------------------------------
async function onExport() {
  const payload = await exportAll();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `apply-assistant-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast("Exported.");
}

async function onImport(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    await importAll(payload);
    await reloadAll();
    toast("Imported.");
  } catch (err) {
    toast("Import failed: " + String(err.message || err), true);
  } finally {
    e.target.value = "";
  }
}

// ---- Init ------------------------------------------------------------------
async function reloadAll() {
  answerBank = await getAnswerBank();
  await Promise.all([renderResume(), renderBlurb(), renderSettings(), renderSpend()]);
  renderAnswerBank();
}

function wire() {
  $("resume-file").addEventListener("change", onResumeFile);
  $("resume-clear").addEventListener("click", onResumeClear);
  $("blurb").addEventListener("input", (e) => saveBlurb(e.target.value));
  $("answer-add").addEventListener("click", () => addAnswer());
  $("answer-seed").addEventListener("click", seedAnswers);
  for (const id of ["api-key", "match-model", "draft-model", "threshold", "highlight"]) {
    $(id).addEventListener("input", saveSettings);
    $(id).addEventListener("change", saveSettings);
  }
  $("export").addEventListener("click", onExport);
  $("import-file").addEventListener("change", onImport);
}

wire();
reloadAll();
