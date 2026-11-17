import { createHash } from "node:crypto";
import { cp, lstat, mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { ensureDir, slugify } from "./config.js";
import { convertImage, convertLocalDocument, IMAGE_ONLY, NATIVE_RULE, OCR_MERGE, probeLocalIngest, type LocalConvertOk } from "./ingest/local-docs.js";
import { imageToPdf } from "./ingest/image-pdf.js";
import { isMathCandidate, LAYOUT_MODEL, MATH_DECISION, MATH_MODEL, mathRuntimeStatus, recognizeMath, type Formula, type MathRuntimeStatus } from "./ingest/math.js";
import { ocrRuntimeStatus, type OcrRuntimeStatus } from "./ingest/ocr-runtime.js";
import { FFMPEG_HINT, resetSpeechEngine, SPEECH_ENGINE, SPEECH_MODEL, SPEECH_VAD, speechRuntimeStatus, transcribeMedia, type SpeechRuntimeStatus } from "./ingest/speech.js";
import { MEDIA_EXT, readTranscript, renderTranscriptMd, transcriptSections, writeTranscript, type TranscriptDoc } from "./ingest/transcript.js";
import { applyFormulaFixes, formulaNote, readFormulaFixes, type FormulaEntry } from "./formulas.js";
import { buildCourseSearchIndex } from "./search-corpus.js";
import type { ExtractManifest, ExtractMathInfo, ExtractOcrInfo, ExtractResult, ExtractTranscriptInfo, MaterialKind, StudiumCourse } from "./types.js";

const PDF_EXT = new Set([".pdf"]);
const OFFICE_EXT = new Set([
  ".pptx", ".ppt", ".odp",
  ".docx", ".doc", ".odt", ".rtf",
  ".xlsx", ".xls", ".ods",
  ".epub",
]);
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".tiff"]);
const TEXT_EXT = new Set([
  ".md", ".txt", ".csv", ".tsv", ".json", ".xml", ".html", ".htm", ".tex",
  ".py", ".java", ".c", ".cpp", ".h", ".js", ".ts", ".r", ".sql", ".sh", ".ipynb", ".log",
]);

export function detectKind(filename: string): MaterialKind {
  const ext = extname(filename).toLowerCase();
  if (PDF_EXT.has(ext)) return "pdf";
  if (OFFICE_EXT.has(ext)) return "office";
  if (IMAGE_EXT.has(ext)) return "image";
  if (TEXT_EXT.has(ext)) return "text";
  if (MEDIA_EXT.has(ext)) return "media";
  return "unsupported";
}

/** Options every extraction takes (one file or a course folder). */
export interface ExtractOptions {
  images?: boolean;
  dpi?: number;
  force?: boolean;
  /** false: native text only, even with the OCR runtime installed (no math either). */
  ocr?: boolean;
  /** false: no formula recognition, even with the math runtime installed. */
  math?: boolean;
  /** false: no speech recognition, even with the speech runtime installed; a matching transcript.json is still rendered. */
  transcribe?: boolean;
  /** Progress of long steps (a recording being transcribed). */
  onProgress?: (message: string) => void;
}

export interface ExtractTools {
  anydoc?: boolean;
  pdfInspector?: boolean;
}

export async function detectTools(): Promise<ExtractTools> {
  const local = await probeLocalIngest();
  return { anydoc: local.anydoc, pdfInspector: local.pdfInspector };
}

export function toolHints(tools: ExtractTools): string[] {
  if (!tools.anydoc || !tools.pdfInspector) {
    return ["Local ingest missing (@firecrawl/anydoc + @firecrawl/pdf-inspector) — reinstall @imstudium/sdk"];
  }
  return [];
}

export class Extractor {
  private tools: ExtractTools | null = null;

  constructor(tools?: ExtractTools) {
    if (tools) this.tools = tools;
  }

  async getTools(): Promise<ExtractTools> {
    if (!this.tools) this.tools = await detectTools();
    return this.tools;
  }

  async extractFile(src: string, outDir: string, opts: ExtractOptions = {}): Promise<ExtractResult> {
    const name = basename(src);
    const kind = detectKind(name);

    const srcStat = await stat(src);
    const manifestPath = join(outDir, "manifest.json");
    if (!opts.force) {
      try {
        const prev = JSON.parse(await readFile(manifestPath, "utf-8")) as ExtractManifest;
        // Another file's extraction (two long paths shared this folder before the hashed slug) is no previous extraction of this one.
        if (!isSameSource(prev.source, src, outDir)) throw new Error("another file's extraction");
        const unchanged = prev.sourceMtimeMs === srcStat.mtimeMs && prev.sourceSize === srcStat.size;
        if (
          unchanged &&
          !nativeOutdated(prev) &&
          !(await this.ocrWouldAdd(prev, outDir, opts)) &&
          !(await this.mathWouldAdd(prev, outDir, opts)) &&
          !(await this.transcriptWouldAdd(prev, outDir, srcStat, opts))
        ) {
          return { source: src, outDir, kind, pages: prev.pages, skipped: true, tool: prev.tool, ...(prev.transcript ? { transcript: prev.transcript } : {}) };
        }
      } catch {
        // no previous extraction
      }
    }

    let result: ExtractResult;
    if (kind === "media") {
      const media = await this.extractMedia(src, outDir, srcStat, opts);
      // Nothing is written for a recording left without a transcript: the next run looks again.
      if (!media.write) return media.result;
      result = media.result;
    } else if (kind === "image") {
      await ensureDir(outDir);
      result = await this.extractImage(src, outDir, opts);
    } else if (kind === "text") {
      await ensureDir(outDir);
      result = await this.extractText(src, outDir);
    } else if (kind === "unsupported") {
      await ensureDir(outDir);
      result = {
        source: src, outDir, kind, pages: 0,
        error: `Unsupported file type: ${extname(name)}`,
      };
    } else {
      await ensureDir(outDir);
      result = await this.extractDocument(src, outDir, kind, opts);
    }

    const manifest: ExtractManifest = {
      schemaVersion: "1",
      source: src,
      kind,
      pages: result.pages,
      tool: result.tool,
      error: result.error,
      extractedAt: new Date().toISOString(),
      sourceMtimeMs: srcStat.mtimeMs,
      sourceSize: srcStat.size,
      ...(result.imageOnlyPages?.length ? { imageOnlyPages: result.imageOnlyPages } : {}),
      ...(kind === "pdf" && !result.error ? { nativeRule: NATIVE_RULE } : {}),
      ...(this.lastOcr ? { ocr: this.lastOcr } : {}),
      ...(this.lastOcrError ? { ocrError: this.lastOcrError } : {}),
      ...(this.lastMath ? { math: this.lastMath } : {}),
      ...(this.lastMathError ? { mathError: this.lastMathError } : {}),
      ...(result.transcript ? { transcript: result.transcript } : {}),
    };
    this.lastOcr = undefined;
    this.lastOcrError = undefined;
    this.lastMath = undefined;
    this.lastMathError = undefined;
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    return result;
  }

  private lastOcr: ExtractOcrInfo | undefined;
  private lastOcrError: string | undefined;
  private lastMath: ExtractMathInfo | undefined;
  private lastMathError: string | undefined;

  /**
   * An unchanged recording is extracted again when there is more to show: a
   * transcript.json written or replaced since (by a runner outside ImStudium,
   * whatever its model), or none yet and now a runtime to make one.
   */
  private async transcriptWouldAdd(prev: ExtractManifest, outDir: string, srcStat: { size: number; mtimeMs: number }, opts: ExtractOptions): Promise<boolean> {
    if (prev.kind !== "media") return false;
    const cached = await readTranscript(outDir, srcStat);
    if (cached) return !prev.transcript || prev.transcript.model !== cached.model || prev.transcript.transcribedAt !== cached.transcribedAt;
    // A transcription that failed is not retried by itself (extract --force tries again).
    if (prev.error) return false;
    return canTranscribe(speechRuntimeStatus(), opts);
  }

  /**
   * A recording: its matching transcript.json, whatever model wrote it, else a
   * transcription on this machine when the runtime and ffmpeg are here, else
   * nothing (pending). `force` transcribes again even over a matching
   * transcript.json, when it can. `write: false`: nothing went to disk, not
   * even manifest.json.
   */
  private async extractMedia(src: string, outDir: string, srcStat: { size: number; mtimeMs: number }, opts: ExtractOptions): Promise<{ result: ExtractResult; write: boolean }> {
    const base = { source: src, outDir, kind: "media" as const };
    const status = speechRuntimeStatus();
    let doc = await readTranscript(outDir, srcStat);
    const redo = !!opts.force && !!doc && canTranscribe(status, opts) && !!status.ffmpeg;
    const cached = !!doc && !redo;
    if (!doc || redo) {
      if (!canTranscribe(status, opts)) return { result: { ...base, pages: 0, pending: true, hint: pendingHint(status, opts) }, write: false };
      if (!status.ffmpeg) {
        return { result: { ...base, pages: 0, error: "ffmpeg not found on PATH: it decodes audio and video for the transcript", hint: FFMPEG_HINT }, write: false };
      }
      try {
        opts.onProgress?.(`transcribing ${basename(src)} on this machine (${status.threads} threads)`);
        const t = await transcribeMedia(src, { threads: status.threads, ffmpeg: status.ffmpeg, onProgress: opts.onProgress });
        doc = {
          schemaVersion: "1",
          model: SPEECH_MODEL,
          vad: SPEECH_VAD,
          engine: SPEECH_ENGINE,
          onDevice: true,
          source: { file: basename(src), size: srcStat.size, mtimeMs: srcStat.mtimeMs },
          duration: t.duration,
          transcribedAt: new Date().toISOString(),
          segments: t.segments,
        } satisfies TranscriptDoc;
        await ensureDir(outDir);
        await writeTranscript(outDir, doc);
        this.transcribed = true;
      } catch (err) {
        await ensureDir(outDir);
        return { result: { ...base, pages: 0, tool: "sherpa-onnx", error: `Transcription failed: ${err instanceof Error ? err.message : String(err)}`, hint: "Check that the recording plays; imstudium extract --force tries again" }, write: true };
      }
    }
    await ensureDir(outDir);
    const sections = transcriptSections(doc.segments).length;
    await writeFile(join(outDir, "content.md"), renderTranscriptMd(basename(src), doc));
    const transcript: ExtractTranscriptInfo = {
      model: doc.model,
      onDevice: doc.onDevice === true,
      duration: doc.duration,
      segments: doc.segments.length,
      sections,
      cached,
      transcribedAt: doc.transcribedAt,
    };
    return { result: { ...base, pages: sections, tool: cached ? "transcript.json" : "sherpa-onnx", transcript }, write: true };
  }

  /** Set once a recording was transcribed, so extractDir can let go of the loaded model. */
  private transcribed = false;

  /** See {@link shouldRedoForOcr}. */
  private async ocrWouldAdd(prev: ExtractManifest, outDir: string, opts: { ocr?: boolean }): Promise<boolean> {
    if (opts.ocr === false || (prev.ocr && !mergeOutdated(prev))) return false;
    const status = ocrRuntimeStatus();
    if (!status.ready || status.disabled) return false;
    const content = prev.kind === "pdf" && !prev.imageOnlyPages?.length ? await readFile(join(outDir, "content.md"), "utf-8").catch(() => "") : "";
    return shouldRedoForOcr(prev, content, status, opts.ocr);
  }

  /** See {@link shouldRedoForMath}. */
  private async mathWouldAdd(prev: ExtractManifest, outDir: string, opts: { ocr?: boolean; math?: boolean }): Promise<boolean> {
    if (opts.ocr === false || opts.math === false) return false;
    const status = mathRuntimeStatus();
    if (!status.ready || status.disabled) return false;
    const content = prev.kind === "pdf" ? await readFile(join(outDir, "content.md"), "utf-8").catch(() => "") : "";
    return shouldRedoForMath(prev, content, status, opts);
  }

  /**
   * Read display formulas on the pages that may hold math (typeset math glyphs,
   * OCR'd or text-less pages) when the math runtime is installed. Returns the
   * formulas per page, or null when math did not run.
   */
  private async readMath(pdf: Uint8Array, candidates: number[], opts: { ocr?: boolean; math?: boolean }, outDir: string): Promise<Map<number, FormulaEntry[]> | null> {
    if (opts.ocr === false || opts.math === false) return null;
    const status = mathRuntimeStatus();
    if (!status.ready || status.disabled) return null;
    try {
      const result = await recognizeMath(pdf, { pages: candidates, crops: true });
      // Each formula's image next to content.md, for the agent's (or the student's) look. Only our
      // own crops from an earlier reading (p<page>-<n>.png) are replaced; nothing else there is touched.
      const cropDir = join(outDir, "formulas");
      for (const name of await readdir(cropDir).catch(() => [] as string[])) {
        if (/^p\d+-\d+\.png$/.test(name)) await unlink(join(cropDir, name)).catch(() => {});
      }
      if (result.formulas.length) await mkdir(cropDir, { recursive: true });
      const entries: FormulaEntry[] = [];
      for (const [i, f] of result.formulas.entries()) {
        const png = result.crops?.[i];
        if (png) await writeFile(join(cropDir, `${f.id}.png`), png);
        entries.push(png ? { ...f, crop: `formulas/${f.id}.png` } : f);
      }
      const formulas = applyFormulaFixes(entries, await readFormulaFixes(outDir));
      const byPage = new Map<number, FormulaEntry[]>();
      for (const f of formulas) byPage.set(f.page, [...(byPage.get(f.page) ?? []), f]);
      this.lastMath = {
        model: MATH_MODEL,
        layoutModel: LAYOUT_MODEL,
        pages: result.pages,
        formulas: result.formulas.length,
        ms: result.ms,
        decision: MATH_DECISION,
      };
      this.lastFormulas = formulas;
      this.lastChecks = checksOf(formulas);
      return byPage;
    } catch (err) {
      this.lastMathError = err instanceof Error ? err.message : String(err);
      return null;
    }
  }

  private lastFormulas: FormulaEntry[] = [];
  /** The last file's formulas by their check, counted when they were read (writeMathJson clears lastFormulas). */
  private lastChecks: NonNullable<ExtractResult["mathChecks"]> = { checked: 0, needLook: 0, unchecked: 0 };

  /** math.json next to content.md: every formula with its page and box, for checking against the original. */
  private async writeMathJson(outDir: string): Promise<void> {
    if (!this.lastMath) return;
    await writeFile(
      join(outDir, "math.json"),
      `${JSON.stringify({ schemaVersion: "1", model: MATH_MODEL, layoutModel: LAYOUT_MODEL, onDevice: true, bboxUnit: "pt, top-left origin", formulas: this.lastFormulas }, null, 2)}\n`,
    );
    this.lastFormulas = [];
  }

  private recordOcr(converted: LocalConvertOk): void {
    const ocr = converted.metadata.ocr as Required<ExtractOcrInfo> | undefined;
    // Present whenever the OCR engine looked at the file, even if it read no page: that file is
    // not redone for OCR again. Native-only runs leave it out, so a later `setup ocr` redoes them.
    this.lastOcr = ocr
      ? { model: ocr.model, merge: ocr.merge, pages: ocr.pages, lowConfidencePages: ocr.lowConfidencePages, ...(ocr.recoveredPages?.length ? { recoveredPages: ocr.recoveredPages } : {}) }
      : undefined;
    this.lastOcrError = typeof converted.metadata.ocrError === "string" ? converted.metadata.ocrError : undefined;
  }

  async extractDir(
    filesDir: string,
    outRoot: string,
    opts: ExtractOptions & {
      course?: Pick<StudiumCourse, "title" | "path">;
      workspaceRoot?: string;
      /** The folders moved to their file's current name before extraction (see migrateExtractFolders). */
      onMigrate?: (migration: ExtractFolderMigration) => void;
    } = {},
  ): Promise<ExtractResult[]> {
    const files = await walkFiles(filesDir);
    opts.onMigrate?.(await migrateExtractFolders(filesDir, outRoot, files));
    const results: ExtractResult[] = [];
    try {
      for (const f of files) {
        if (detectKind(f) === "unsupported") continue;
        // Folder-qualified slug: Übungen/Blatt01.pdf and Lösungen/Blatt01.pdf stay apart.
        const outDir = join(outRoot, extractSlug(relative(filesDir, f)));
        results.push(await this.extractFile(f, outDir, opts));
      }
    } finally {
      // The speech model holds about 1 GB: let it go between courses (and between rounds of watch).
      if (this.transcribed) resetSpeechEngine();
      this.transcribed = false;
    }

    if (opts.course) {
      const courseDir = filesDir.replace(/\/files\/?$/, "");
      await buildCourseSearchIndex(courseDir, opts.course, opts.workspaceRoot);
    }

    return results;
  }

  private async extractDocument(
    src: string,
    outDir: string,
    kind: "pdf" | "office",
    opts: { ocr?: boolean; math?: boolean } = {},
  ): Promise<ExtractResult> {
    const bytes = new Uint8Array(await readFile(src));
    const converted = await convertLocalDocument(bytes, src, { ocr: opts.ocr });
    if (!converted.ok) {
      return {
        source: src, outDir, kind, pages: 0,
        error: converted.error.message,
        hint: "Local AnyDoc / pdf-inspector pipeline failed",
      };
    }

    const ext = extname(src).toLowerCase();
    const label =
      kind === "pdf" ? "pdf" : ext === ".pptx" || ext === ".ppt" || ext === ".odp" ? "slides" : "document";
    let pageTexts = converted.pages.map((p) => p.markdown);
    const ocrPages = converted.pages.filter((p) => p.ocr).map((p) => p.index);
    const ocrLowConfidencePages = converted.pages.filter((p) => p.ocr?.low).map((p) => p.index);
    const recoveredPages = converted.pages.filter((p) => p.recovered || p.fromPositions).map((p) => p.index);
    this.recordOcr(converted);

    let formulas = 0;
    if (kind === "pdf") {
      const candidates = converted.pages.filter((p) => p.ocr || p.imageOnly || isMathCandidate(p.markdown)).map((p) => p.index);
      const math = candidates.length ? await this.readMath(bytes, candidates, opts, outDir) : null;
      if (math) {
        pageTexts = pageTexts.map((text, i) => withFormulas(text, math.get(converted.pages[i]?.index ?? i)));
        formulas = this.lastMath?.formulas ?? 0;
        await this.writeMathJson(outDir);
      }
    }

    await writeFile(join(outDir, "content.md"), renderContentMd(basename(src), label, pageTexts, false, ocrPages.length, formulas));
    return {
      source: src,
      outDir,
      kind,
      pages: converted.pageCount,
      hasImages: false,
      tool: converted.engine,
      ocrPages,
      ...(ocrLowConfidencePages.length ? { ocrLowConfidencePages } : {}),
      ...(recoveredPages.length ? { recoveredPages } : {}),
      imageOnlyPages: converted.pages.filter((p) => p.imageOnly).map((p) => p.index),
      ...(this.lastMath ? { mathFormulas: formulas, mathChecks: this.mathChecks() } : {}),
    };
  }

  private mathChecks(): NonNullable<ExtractResult["mathChecks"]> {
    return this.lastChecks;
  }

  private async extractImage(src: string, outDir: string, opts: { ocr?: boolean; math?: boolean } = {}): Promise<ExtractResult> {
    const pagesDir = join(outDir, "pages");
    await ensureDir(pagesDir);
    const dest = join(pagesDir, `page-1${extname(src).toLowerCase()}`);
    await cp(src, dest);
    // JPEG/PNG: read the text on-device when OCR is installed; the picture stays in pages/ either way.
    const bytes = new Uint8Array(await readFile(src));
    const ocr = await convertImage(bytes, { ocr: opts.ocr });
    if (ocr?.ok) {
      this.recordOcr(ocr);
      const wrapped = imageToPdf(bytes);
      const math = wrapped ? await this.readMath(wrapped, [0], opts, outDir) : null;
      const formulas = math?.get(0)?.length ?? 0;
      if (math) await this.writeMathJson(outDir);
      await writeFile(
        join(outDir, "content.md"),
        renderContentMd(basename(src), "image", [`${withFormulas(ocr.markdown, math?.get(0))}\n\n(image: ${dest})`], true, 1, formulas),
      );
      const low = ocr.pages[0]?.ocr?.low;
      return {
        source: src, outDir, kind: "image", pages: 1, hasImages: true, tool: ocr.engine, ocrPages: [0],
        ...(low ? { ocrLowConfidencePages: [0] } : {}),
        ...(math ? { mathFormulas: formulas, mathChecks: this.mathChecks() } : {}),
      };
    }
    if (ocr && !ocr.ok) this.lastOcrError = ocr.error.message;
    await writeFile(
      join(outDir, "content.md"),
      renderContentMd(basename(src), "image", [`(image — read ${dest})`], true),
    );
    return { source: src, outDir, kind: "image", pages: 1, hasImages: true, tool: "copy" };
  }

  private async extractText(src: string, outDir: string): Promise<ExtractResult> {
    const raw = await readFile(src, "utf-8");
    await writeFile(join(outDir, "content.md"), renderContentMd(basename(src), "text", [raw], false));
    return { source: src, outDir, kind: "text", pages: 1, tool: "passthrough" };
  }
}

/** Whether a recording without a matching transcript.json may be transcribed now (ffmpeg is checked separately, so a missing one is an error, not silence). */
export function canTranscribe(status: Pick<SpeechRuntimeStatus, "ready" | "disabled">, opts: { transcribe?: boolean } = {}): boolean {
  return opts.transcribe !== false && status.ready && !status.disabled;
}

/** Why a recording was left without a transcript, and what would make one. */
export function pendingHint(status: Pick<SpeechRuntimeStatus, "ready" | "supported" | "disabled" | "reason">, opts: { transcribe?: boolean } = {}): string {
  if (opts.transcribe === false) return "Not transcribed (--no-transcribe)";
  if (status.ready && status.disabled) return "Not transcribed: switched off by IMSTUDIUM_SPEECH=off";
  if (!status.supported) return `Not transcribed: ${status.reason ?? "no on-device speech runtime for this platform"}`;
  if (status.reason === "runs under Node only") return "Not transcribed: on-device transcripts run under Node (npm i -g @imstudium/sdk)";
  return "Not transcribed yet: imstudium setup speech installs on-device transcripts for audio and video";
}

/** Transcript totals over extraction results, for sync and extract summaries. */
export interface MediaSummary {
  /** Recordings whose content.md was rendered from a transcript in this run. */
  transcripts: number;
  /** Of those, transcribed on this machine in this run. */
  transcribed: number;
  /** Of those, read from a transcript.json that was already there. */
  cached: number;
  /** Seconds of audio transcribed in this run. */
  seconds: number;
  /** Recordings left without a transcript (no runtime, switched off, --no-transcribe). */
  pending: number;
}

export function summarizeMedia(results: Array<Pick<ExtractResult, "kind" | "transcript" | "pending" | "skipped" | "error">>): MediaSummary {
  const done = results.filter((r) => r.kind === "media" && r.transcript && !r.skipped && !r.error);
  const fresh = done.filter((r) => !r.transcript!.cached);
  return {
    transcripts: done.length,
    transcribed: fresh.length,
    cached: done.length - fresh.length,
    seconds: Math.round(fresh.reduce((n, r) => n + r.transcript!.duration, 0)),
    pending: results.filter((r) => r.pending).length,
  };
}

/**
 * A PDF extracted under the first native rule, which left the pages
 * pdf-inspector rates scanned image-only even when they carry a text layer.
 * Only one with pages still text-less can have lost any; native extraction is
 * quick, so it is simply done again once.
 */
export function nativeOutdated(prev: Pick<ExtractManifest, "kind" | "imageOnlyPages" | "nativeRule" | "error">): boolean {
  return prev.kind === "pdf" && !prev.error && !!prev.imageOnlyPages?.length && (prev.nativeRule ?? 1) < NATIVE_RULE;
}

/**
 * A PDF the OCR path read under an older merge rule, which dropped the text a
 * page's own text layer gave back (through PDFium, or as positioned runs).
 * Only one with pages still text-less can have lost any.
 */
function mergeOutdated(prev: Pick<ExtractManifest, "kind" | "imageOnlyPages" | "ocr">): boolean {
  return prev.kind === "pdf" && !!prev.ocr && (prev.ocr.merge ?? 1) < OCR_MERGE && !!prev.imageOnlyPages?.length;
}

/**
 * An unchanged file is extracted again when on-device OCR is ready and would
 * add text: an image, or a PDF with pages that had no text layer (older
 * extractions only left the marker in content.md), and OCR hasn't run on it
 * yet, or ran under an older merge rule that dropped recovered text. Never
 * with `--no-ocr` / IMSTUDIUM_OCR=off.
 */
export function shouldRedoForOcr(
  prev: Pick<ExtractManifest, "kind" | "imageOnlyPages" | "ocr">,
  contentMd: string,
  status: Pick<OcrRuntimeStatus, "ready" | "disabled">,
  ocr?: boolean,
): boolean {
  if (ocr === false || !status.ready || status.disabled) return false;
  if (prev.ocr) return mergeOutdated(prev);
  if (prev.kind === "image") return true;
  if (prev.kind !== "pdf") return false;
  if (prev.imageOnlyPages?.length) return true;
  return contentMd.includes(IMAGE_ONLY);
}

/**
 * An unchanged file is extracted again once the math runtime is ready, when it
 * may hold formulas and math hasn't looked at it yet: an image, or a PDF with
 * OCR'd or text-less pages or typeset math glyphs in its text.
 */
export function shouldRedoForMath(
  prev: Pick<ExtractManifest, "kind" | "imageOnlyPages" | "ocr" | "math">,
  contentMd: string,
  status: Pick<MathRuntimeStatus, "ready" | "disabled">,
  opts: { ocr?: boolean; math?: boolean } = {},
): boolean {
  if (opts.ocr === false || opts.math === false || !status.ready || status.disabled) return false;
  // Read before with the same models and decision rule: nothing new. Otherwise read again (corrections still apply where the reading is unchanged).
  if (prev.math) return prev.math.model !== MATH_MODEL || prev.math.layoutModel !== LAYOUT_MODEL || (prev.math.decision ?? 0) < MATH_DECISION;
  if (prev.kind === "image") return !!prev.ocr;
  if (prev.kind !== "pdf") return false;
  return !!prev.ocr?.pages.length || !!prev.imageOnlyPages?.length || isMathCandidate(contentMd);
}

/** Formulas by their check; a stored correction counts as it checked. */
function checksOf(formulas: FormulaEntry[]): NonNullable<ExtractResult["mathChecks"]> {
  const checks = formulas.map((f) => f.corrected?.verdict.check ?? f.check);
  return {
    checked: checks.filter((c) => c === "match").length,
    needLook: checks.filter((c) => c === "differs").length,
    unchecked: checks.filter((c) => c === "unchecked" || c === "partial").length,
  };
}

/** OCR totals over extraction results, for sync and extract summaries. */
export interface OcrSummary {
  /** Files with at least one page read by OCR. */
  files: number;
  /** Pages read by OCR. */
  pages: number;
  /** Of those, pages below the confidence threshold (marked in content.md). */
  lowConfidencePages: number;
  /** Pages that still have no text (no OCR, or OCR found nothing). */
  imageOnlyPages: number;
  /** Pages whose own text layer the OCR path recovered through PDFium (not OCR). */
  recoveredPages: number;
  /** Display formulas read into LaTeX by on-device math recognition. */
  formulas: number;
  /** Of those, checked against the PDF's own text (or corrected so they check). */
  formulasChecked: number;
  /** Of those, whose check didn't pass: they need a look at their image. */
  formulasNeedLook: number;
  /** Of those, with nothing in the PDF to compare with: scanned pages and formulas that are pictures. */
  formulasUnchecked: number;
}

export function summarizeOcr(results: Array<Pick<ExtractResult, "ocrPages" | "ocrLowConfidencePages" | "imageOnlyPages" | "recoveredPages" | "mathFormulas" | "mathChecks" | "skipped" | "error">>): OcrSummary {
  const done = results.filter((r) => !r.skipped && !r.error);
  return {
    files: done.filter((r) => r.ocrPages?.length).length,
    pages: done.reduce((n, r) => n + (r.ocrPages?.length ?? 0), 0),
    lowConfidencePages: done.reduce((n, r) => n + (r.ocrLowConfidencePages?.length ?? 0), 0),
    imageOnlyPages: done.reduce((n, r) => n + (r.imageOnlyPages?.length ?? 0), 0),
    recoveredPages: done.reduce((n, r) => n + (r.recoveredPages?.length ?? 0), 0),
    formulas: done.reduce((n, r) => n + (r.mathFormulas ?? 0), 0),
    formulasChecked: done.reduce((n, r) => n + (r.mathChecks?.checked ?? 0), 0),
    formulasNeedLook: done.reduce((n, r) => n + (r.mathChecks?.needLook ?? 0), 0),
    formulasUnchecked: done.reduce((n, r) => n + (r.mathChecks?.unchecked ?? 0), 0),
  };
}

/** Characters of a folder name under extracted/ before `-<ext>`. */
const SLUG_STEM_MAX = 80;

/**
 * The folder under extracted/ for a file, from its path below files/: the
 * slugified path, then `-<ext>` (`Ubungen-Blatt01-pdf`). A path whose slug is
 * longer than 80 characters keeps its first 71, then `-` and the first 8 hex
 * digits of the SHA-1 of the path (NFC, `/` separators): two long paths that
 * start alike get a folder each. The same path always gives the same folder,
 * so sync, extract, view, formulas and the MCP tools agree without a lookup.
 */
export function extractSlug(filename: string): string {
  const ext = extname(filename).slice(1).toLowerCase() || "file";
  const stem = slugify(filename.replace(/\.[^.]+$/, ""), Infinity);
  if (stem.length <= SLUG_STEM_MAX) return `${stem}-${ext}`;
  const hash = createHash("sha1").update(filename.split(sep).join("/").normalize("NFC")).digest("hex").slice(0, 8);
  return `${stem.slice(0, SLUG_STEM_MAX - 9)}-${hash}-${ext}`;
}

/** A path as manifest.json compares: absolute, `/` separators, NFC. */
function normalPath(p: string): string {
  return resolve(p).split(sep).join("/").normalize("NFC");
}

/**
 * Whether an extraction's manifest `source` is the file `src`. manifest.json
 * keeps the path it was given; when the workspace has moved since (semester
 * start, a copy), the file still counts as the same when its path below the
 * course's files/ is. `outDir` (<course>/extracted/<slug>) places the course.
 */
export function isSameSource(source: string | undefined, src: string, outDir: string): boolean {
  if (!source) return false;
  const was = normalPath(source);
  const now = normalPath(src);
  if (was === now) return true;
  if (basename(dirname(outDir)) !== "extracted") return false;
  const filesRoot = `${normalPath(join(dirname(dirname(outDir)), "files"))}/`;
  if (!now.startsWith(filesRoot) || was.startsWith(filesRoot)) return false;
  return `/${was}`.endsWith(`/files/${now.slice(filesRoot.length)}`);
}

/** An extracted folder whose file now has another folder name. */
export interface ExtractFolderMove {
  /** The folder's name under extracted/. */
  from: string;
  /** Its file's folder name under the current rule (extractSlug). */
  to: string;
  /** The file, relative to files/. */
  source: string;
}

/** What migrateExtractFolders did in one course. */
export interface ExtractFolderMigration {
  /** Renamed to their file's current folder name, with everything in them. */
  moved: ExtractFolderMove[];
  /** Left where they are because a folder of the new name exists already: both are kept. */
  kept: ExtractFolderMove[];
}

/**
 * Run before a course's files are extracted. Every folder under `outRoot`
 * whose manifest.json names a file still in `filesDir`, and whose name is not
 * that file's extractSlug (a long path, from before the hashed slug), is
 * renamed to it with everything in it: pages/, math.json, formulas/,
 * formulas.checked.json, transcripts. When that name is taken, both folders
 * stay and the old one is reported in `kept`. Nothing is deleted, and a folder
 * without a manifest is left alone.
 */
export async function migrateExtractFolders(filesDir: string, outRoot: string, files?: string[]): Promise<ExtractFolderMigration> {
  const result: ExtractFolderMigration = { moved: [], kept: [] };
  const names = await readdir(outRoot).catch(() => [] as string[]);
  if (!names.length) return result;

  const filesRoot = `${normalPath(filesDir)}/`;
  const byPath = new Map<string, string>();
  const byRel = new Map<string, string>();
  for (const f of files ?? (await walkFiles(filesDir))) {
    const rel = relative(filesDir, f);
    byPath.set(normalPath(f), rel);
    byRel.set(rel.split(sep).join("/").normalize("NFC"), rel);
  }
  // The file a manifest names: the same path, or after the workspace moved, the path below its files/.
  const fileOf = (source: string): string | undefined => {
    const was = normalPath(source);
    if (byPath.has(was) || was.startsWith(filesRoot)) return byPath.get(was);
    for (let i = was.indexOf("/files/"); i >= 0; i = was.indexOf("/files/", i + 1)) {
      const rel = byRel.get(was.slice(i + "/files/".length));
      if (rel !== undefined) return rel;
    }
    return undefined;
  };

  const pending: ExtractFolderMove[] = [];
  for (const name of names) {
    let source: unknown;
    try {
      source = (JSON.parse(await readFile(join(outRoot, name, "manifest.json"), "utf-8")) as Partial<ExtractManifest>).source;
    } catch {
      continue;
    }
    const rel = typeof source === "string" && source ? fileOf(source) : undefined;
    if (rel === undefined) continue;
    const to = extractSlug(rel);
    if (to !== name) pending.push({ from: name, to, source: rel.split(sep).join("/") });
  }

  const taken = (name: string) => lstat(join(outRoot, name)).then(() => true, () => false);
  // One rename can free the name another folder waits for: go round until nothing moves.
  for (let moved = true; moved && pending.length; ) {
    moved = false;
    for (const m of [...pending]) {
      if (await taken(m.to)) continue;
      await rename(join(outRoot, m.from), join(outRoot, m.to));
      pending.splice(pending.indexOf(m), 1);
      result.moved.push(m);
      moved = true;
    }
  }
  result.kept.push(...pending);
  return result;
}

/** Heading above the formulas a page got from on-device math recognition. */
export const FORMULAS_HEADING = "_Formulas on this page, read on this machine as LaTeX (UniRec-0.1B): check against the original._";

/** Page text plus its display formulas as `$$…$$` blocks, top to bottom. */
export function withFormulas(text: string, formulas: Array<Formula | FormulaEntry> | undefined): string {
  if (!formulas?.length) return text;
  const block = (f: Formula | FormulaEntry) => {
    const e = f as FormulaEntry;
    const note = e.check ? formulaNote(e) : null;
    return [`$$${e.corrected?.latex ?? e.latex}$$`, ...(note ? [note] : []), ""];
  };
  return [text.trimEnd(), "", FORMULAS_HEADING, "", ...formulas.flatMap(block)].join("\n").trimEnd();
}

function renderContentMd(
  filename: string,
  label: string,
  pageTexts: string[],
  hasImages: boolean,
  ocrPages = 0,
  formulas = 0,
): string {
  const ocr = ocrPages ? ` · on-device OCR on ${ocrPages} page(s)` : "";
  const math = formulas ? ` · ${formulas} formula(s) as LaTeX (on-device)` : "";
  const lines = [
    `# ${filename}`,
    "",
    `> ${label} · ${pageTexts.length} page(s) · local AnyDoc / pdf-inspector${ocr}${math}${hasImages ? " · image in pages/" : ""}`,
    "",
  ];
  const unit = label === "slides" ? "Slide" : "Page";
  pageTexts.forEach((text, i) => {
    if (pageTexts.length > 1) lines.push(`## ${unit} ${i + 1}`, "");
    lines.push(text.trim() || IMAGE_ONLY, "");
  });
  return lines.join("\n");
}

async function walkFiles(dir: string, out: string[] = []): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) await walkFiles(p, out);
      else out.push(p);
    }
  } catch {
    // missing dir is fine
  }
  return out;
}
