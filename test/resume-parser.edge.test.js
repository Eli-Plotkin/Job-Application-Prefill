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

describe("parseResumeFile — edge cases", () => {
  it("accepts uppercase extensions for all types", async () => {
    expect(await parseResumeFile(fakeFile("CV.TXT", "x"))).toBe("x");
    const pdf = vi.fn().mockResolvedValue("p");
    await parseResumeFile(fakeFile("CV.PDF"), { extractPdfText: pdf });
    expect(pdf).toHaveBeenCalled();
    const docx = vi.fn().mockResolvedValue("d");
    await parseResumeFile(fakeFile("CV.DOCX"), { extractDocxText: docx });
    expect(docx).toHaveBeenCalled();
  });

  it("trims surrounding whitespace from extracted text", async () => {
    expect(await parseResumeFile(fakeFile("a.txt", "  hi \n"))).toBe("hi");
    const pdf = vi.fn().mockResolvedValue("\n  body  \n");
    expect(await parseResumeFile(fakeFile("a.pdf"), { extractPdfText: pdf })).toBe("body");
  });

  it("returns empty string for a whitespace-only text file", async () => {
    expect(await parseResumeFile(fakeFile("a.txt", "   \n  "))).toBe("");
  });

  it("rejects unsupported and extension-less files", async () => {
    await expect(parseResumeFile(fakeFile("cv.rtf"))).rejects.toThrow(/unsupported/i);
    await expect(parseResumeFile(fakeFile("resume"))).rejects.toThrow(/unsupported/i);
    await expect(parseResumeFile(fakeFile(undefined))).rejects.toThrow(/unsupported/i);
  });

  it("propagates a backend extraction error", async () => {
    const pdf = vi.fn().mockRejectedValue(new Error("corrupt pdf"));
    await expect(parseResumeFile(fakeFile("a.pdf"), { extractPdfText: pdf })).rejects.toThrow("corrupt pdf");
  });

  it("reports a clear error when the needed backend is missing", async () => {
    await expect(parseResumeFile(fakeFile("a.pdf"), {})).rejects.toThrow(/pdf/i);
    await expect(parseResumeFile(fakeFile("a.docx"), {})).rejects.toThrow(/docx/i);
  });
});
