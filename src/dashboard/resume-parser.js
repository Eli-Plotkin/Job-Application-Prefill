// Resume parsing dispatch (§3.1, §10). Pure routing by file extension; the heavy
// PDF/DOCX text-extraction backends are injected (real ones live in
// resume-backends.js) so this stays dependency-free and unit-testable.
//
// Plain-text extraction is "good enough" as AI context (§11.3) — the blurb
// carries most of the weight; the resume is supporting detail.
export async function parseResumeFile(file, backends = {}) {
  const name = String(file.name || "").toLowerCase();

  if (name.endsWith(".txt")) {
    return (await file.text()).trim();
  }
  if (name.endsWith(".pdf")) {
    if (typeof backends.extractPdfText !== "function") {
      throw new Error("PDF parsing is unavailable.");
    }
    return (await backends.extractPdfText(await file.arrayBuffer())).trim();
  }
  if (name.endsWith(".docx")) {
    if (typeof backends.extractDocxText !== "function") {
      throw new Error("DOCX parsing is unavailable.");
    }
    return (await backends.extractDocxText(await file.arrayBuffer())).trim();
  }
  throw new Error("Unsupported file type. Upload a PDF, DOCX, or TXT file.");
}
