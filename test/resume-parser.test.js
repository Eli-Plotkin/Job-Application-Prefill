import { describe, it, expect, vi } from "vitest";
import { parseResumeFile } from "../src/dashboard/resume-parser.js";

function fakeFile(name, text = "") {
  return {
    name,
    async text() {
      return text;
    },
    async arrayBuffer() {
      return new TextEncoder().encode(text).buffer;
    },
  };
}

describe("parseResumeFile", () => {
  it("reads plain-text resumes directly", async () => {
    const out = await parseResumeFile(fakeFile("cv.txt", "  plain text resume  "));
    expect(out).toBe("plain text resume");
  });

  it("routes PDFs to the PDF backend", async () => {
    const extractPdfText = vi.fn().mockResolvedValue("pdf text");
    const out = await parseResumeFile(fakeFile("cv.pdf"), { extractPdfText });
    expect(extractPdfText).toHaveBeenCalled();
    expect(out).toBe("pdf text");
  });

  it("routes DOCX to the DOCX backend", async () => {
    const extractDocxText = vi.fn().mockResolvedValue("docx text");
    const out = await parseResumeFile(fakeFile("cv.docx"), { extractDocxText });
    expect(extractDocxText).toHaveBeenCalled();
    expect(out).toBe("docx text");
  });

  it("is case-insensitive about the extension", async () => {
    const extractPdfText = vi.fn().mockResolvedValue("x");
    await parseResumeFile(fakeFile("CV.PDF"), { extractPdfText });
    expect(extractPdfText).toHaveBeenCalled();
  });

  it("throws on an unsupported file type", async () => {
    await expect(parseResumeFile(fakeFile("cv.rtf"))).rejects.toThrow(/unsupported/i);
  });

  it("throws a clear error when the backend for a type is missing", async () => {
    await expect(parseResumeFile(fakeFile("cv.pdf"), {})).rejects.toThrow(/pdf/i);
  });
});
