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

const { Extractor, shouldRedoForOcr, summarizeOcr } = await import("./extract.js");
const { IMAGE_ONLY } = await import("./ingest/local-docs.js");

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
  metadata: { engine: "pdf-inspector+ocr", ocr: { model: "pp-ocrv6-small (oar-ocr v0.7.0)", pages: [1], lowConfidencePages: [] } },
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
    expect((await manifest()).ocr).toEqual({ model: "pp-ocrv6-small (oar-ocr v0.7.0)", pages: [1], lowConfidencePages: [] });
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
    convert.mockResolvedValueOnce({ ...native(), engine: "pdf-inspector+ocr", metadata: { engine: "pdf-inspector+ocr", ocr: { model: "m", pages: [], lowConfidencePages: [] } } });
    await ex.extractFile(src, out);
    expect((await manifest()).ocr).toEqual({ model: "m", pages: [], lowConfidencePages: [] });
    expect((await ex.extractFile(src, out)).skipped).toBe(true);
    expect(convert).toHaveBeenCalledTimes(1);
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
    ["OCR already ran", { kind: "pdf", imageOnlyPages: [2], ocr: { model: "m", pages: [1], lowConfidencePages: [] } }, "", ready, undefined, false],
    ["OCR not installed", { kind: "pdf", imageOnlyPages: [2] }, "", { ready: false, disabled: false }, undefined, false],
    ["IMSTUDIUM_OCR=off", { kind: "image" }, "", { ready: true, disabled: true }, undefined, false],
    ["--no-ocr", { kind: "image" }, "", ready, false, false],
  ] as const)("%s → %s", (_label, prev, content, status, ocr, expected) => {
    expect(shouldRedoForOcr(prev as never, content, status, ocr)).toBe(expected);
  });
});

describe("summarizeOcr", () => {
  it("counts OCR files and pages of this run only", () => {
    expect(
      summarizeOcr([
        { ocrPages: [0, 3], ocrLowConfidencePages: [3], imageOnlyPages: [], mathFormulas: 2 },
        { ocrPages: [], imageOnlyPages: [1, 2], mathFormulas: 1 },
        { ocrPages: [5], skipped: true, mathFormulas: 9 },
        { error: "broken" },
      ]),
    ).toEqual({ files: 1, pages: 2, lowConfidencePages: 1, imageOnlyPages: 2, formulas: 3 });
  });
});

describe("math in the extractor", () => {
  it("withFormulas appends $$…$$ blocks under a provenance line, top to bottom", async () => {
    const { withFormulas, FORMULAS_HEADING } = await import("./extract.js");
    const text = withFormulas("Page text", [
      { page: 0, bbox: [0, 10, 5, 20], latex: "a^{2}+b^{2}=c^{2}", score: 0.9 },
      { page: 0, bbox: [0, 40, 5, 50], latex: "\\sqrt{2}", score: 0.8 },
    ]);
    expect(text).toBe(`Page text\n\n${FORMULAS_HEADING}\n\n$$a^{2}+b^{2}=c^{2}$$\n\n$$\\sqrt{2}$$`);
    expect(withFormulas("Page text", [])).toBe("Page text");
  });

  it.each([
    ["pdf with math glyphs", { kind: "pdf" }, "∑ x<sub>i</sub>", true],
    ["pdf with OCR pages", { kind: "pdf", ocr: { model: "m", pages: [1], lowConfidencePages: [] } }, "plain", true],
    ["pdf with text-less pages", { kind: "pdf", imageOnlyPages: [0] }, "", true],
    ["plain pdf", { kind: "pdf" }, "Agenda und Organisation", false],
    ["OCR'd photo", { kind: "image", ocr: { model: "m", pages: [0], lowConfidencePages: [] } }, "", true],
    ["math already ran", { kind: "pdf", math: { model: "m", layoutModel: "l", pages: [0], formulas: 0, ms: 1 } }, "∑", false],
    ["office document", { kind: "office" }, "∑", false],
  ] as const)("shouldRedoForMath: %s → %s", async (_label, prev, content, expected) => {
    const { shouldRedoForMath } = await import("./extract.js");
    expect(shouldRedoForMath(prev as never, content, { ready: true, disabled: false })).toBe(expected);
    expect(shouldRedoForMath(prev as never, content, { ready: false, disabled: false })).toBe(false);
    expect(shouldRedoForMath(prev as never, content, { ready: true, disabled: false }, { math: false })).toBe(false);
    expect(shouldRedoForMath(prev as never, content, { ready: true, disabled: false }, { ocr: false })).toBe(false);
  });
});
