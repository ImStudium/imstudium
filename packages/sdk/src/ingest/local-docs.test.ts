import { describe, expect, it } from "vitest";
import { IMAGE_ONLY, joinPagesFormFeed, mergeOcrPages, OCR_LOW_CONFIDENCE, OCR_MERGE, splitMarkdownPages, type LocalConvertOk, type OcrPagesResult } from "./local-docs.js";

describe("splitMarkdownPages", () => {
  it("splits form feeds", () => {
    expect(splitMarkdownPages("page one\fpage two")).toEqual(["page one", "page two"]);
  });

  it("splits horizontal rules", () => {
    expect(splitMarkdownPages("# S1\n\nHi\n\n---\n\n# S2\n\nThere")).toHaveLength(2);
  });

  it("keeps a single page", () => {
    expect(splitMarkdownPages("# Doc\n\nHello")).toEqual(["# Doc\n\nHello"]);
  });
});

describe("joinPagesFormFeed", () => {
  it("rejoins for vault-style splitters", () => {
    const md = joinPagesFormFeed([
      { index: 0, markdown: "A" },
      { index: 1, markdown: "B" },
    ]);
    expect(splitMarkdownPages(md)).toEqual(["A", "B"]);
  });
});

describe("mergeOcrPages", () => {
  // Native pass: page 1 has text; pages 2–4 came back empty (needsOcr) and were sent to the OCR call.
  const native = (): LocalConvertOk => ({
    ok: true,
    engine: "pdf-inspector",
    pageCount: 4,
    markdown: "",
    pages: [
      { index: 0, markdown: "Native text" },
      { index: 1, markdown: IMAGE_ONLY, imageOnly: true },
      { index: 2, markdown: IMAGE_ONLY, imageOnly: true },
      { index: 3, markdown: IMAGE_ONLY, imageOnly: true },
    ],
    metadata: { engine: "pdf-inspector" },
  });
  const page = (pageNumber: number, source: string, markdown: string, ocrConfidence?: number) => ({ pageNumber, markdown, provenance: { source, ocrConfidence, hostedRecommended: false } });

  it("keeps text the OCR call recovered from the page's own text layer (source Native), as recovered, not OCR", () => {
    // What pdf-inspector 1.25.2 returned on the laptop: "kept trustworthy PDFium native recovery because OCR added no material coverage".
    const r: OcrPagesResult = {
      pages: [
        page(1, "Native", "Must never replace a page the native pass read"),
        page(2, "Native", "## Nearest-Neighbor Classifier\n\nk=2", 0.99),
        page(3, "Ocr", "Input: 9 values", 0.42),
        page(4, "Native", "  "),
      ],
      ocrTimeMs: 12,
    };
    const out = mergeOcrPages(native(), r);
    expect(out.pages[0]).toEqual({ index: 0, markdown: "Native text" });
    expect(out.pages[1]).toEqual({ index: 1, markdown: "## Nearest-Neighbor Classifier\n\nk=2", imageOnly: false, recovered: true });
    expect(out.pages[2]).toEqual({ index: 2, markdown: `Input: 9 values\n\n${OCR_LOW_CONFIDENCE}`, imageOnly: false, ocr: { source: "Ocr", confidence: 0.42, low: true } });
    expect(out.pages[3]).toEqual({ index: 3, markdown: IMAGE_ONLY, imageOnly: true });
    expect(out.metadata).toMatchObject({
      engine: "pdf-inspector+ocr",
      imageOnlyPages: [3],
      ocr: { merge: OCR_MERGE, pages: [2], lowConfidencePages: [2], recoveredPages: [1], ocrTimeMs: 12 },
    });
    expect(splitMarkdownPages(out.markdown)[1]).toContain("Nearest-Neighbor Classifier");
  });

  it("only recovered text: the engine stays pdf-inspector and no page counts as OCR", () => {
    const out = mergeOcrPages(native(), { pages: [page(2, "Native", "Input: 9 values / Output: 4 values", 1)], ocrTimeMs: 0 });
    expect(out.engine).toBe("pdf-inspector");
    expect(out.metadata.ocr).toMatchObject({ pages: [], recoveredPages: [1] });
  });

  it("no page needed OCR: native unchanged, the OCR pass still recorded", () => {
    const n = { ...native(), pages: [{ index: 0, markdown: "Native text" }], pageCount: 1 };
    const out = mergeOcrPages(n, null);
    expect(out.pages).toEqual(n.pages);
    expect(out.metadata.ocr).toMatchObject({ merge: OCR_MERGE, pages: [], recoveredPages: [] });
  });
});
