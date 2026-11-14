import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalConvertOk, LocalConvertResult } from "./ingest/local-docs.js";

/**
 * The extractor's "redo when OCR would add text" rule, with the engines
 * mocked: no native code runs, and the PDF is a synthetic stand-in.
 */

const runtime = vi.hoisted(() => ({ ready: false, disabled: false }));
const convert = vi.hoisted(() => vi.fn<(bytes: Uint8Array, name: string, opts?: { ocr?: boolean }) => Promise<LocalConvertResult>>());

vi.mock("./ingest/ocr-runtime.js", async (orig) => ({
  ...(await orig<typeof import("./ingest/ocr-runtime.js")>()),
  ocrRuntimeStatus: () => ({ ...runtime, supported: true, reason: null }),
}));
vi.mock("./ingest/local-docs.js", async (orig) => ({
  ...(await orig<typeof import("./ingest/local-docs.js")>()),
  convertLocalDocument: convert,
}));

const { Extractor, nativeOutdated, shouldRedoForOcr, summarizeOcr } = await import("./extract.js");
const { IMAGE_ONLY, MOSTLY_IMAGE, NATIVE_RULE, OCR_MERGE } = await import("./ingest/local-docs.js");
const { MATH_MODEL, LAYOUT_MODEL } = await import("./ingest/math.js");

const native = (): LocalConvertOk => ({
  ok: true,
  engine: "pdf-inspector",
  pageCount: 2,
  markdown: `Page one text\f${IMAGE_ONLY}`,
  pages: [
    { index: 0, markdown: "Page one text" },
    { index: 1, markdown: IMAGE_ONLY, imageOnly: true },
  ],
  metadata: { engine: "pdf-inspector" },
});

const withOcr = (): LocalConvertOk => ({
  ok: true,
  engine: "pdf-inspector+ocr",
  pageCount: 2,
  markdown: "Page one text\fRead from the scan",
  pages: [
    { index: 0, markdown: "Page one text" },
    { index: 1, markdown: "Read from the scan", ocr: { source: "Ocr", confidence: 0.97, low: false } },
  ],
  metadata: { engine: "pdf-inspector+ocr", ocr: { model: "pp-ocrv6-small (oar-ocr v0.7.0)", merge: OCR_MERGE, pages: [1], lowConfidencePages: [] } },
});

let dir: string;
let src: string;
let out: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "imstudium-extract-"));
  src = join(dir, "Blatt.pdf");
  out = join(dir, "out");
  await writeFile(src, "%PDF-1.4 synthetic stand-in");
  runtime.ready = false;
  runtime.disabled = false;
  convert.mockReset();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const manifest = async () => JSON.parse(await readFile(join(out, "manifest.json"), "utf-8"));

describe("Extractor: redo when OCR would add text", () => {
  it("re-extracts an unchanged PDF with image-only pages once OCR is ready, then never again", async () => {
    const ex = new Extractor({ anydoc: true, pdfInspector: true });
    convert.mockResolvedValueOnce(native());
    const first = await ex.extractFile(src, out);
    expect(first.imageOnlyPages).toEqual([1]);
    expect((await manifest()).imageOnlyPages).toEqual([1]);
    expect((await manifest()).ocr).toBeUndefined();

    // Unchanged and no OCR: skipped.
    expect((await ex.extractFile(src, out)).skipped).toBe(true);

    // OCR installed: the same file is read again, this time with OCR.
    runtime.ready = true;
    convert.mockResolvedValueOnce(withOcr());
    const second = await ex.extractFile(src, out);
    expect(second.skipped).toBeUndefined();
    expect(second.ocrPages).toEqual([1]);
    expect(convert).toHaveBeenLastCalledWith(expect.any(Uint8Array), src, { ocr: undefined });
    expect((await manifest()).ocr).toEqual({ model: "pp-ocrv6-small (oar-ocr v0.7.0)", merge: OCR_MERGE, pages: [1], lowConfidencePages: [] });
    const content = await readFile(join(out, "content.md"), "utf-8");
    expect(content).toContain("Read from the scan");
    expect(content).toContain("on-device OCR on 1 page(s)");

    // OCR already ran: unchanged file stays skipped.
    expect((await ex.extractFile(src, out)).skipped).toBe(true);
    expect(convert).toHaveBeenCalledTimes(2);
  });

  it("--no-ocr (ocr: false) keeps the skip and passes the switch to the engine", async () => {
    const ex = new Extractor({ anydoc: true, pdfInspector: true });
    convert.mockResolvedValueOnce(native());
    await ex.extractFile(src, out, { ocr: false });
    expect(convert).toHaveBeenLastCalledWith(expect.any(Uint8Array), src, { ocr: false });
    runtime.ready = true;
    expect((await ex.extractFile(src, out, { ocr: false })).skipped).toBe(true);
  });

  it("an older extraction that only left the marker in content.md is redone", async () => {
    const ex = new Extractor({ anydoc: true, pdfInspector: true });
    convert.mockResolvedValueOnce(native());
    await ex.extractFile(src, out);
    const m = await manifest();
    delete m.imageOnlyPages; // as written by 0.2.0
    await writeFile(join(out, "manifest.json"), JSON.stringify(m));
    runtime.ready = true;
    convert.mockResolvedValueOnce(withOcr());
    expect((await ex.extractFile(src, out)).ocrPages).toEqual([1]);
  });

  it("an OCR pass that read no page is recorded, so the file is not redone on every sync", async () => {
    runtime.ready = true;
    const ex = new Extractor({ anydoc: true, pdfInspector: true });
    // pdf-inspector routed nothing, yet the native layer still flags page 2 as image-only.
    convert.mockResolvedValueOnce({ ...native(), engine: "pdf-inspector+ocr", metadata: { engine: "pdf-inspector+ocr", ocr: { model: "m", merge: OCR_MERGE, pages: [], lowConfidencePages: [] } } });
    await ex.extractFile(src, out);
    expect((await manifest()).ocr).toEqual({ model: "m", merge: OCR_MERGE, pages: [], lowConfidencePages: [] });
    expect((await ex.extractFile(src, out)).skipped).toBe(true);
    expect(convert).toHaveBeenCalledTimes(1);
  });

  it("text the OCR call recovered from the page's own text layer lands in content.md as recovered, not OCR; a file read under the old merge is redone once", async () => {
    runtime.ready = true;
    const ex = new Extractor({ anydoc: true, pdfInspector: true });
    // As 0.2.x-dev wrote it: OCR ran, the recovered page was dropped and stayed image-only.
    convert.mockResolvedValueOnce({ ...native(), engine: "pdf-inspector+ocr", metadata: { engine: "pdf-inspector+ocr", ocr: { model: "m", pages: [], lowConfidencePages: [] } } });
    await ex.extractFile(src, out);
    expect((await manifest()).imageOnlyPages).toEqual([1]);

    // With the current merge the same file is read again, once.
    const recovered = "Nearest-Neighbor Classifier\n\nk=2";
    convert.mockResolvedValueOnce({
      ok: true,
      engine: "pdf-inspector",
      pageCount: 2,
      markdown: `Page one text\f${recovered}`,
      pages: [
        { index: 0, markdown: "Page one text" },
        { index: 1, markdown: recovered, imageOnly: false, recovered: true },
      ],
      metadata: { engine: "pdf-inspector", ocr: { model: "m", merge: OCR_MERGE, pages: [], lowConfidencePages: [], recoveredPages: [1] } },
    });
    const again = await ex.extractFile(src, out);
    expect(again).toMatchObject({ recoveredPages: [1], ocrPages: [], imageOnlyPages: [] });
    const content = await readFile(join(out, "content.md"), "utf-8");
    expect(content).toContain("Nearest-Neighbor Classifier");
    expect(content).not.toContain(IMAGE_ONLY);
    expect(content).not.toContain("on-device OCR");
    const m = await manifest();
    expect(m.ocr).toEqual({ model: "m", merge: OCR_MERGE, pages: [], lowConfidencePages: [], recoveredPages: [1] });
    expect(m.imageOnlyPages).toBeUndefined();
    expect(summarizeOcr([again])).toMatchObject({ pages: 0, files: 0, recoveredPages: 1, imageOnlyPages: 0 });

    expect((await ex.extractFile(src, out)).skipped).toBe(true);
    expect(convert).toHaveBeenCalledTimes(2);
  });

  it("a slide pdf-inspector rated scanned gets its own text without OCR; a file extracted under the old native rule is redone once", async () => {
    const ex = new Extractor({ anydoc: true, pdfInspector: true });
    convert.mockResolvedValueOnce(native());
    await ex.extractFile(src, out);
    const m = await manifest();
    expect(m.nativeRule).toBe(NATIVE_RULE);
    delete m.nativeRule; // as written before the positioned-text fallback
    await writeFile(join(out, "manifest.json"), JSON.stringify(m));

    const slide = `### Hierarchisches Clustering\n\nDendrogramm der Iris-Daten\n\n${MOSTLY_IMAGE}`;
    convert.mockResolvedValueOnce({
      ...native(),
      markdown: `Page one text\f${slide}`,
      pages: [
        { index: 0, markdown: "Page one text" },
        { index: 1, markdown: slide, fromPositions: true as const },
      ],
    });
    const again = await ex.extractFile(src, out);
    expect(again).toMatchObject({ recoveredPages: [1], ocrPages: [], imageOnlyPages: [] });
    const content = await readFile(join(out, "content.md"), "utf-8");
    expect(content).toContain("Dendrogramm der Iris-Daten");
    expect(content).not.toContain(IMAGE_ONLY);
    expect(await manifest()).toMatchObject({ nativeRule: NATIVE_RULE });
    expect(summarizeOcr([again])).toMatchObject({ recoveredPages: 1, imageOnlyPages: 0 });

    expect((await ex.extractFile(src, out)).skipped).toBe(true);
    expect(convert).toHaveBeenCalledTimes(2);
  });

  it("keeps the native text and records the error when OCR fails", async () => {
    runtime.ready = true;
    const ex = new Extractor({ anydoc: true, pdfInspector: true });
    convert.mockResolvedValueOnce({ ...native(), metadata: { engine: "pdf-inspector", ocrError: "failed to load PDFium" } });
    await ex.extractFile(src, out);
    const m = await manifest();
    expect(m.ocrError).toBe("failed to load PDFium");
    expect(m.ocr).toBeUndefined();
  });
});

describe("shouldRedoForOcr", () => {
  const ready = { ready: true, disabled: false };
  it.each([
    ["pdf with image-only pages", { kind: "pdf", imageOnlyPages: [2] }, "", ready, undefined, true],
    ["pdf, marker only in content.md", { kind: "pdf" }, `x\n${IMAGE_ONLY}\n`, ready, undefined, true],
    ["pdf with text on every page", { kind: "pdf" }, "all text", ready, undefined, false],
    ["image", { kind: "image" }, "", ready, undefined, true],
    ["office document", { kind: "office", imageOnlyPages: [0] }, "", ready, undefined, false],
    ["OCR already ran, current merge", { kind: "pdf", imageOnlyPages: [2], ocr: { model: "m", merge: OCR_MERGE, pages: [1], lowConfidencePages: [] } }, "", ready, undefined, false],
    ["OCR ran under the merge that dropped recovered text, pages still blank", { kind: "pdf", imageOnlyPages: [2], ocr: { model: "m", pages: [1], lowConfidencePages: [] } }, "", ready, undefined, true],
    ["OCR ran under the old merge, every page has text", { kind: "pdf", ocr: { model: "m", pages: [1], lowConfidencePages: [] } }, "", ready, undefined, false],
    ["old merge, but --no-ocr", { kind: "pdf", imageOnlyPages: [2], ocr: { model: "m", pages: [1], lowConfidencePages: [] } }, "", ready, false, false],
    ["OCR not installed", { kind: "pdf", imageOnlyPages: [2] }, "", { ready: false, disabled: false }, undefined, false],
    ["IMSTUDIUM_OCR=off", { kind: "image" }, "", { ready: true, disabled: true }, undefined, false],
    ["--no-ocr", { kind: "image" }, "", ready, false, false],
  ] as const)("%s → %s", (_label, prev, content, status, ocr, expected) => {
    expect(shouldRedoForOcr(prev as never, content, status, ocr)).toBe(expected);
  });
});

describe("nativeOutdated", () => {
  it.each([
    ["old rule, a page still image-only", { kind: "pdf", imageOnlyPages: [2] }, true],
    ["old rule, every page has text", { kind: "pdf" }, false],
    ["current rule", { kind: "pdf", imageOnlyPages: [2], nativeRule: NATIVE_RULE }, false],
    ["failed extraction", { kind: "pdf", imageOnlyPages: [2], error: "broken" }, false],
    ["not a PDF", { kind: "office", imageOnlyPages: [0] }, false],
  ] as const)("%s → %s", (_label, prev, expected) => {
    expect(nativeOutdated(prev as never)).toBe(expected);
  });
});

describe("summarizeOcr", () => {
  it("counts OCR files and pages of this run only", () => {
    expect(
      summarizeOcr([
        { ocrPages: [0, 3], ocrLowConfidencePages: [3], imageOnlyPages: [], recoveredPages: [4], mathFormulas: 2, mathChecks: { checked: 1, needLook: 0, unchecked: 1 } },
        { ocrPages: [], imageOnlyPages: [1, 2], mathFormulas: 1, mathChecks: { checked: 0, needLook: 1, unchecked: 0 } },
        { ocrPages: [5], skipped: true, mathFormulas: 9, mathChecks: { checked: 9, needLook: 0, unchecked: 0 } },
        { error: "broken" },
      ]),
    ).toEqual({ files: 1, pages: 2, lowConfidencePages: 1, imageOnlyPages: 2, recoveredPages: 1, formulas: 3, formulasChecked: 1, formulasNeedLook: 1, formulasUnchecked: 1 });
  });
});

describe("math in the extractor", () => {
  it("withFormulas appends $$…$$ blocks under a provenance line, top to bottom, with a note where a formula needs a look", async () => {
    const { withFormulas, FORMULAS_HEADING } = await import("./extract.js");
    const glyphs = { missing: [], extra: [], pdf: 6 };
    const text = withFormulas("Page text", [
      { id: "p1-1", page: 0, bbox: [0, 10, 5, 20], latex: "a^{2}+b^{2}=c^{2}", score: 0.9, issues: [], glyphs, check: "match" },
      { id: "p1-2", page: 0, bbox: [0, 40, 5, 50], latex: "E=\\sum x_{i}", score: 0.8, issues: [], glyphs: { missing: ["p"], extra: [], pdf: 4 }, check: "differs", crop: "formulas/p1-2.png" },
      { id: "p1-3", page: 0, bbox: [0, 60, 5, 70], latex: "\\sqrt{2}", score: 0.8, issues: [], glyphs: null, check: "unchecked", crop: "formulas/p1-3.png" },
      {
        id: "p1-4", page: 0, bbox: [0, 80, 5, 90], latex: "x_{1}", score: 0.8, issues: [], glyphs: { missing: [], extra: ["1"], pdf: 2 }, check: "differs",
        corrected: { latex: "x^{2}", by: "claude-code", at: "2026-11-13T00:00:00Z", verdict: { issues: [], glyphs, check: "match" } },
      },
    ]);
    expect(text).toBe(
      [
        "Page text",
        "",
        FORMULAS_HEADING,
        "",
        "$$a^{2}+b^{2}=c^{2}$$",
        "",
        "$$E=\\sum x_{i}$$",
        "_(formula p1-2 needs a look: the PDF has p here, the LaTeX doesn't. Image: formulas/p1-2.png)_",
        "",
        "$$\\sqrt{2}$$",
        "_(formula p1-3 unchecked: no text on the page to compare with. Image: formulas/p1-3.png)_",
        "",
        "$$x^{2}$$",
        "_(formula p1-4 corrected by claude-code from its image; its letters and digits match the PDF.)_",
      ].join("\n"),
    );
    expect(withFormulas("Page text", [])).toBe("Page text");
  });

  it.each([
    ["pdf with math glyphs", { kind: "pdf" }, "∑ x<sub>i</sub>", true],
    ["pdf with OCR pages", { kind: "pdf", ocr: { model: "m", pages: [1], lowConfidencePages: [] } }, "plain", true],
    ["pdf with text-less pages", { kind: "pdf", imageOnlyPages: [0] }, "", true],
    ["plain pdf", { kind: "pdf" }, "Agenda und Organisation", false],
    ["OCR'd photo", { kind: "image", ocr: { model: "m", pages: [0], lowConfidencePages: [] } }, "", true],
    ["math already ran with these models and the decision model", { kind: "pdf", math: { model: MATH_MODEL, layoutModel: LAYOUT_MODEL, pages: [0], formulas: 0, ms: 1, decision: 1 } }, "∑", false],
    ["math ran with these models, one reading per box", { kind: "pdf", math: { model: MATH_MODEL, layoutModel: LAYOUT_MODEL, pages: [0], formulas: 0, ms: 1 } }, "∑", true],
    ["math ran with older models", { kind: "pdf", math: { model: "m", layoutModel: "l", pages: [0], formulas: 0, ms: 1 } }, "∑", true],
    ["office document", { kind: "office" }, "∑", false],
  ] as const)("shouldRedoForMath: %s → %s", async (_label, prev, content, expected) => {
    const { shouldRedoForMath } = await import("./extract.js");
    expect(shouldRedoForMath(prev as never, content, { ready: true, disabled: false })).toBe(expected);
    expect(shouldRedoForMath(prev as never, content, { ready: false, disabled: false })).toBe(false);
    expect(shouldRedoForMath(prev as never, content, { ready: true, disabled: false }, { math: false })).toBe(false);
    expect(shouldRedoForMath(prev as never, content, { ready: true, disabled: false }, { ocr: false })).toBe(false);
  });
});
