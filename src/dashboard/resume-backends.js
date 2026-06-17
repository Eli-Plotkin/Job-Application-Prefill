// Real PDF/DOCX text-extraction backends, loaded as vendored assets so they are
// not bundled into the main dashboard script:
//   - pdf.js (ESM) is dynamically imported from a runtime URL.
//   - mammoth's prebuilt browser bundle is loaded via a <script> tag in
//     dashboard.html and read off `window.mammoth`.
// These run only in the real extension; resume-parser.js is tested separately.

let pdfjsPromise = null;

async function loadPdfjs() {
  if (!pdfjsPromise) {
    const url = chrome.runtime.getURL("vendor/pdf.min.mjs");
    pdfjsPromise = import(/* @vite-ignore */ url).then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("vendor/pdf.worker.min.mjs");
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

export async function extractPdfText(arrayBuffer) {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  const parts = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    parts.push(content.items.map((it) => ("str" in it ? it.str : "")).join(" "));
  }
  return parts.join("\n");
}

export async function extractDocxText(arrayBuffer) {
  if (!globalThis.mammoth) {
    throw new Error("DOCX support failed to load.");
  }
  const result = await globalThis.mammoth.extractRawText({ arrayBuffer });
  return result.value;
}

export const resumeBackends = { extractPdfText, extractDocxText };
