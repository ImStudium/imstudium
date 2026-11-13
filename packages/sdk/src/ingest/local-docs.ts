/**
 * Single local ingest pipeline — Firecrawl AnyDoc + pdf-inspector, all on this machine.
 * No API key, no cloud parsing, no Tesseract, no poppler, no LibreOffice.
 *
 *   PDF      → pdf-inspector: native text, plus on-device OCR (PP-OCRv6 via PDFium +
 *              ONNX Runtime) for the pages its quality signals reject — once
 *              `imstudium setup ocr` has installed the runtime
 *   image    → wrapped into a one-page PDF, same OCR
 *   Office   → AnyDoc toMarkdownBytes (local; never `ocr: 'hosted'`)
 *   no OCR   → image-only page markers
 */
import { Buffer } from "node:buffer";
import { imageToPdf } from "./image-pdf.js";
import { activateOcrRuntime, OCR_MODEL, ocrRuntimeStatus } from "./ocr-runtime.js";

type AnyDoc = typeof import("@firecrawl/anydoc");
type PdfInspector = typeof import("@firecrawl/pdf-inspector");

let anydocModule: Promise<AnyDoc> | null = null;
let pdfInspectorModule: Promise<PdfInspector> | null = null;

/**
 * Both engines ship native binaries. Load them on first use so a missing
 * platform build (e.g. pdf-inspector on Intel macOS) only affects extraction,
 * never login, sync or the MCP server.
 */
function loadAnydoc(): Promise<AnyDoc> {
  anydocModule ??= import("@firecrawl/anydoc");
  return anydocModule;
}

function loadPdfInspector(): Promise<PdfInspector> {
  pdfInspectorModule ??= import("@firecrawl/pdf-inspector");
  return pdfInspectorModule;
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // %PDF

function looksLikePdf(bytes: Uint8Array): boolean {
  return PDF_MAGIC.every((b, i) => bytes[i] === b);
}

export type LocalEngine = "pdf-inspector" | "pdf-inspector+ocr" | "anydoc";

export type LocalPage = {
  /** 0-based */
  index: number;
  markdown: string;
  imageOnly?: boolean;
  /** Text came (partly) from on-device OCR. */
  ocr?: { source: "Ocr" | "Fused"; confidence: number | null; low: boolean };
  /**
   * Text came from the PDF's own text layer, read through PDFium by the OCR
   * call after pdf-inspector's per-page native pass withheld it (not OCR).
   */
  recovered?: true;
  /**
   * Text came from the page's own visible text runs, ordered by position,
   * after pdf-inspector's page pass rated the page scanned (mostly a picture)
   * and withheld it; see {@link textFromPositions}. The picture is not read.
   */
  fromPositions?: true;
};

export type LocalConvertOk = {
  ok: true;
  markdown: string;
  pages: LocalPage[];
  engine: LocalEngine;
  pdfType?: string;
  pageCount: number;
  metadata: Record<string, unknown>;
};

export type LocalConvertErr = {
  ok: false;
  error: Error;
  engine?: LocalEngine;
};

export type LocalConvertResult = LocalConvertOk | LocalConvertErr;

export function toNodeBuffer(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export function isPdfFileName(fileName: string): boolean {
  return fileName.trim().toLowerCase().endsWith(".pdf");
}

export function splitMarkdownPages(markdown: string): string[] {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const ff = normalized.split(/\f+/).map((p) => p.trimEnd());
  while (ff.length > 0 && !ff[ff.length - 1]!.trim()) ff.pop();
  if (ff.length > 1) return ff;

  const hr = normalized.split(/\n-{3,}\n/).map((p) => p.trimEnd());
  while (hr.length > 0 && !hr[hr.length - 1]!.trim()) hr.pop();
  if (hr.length > 1) return hr;

  return [normalized];
}

export function joinPagesFormFeed(pages: LocalPage[]): string {
  return pages.map((p) => p.markdown.replace(/\r\n/g, "\n").trimEnd()).join("\f");
}

export const IMAGE_ONLY = "_(image-only page — no text layer)_";
export const OCR_LOW_CONFIDENCE = "_(read by OCR with low confidence — check the original)_";
/** Under a page whose text came from its positioned text runs: the picture on it is not read. */
export const MOSTLY_IMAGE = "_(mostly an image: only the page's own text is above, the image itself is not read)_";

/** What textFromPositions needs from pdf-inspector's TextItem (y is the baseline, from the page's bottom). */
export interface PositionedRun {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  itemType: unknown;
  renderMode?: number;
}

/**
 * One page's visible text runs as plain lines, top to bottom and left to
 * right, for a page pdf-inspector's page pass rated scanned although it has a
 * real text layer (a PowerPoint slide that is mostly a chart, with a title and
 * a short label). Runs whose baselines lie within half a line join one line;
 * a gap of more than 1.6 lines starts a paragraph; the top line becomes a
 * ### heading when its text is clearly the largest on the page. Left out:
 * invisible runs (render modes 3 and 7, the mode of OCR layers), runs lying on
 * an image (a scan's hidden text layer lies there; OCR reads that part), and
 * the same run repeated on the same spot (shadows). Nothing is added or
 * reworded.
 */
export function textFromPositions(runs: PositionedRun[]): string {
  const images = runs.filter((r) => String(r.itemType) === "Image");
  const onImage = (r: PositionedRun) => {
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    return images.some((i) => cx >= i.x && cx <= i.x + i.width && cy >= i.y && cy <= i.y + i.height);
  };
  const kept: PositionedRun[] = [];
  for (const r of runs) {
    if (String(r.itemType) !== "Text" || r.renderMode === 3 || r.renderMode === 7 || !r.text.trim() || onImage(r)) continue;
    const near = 0.3 * (r.fontSize || r.height || 10);
    if (kept.some((k) => k.text === r.text && Math.abs(k.x - r.x) < near && Math.abs(k.y - r.y) < near)) continue;
    kept.push(r);
  }
  if (!kept.length) return "";
  const size = (r: PositionedRun) => r.fontSize || r.height || 10;
  kept.sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Array<{ runs: PositionedRun[]; y: number; size: number }> = [];
  for (const r of kept) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - r.y) <= 0.5 * Math.min(last.size, size(r))) {
      last.runs.push(r);
      last.size = Math.max(last.size, size(r));
    } else lines.push({ runs: [r], y: r.y, size: size(r) });
  }
  const text = lines.map((l) => {
    const rs = l.runs.sort((a, b) => a.x - b.x);
    return rs.reduce((s, r, i) => (i && r.x - (rs[i - 1]!.x + rs[i - 1]!.width) > 0.1 * l.size ? `${s} ${r.text.trim()}` : `${s}${i ? r.text : r.text.trimStart()}`), "").trim();
  });
  const sizes = lines.map((l) => l.size).sort((a, b) => a - b);
  const median = sizes[Math.floor((sizes.length - 1) / 2)]!;
  const heading = lines.length > 1 && lines[0]!.size === sizes[sizes.length - 1] && lines[0]!.size >= 1.25 * median;
  return lines
    .map((l, i) => {
      const t = i === 0 && heading ? `### ${text[i]}` : text[i]!;
      if (i === 0) return t;
      const gap = lines[i - 1]!.y - l.y;
      return `${(heading && i === 1) || gap >1.6 * Math.max(l.size, lines[i - 1]!.size) ? "\n\n" : "\n"}${t}`;
    })
    .join("");
}

/** Pages below this OCR confidence get the low-confidence note. */
const LOW_CONFIDENCE = 0.6;

/**
 * Version of the rule that merges OCR results into the native pages, kept in
 * the manifest. 3: a page whose text came from its positioned runs keeps it
 * when OCR reads nothing or reads it with low confidence. 2: a page the OCR
 * call returns as native text (PDFium recovery) keeps that text; 1 dropped it
 * and left the page text-less.
 */
export const OCR_MERGE = 3;

/**
 * Version of the native page rule, kept in the manifest. 2: pages
 * pdf-inspector rates scanned get their positioned text runs
 * (textFromPositions); 1 left them image-only.
 */
export const NATIVE_RULE = 2;

/** Pages the OCR call reads: no usable text layer, or text only from positioned runs. */
const ocrTarget = (p: LocalPage) => !!p.imageOnly || !!p.fromPositions;

/** What mergeOcrPages needs from pdf-inspector's processPdfWithOcr result. */
export interface OcrPagesResult {
  pages: Array<{ pageNumber: number; markdown?: string | null; provenance: { source: unknown; ocrConfidence?: number | null; hostedRecommended?: boolean } }>;
  ocrTimeMs: number;
}

export interface ConvertOptions {
  /** false: native text only, even when the OCR runtime is installed. */
  ocr?: boolean;
}

/** OCR is used when it is installed, not switched off, and the caller allows it. */
function ocrEnabled(options: ConvertOptions): boolean {
  return options.ocr !== false && activateOcrRuntime(ocrRuntimeStatus());
}

function asError(err: unknown, fallback: string): Error {
  return err instanceof Error ? err : new Error(fallback);
}

/**
 * Native extraction for every page, then on-device OCR for exactly the pages
 * native extraction flags as having no usable text layer (`Force` on those
 * page numbers, `offline: true`: nothing is ever downloaded here), and for the
 * pages whose text only came from positioned runs (a picture with a title on
 * it: OCR may read the picture). Born-digital
 * pages keep pdf-inspector's native markdown unchanged: its OCR entry point
 * assembles native pages differently (tables lose rows in 1.25.2), so it only
 * ever sees the pages it has to read.
 */
async function convertPdfWithOcr(bytes: Uint8Array, native: LocalConvertOk): Promise<LocalConvertResult> {
  const targets = native.pages.filter(ocrTarget).map((p) => p.index);
  if (!targets.length) return mergeOcrPages(native, null);
  const { processPdfWithOcr } = await loadPdfInspector();
  const r = await processPdfWithOcr(toNodeBuffer(bytes), { mode: "Force" as never, pageNumbers: targets.map((i) => i + 1), offline: true });
  return mergeOcrPages(native, r);
}

/**
 * The native pages with the OCR call's result for the pages native extraction
 * left without text. A page comes back from that call either read by OCR
 * (`Ocr`, `Fused`) or as `Native`: pdf-inspector first reads the page's own
 * text layer through PDFium and keeps it when OCR adds nothing ("kept
 * trustworthy PDFium native recovery"). That text is the PDF's, not OCR's:
 * it is used as is, without a confidence note, and counted as recovered, not
 * as OCR. A page with text from its positioned runs keeps that text when OCR
 * reads nothing or reads it with low confidence: the PDF's own text beats an
 * unsure reading. Pages the native pass did read are never touched. `r` null:
 * no page needed OCR.
 */
export function mergeOcrPages(native: LocalConvertOk, r: OcrPagesResult | null): LocalConvertOk {
  const targets = new Set(native.pages.filter(ocrTarget).map((p) => p.index));
  const byIndex = new Map((r?.pages ?? []).map((p) => [p.pageNumber - 1, p]));
  const pages: LocalPage[] = native.pages.map((page) => {
    const p = targets.has(page.index) ? byIndex.get(page.index) : undefined;
    if (!p) return page;
    const source = String(p.provenance.source);
    const confidence = typeof p.provenance.ocrConfidence === "number" ? p.provenance.ocrConfidence : null;
    const markdown = (p.markdown ?? "").trim();
    if (source !== "Ocr" && source !== "Fused") {
      return markdown ? { index: page.index, markdown, imageOnly: false, recovered: true } : page;
    }
    const low = !!p.provenance.hostedRecommended || (confidence !== null && confidence < LOW_CONFIDENCE);
    if (page.fromPositions && (!markdown || low)) return page;
    return {
      index: page.index,
      markdown: !markdown ? IMAGE_ONLY : low ? `${markdown}\n\n${OCR_LOW_CONFIDENCE}` : markdown,
      imageOnly: !markdown,
      ocr: { source: source as "Ocr" | "Fused", confidence, low },
    };
  });
  const ocrInfo = {
    model: OCR_MODEL,
    onDevice: true,
    merge: OCR_MERGE,
    pages: pages.filter((p) => p.ocr).map((p) => p.index),
    lowConfidencePages: pages.filter((p) => p.ocr?.low).map((p) => p.index),
    recoveredPages: pages.filter((p) => p.recovered).map((p) => p.index),
    ocrTimeMs: r?.ocrTimeMs ?? 0,
  };
  return {
    ok: true,
    markdown: joinPagesFormFeed(pages),
    pages,
    engine: ocrInfo.pages.length ? "pdf-inspector+ocr" : "pdf-inspector",
    pageCount: native.pageCount,
    metadata: {
      ...native.metadata,
      engine: ocrInfo.pages.length ? "pdf-inspector+ocr" : "pdf-inspector",
      imageOnlyPages: pages.filter((p) => p.imageOnly).map((p) => p.index),
      ocr: ocrInfo,
    },
  };
}

async function convertPdf(bytes: Uint8Array, options: ConvertOptions = {}): Promise<LocalConvertResult> {
  const native = await convertPdfNative(bytes);
  if (!native.ok || !ocrEnabled(options)) return native;
  try {
    return await convertPdfWithOcr(bytes, native);
  } catch (err) {
    // A broken runtime must not cost the student the native text.
    native.metadata.ocrError = asError(err, "OCR failed").message;
    return native;
  }
}

/** OCR an image by wrapping it in a one-page PDF. null: OCR unavailable or the format can't be wrapped. */
export async function convertImage(bytes: Uint8Array, options: ConvertOptions = {}): Promise<LocalConvertResult | null> {
  if (!ocrEnabled(options)) return null;
  const pdf = imageToPdf(bytes);
  if (!pdf) return null;
  try {
    const { processPdfWithOcr } = await loadPdfInspector();
    const r = await processPdfWithOcr(pdf, { mode: "Force" as never, offline: true });
    const page = r.pages[0];
    const markdown = (page?.markdown ?? "").trim();
    const confidence = typeof page?.provenance.ocrConfidence === "number" ? page.provenance.ocrConfidence : null;
    const low = !!page && (page.provenance.hostedRecommended || (confidence !== null && confidence < LOW_CONFIDENCE));
    const text = !markdown ? "_(no text found in the image)_" : low ? `${markdown}\n\n${OCR_LOW_CONFIDENCE}` : markdown;
    return {
      ok: true,
      markdown: text,
      pages: [{ index: 0, markdown: text, imageOnly: !markdown, ocr: { source: "Ocr", confidence, low } }],
      engine: "pdf-inspector+ocr",
      pageCount: 1,
      metadata: { engine: "pdf-inspector+ocr", local: true, ocr: { model: OCR_MODEL, onDevice: true, pages: [0], lowConfidencePages: low ? [0] : [], ocrTimeMs: r.ocrTimeMs } },
    };
  } catch (err) {
    return { ok: false, error: asError(err, "OCR failed"), engine: "pdf-inspector+ocr" };
  }
}

async function convertPdfNative(bytes: Uint8Array): Promise<LocalConvertResult> {
  try {
    const { extractPagesMarkdownAsync } = await loadPdfInspector();
    const buffer = toNodeBuffer(bytes);
    const extracted = await extractPagesMarkdownAsync(buffer);
    const positioned = await scannedPagesText(
      buffer,
      extracted.pages.filter((p) => p.needsOcr && p.ocrReason === "scanned" && !(p.markdown ?? "").trim()).map((p) => p.page),
    );
    const pages: LocalPage[] = extracted.pages.map((p) => {
      const markdown = (p.markdown ?? "").trim();
      const fromPositions = !markdown ? positioned.get(p.page) : undefined;
      if (fromPositions) return { index: p.page, markdown: `${fromPositions}\n\n${MOSTLY_IMAGE}`, fromPositions: true };
      const imageOnly = p.needsOcr || !markdown;
      return {
        index: p.page,
        markdown: markdown || IMAGE_ONLY,
        imageOnly,
      };
    });
    const pageCount = pages.length || 1;
    const markdown = joinPagesFormFeed(pages);
    return {
      ok: true,
      markdown,
      pages: pages.length > 0 ? pages : [{ index: 0, markdown: IMAGE_ONLY, imageOnly: true }],
      engine: "pdf-inspector",
      pageCount,
      metadata: {
        engine: "pdf-inspector",
        local: true,
        pageCount,
        numPages: pageCount,
        imageOnlyPages: pages.filter((p) => p.imageOnly).map((p) => p.index),
        pagesWithTables: extracted.pagesWithTables,
        pagesWithColumns: extracted.pagesWithColumns,
        isComplex: extracted.isComplex,
      },
    };
  } catch (err) {
    return { ok: false, error: asError(err, "pdf-inspector failed"), engine: "pdf-inspector" };
  }
}

/**
 * Text for the pages pdf-inspector's page pass rated scanned and left empty,
 * built from their positioned text runs (0-based page → text). Empty when the
 * call fails: those pages keep the image-only marker.
 */
async function scannedPagesText(buffer: Buffer, pages: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (!pages.length) return out;
  try {
    const { extractTextWithPositionsAsync } = await loadPdfInspector();
    const items = await extractTextWithPositionsAsync(buffer, pages.map((i) => i + 1));
    for (const index of pages) {
      const text = textFromPositions(items.filter((t) => t.page === index + 1));
      if (text) out.set(index, text);
    }
  } catch {
    // keep the marker
  }
  return out;
}

async function convertAnydoc(bytes: Uint8Array, fileName: string): Promise<LocalConvertResult> {
  let mod: AnyDoc;
  try {
    mod = await loadAnydoc();
  } catch (err) {
    return { ok: false, error: asError(err, "anydoc is not installed for this platform"), engine: "anydoc" };
  }
  const { formatFromBytes, formatFromPath, toMarkdownBytes } = mod;
  const format = formatFromPath(fileName) ?? formatFromBytes(bytes) ?? undefined;
  try {
    const markdown = await toMarkdownBytes(bytes, format);
    const parts = splitMarkdownPages(markdown);
    const pages = parts.map((p, i) => ({ index: i, markdown: p }));
    return {
      ok: true,
      markdown: parts.join("\f"),
      pages,
      engine: "anydoc",
      pageCount: pages.length,
      metadata: {
        engine: "anydoc",
        local: true,
        format: format ?? null,
        pageCount: pages.length,
        numPages: pages.length,
      },
    };
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "";
    return {
      ok: false,
      error: asError(err, code ? `anydoc ${code}` : "anydoc conversion failed"),
      engine: "anydoc",
    };
  }
}

export async function convertLocalDocument(
  bytes: Uint8Array,
  fileName: string,
  options: ConvertOptions = {},
): Promise<LocalConvertResult> {
  const name = fileName.trim().split(/[/\\]/).pop() || fileName;
  if (isPdfFileName(name) || looksLikePdf(bytes)) return convertPdf(bytes, options);
  return convertAnydoc(bytes, name);
}

export async function probeLocalIngest(): Promise<{
  anydoc: boolean;
  pdfInspector: boolean;
  error?: string;
}> {
  const errors: string[] = [];
  let anydoc = false;
  let pdfInspector = false;
  try {
    const mod = await loadAnydoc();
    anydoc = Boolean(mod.formatFromPath("lecture.pptx"));
  } catch (err) {
    anydocModule = null;
    errors.push(`anydoc: ${err instanceof Error ? err.message : String(err)}`);
  }
  try {
    const mod = await loadPdfInspector();
    pdfInspector = typeof mod.extractPagesMarkdownAsync === "function";
  } catch (err) {
    pdfInspectorModule = null;
    errors.push(`pdf-inspector: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { anydoc, pdfInspector, ...(errors.length ? { error: errors.join("; ") } : {}) };
}
