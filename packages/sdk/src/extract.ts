import { cp, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";
import { ensureDir, slugify } from "./config.js";
import { convertImage, convertLocalDocument, IMAGE_ONLY, probeLocalIngest, type LocalConvertOk } from "./ingest/local-docs.js";
import { ocrRuntimeStatus } from "./ingest/ocr-runtime.js";
import { buildCourseSearchIndex } from "./search-corpus.js";
import type { ExtractManifest, ExtractOcrInfo, ExtractResult, MaterialKind, StudiumCourse } from "./types.js";

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
  return "unsupported";
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

  async extractFile(
    src: string,
    outDir: string,
    opts: { images?: boolean; dpi?: number; force?: boolean; ocr?: boolean } = {},
  ): Promise<ExtractResult> {
    const name = basename(src);
    const kind = detectKind(name);

    const srcStat = await stat(src);
    const manifestPath = join(outDir, "manifest.json");
    if (!opts.force) {
      try {
        const prev = JSON.parse(await readFile(manifestPath, "utf-8")) as ExtractManifest;
        const unchanged = prev.sourceMtimeMs === srcStat.mtimeMs && prev.sourceSize === srcStat.size;
        if (unchanged && !(await this.ocrWouldAdd(prev, outDir, opts))) {
          return { source: src, outDir, kind, pages: prev.pages, skipped: true, tool: prev.tool };
        }
      } catch {
        // no previous extraction
      }
    }

    await ensureDir(outDir);

    let result: ExtractResult;
    if (kind === "image") {
      result = await this.extractImage(src, outDir, opts);
    } else if (kind === "text") {
      result = await this.extractText(src, outDir);
    } else if (kind === "unsupported") {
      result = {
        source: src, outDir, kind, pages: 0,
        error: `Unsupported file type: ${extname(name)}`,
      };
    } else {
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
      ...(this.lastOcr ? { ocr: this.lastOcr } : {}),
      ...(this.lastOcrError ? { ocrError: this.lastOcrError } : {}),
    };
    this.lastOcr = undefined;
    this.lastOcrError = undefined;
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    return result;
  }

  private lastOcr: ExtractOcrInfo | undefined;
  private lastOcrError: string | undefined;

  /**
   * An unchanged file is extracted again when on-device OCR is now available and
   * would add text: it has pages without a text layer (older extractions only left
   * the marker in content.md) or it is an image, and OCR hasn't run on it yet.
   */
  private async ocrWouldAdd(prev: ExtractManifest, outDir: string, opts: { ocr?: boolean }): Promise<boolean> {
    if (opts.ocr === false || prev.ocr) return false;
    const status = ocrRuntimeStatus();
    if (!status.ready || status.disabled) return false;
    if (prev.kind === "image") return true;
    if (prev.kind !== "pdf") return false;
    if (prev.imageOnlyPages?.length) return true;
    const content = await readFile(join(outDir, "content.md"), "utf-8").catch(() => "");
    return content.includes(IMAGE_ONLY);
  }

  private recordOcr(converted: LocalConvertOk): void {
    const ocr = converted.metadata.ocr as { model: string; pages: number[]; lowConfidencePages: number[] } | undefined;
    this.lastOcr = ocr ? { model: ocr.model, pages: ocr.pages, lowConfidencePages: ocr.lowConfidencePages } : undefined;
    this.lastOcrError = typeof converted.metadata.ocrError === "string" ? converted.metadata.ocrError : undefined;
  }

  async extractDir(
    filesDir: string,
    outRoot: string,
    opts: {
      images?: boolean;
      dpi?: number;
      force?: boolean;
      /** false: native text only, even with the OCR runtime installed. */
      ocr?: boolean;
      course?: Pick<StudiumCourse, "title" | "path">;
      workspaceRoot?: string;
    } = {},
  ): Promise<ExtractResult[]> {
    const files = await walkFiles(filesDir);
    const results: ExtractResult[] = [];
    for (const f of files) {
      if (detectKind(f) === "unsupported") continue;
      // Folder-qualified slug: Übungen/Blatt01.pdf and Lösungen/Blatt01.pdf stay apart.
      const outDir = join(outRoot, extractSlug(relative(filesDir, f)));
      results.push(await this.extractFile(f, outDir, opts));
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
    opts: { ocr?: boolean } = {},
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
    const pageTexts = converted.pages.map((p) => p.markdown);
    const ocrPages = converted.pages.filter((p) => p.ocr).map((p) => p.index);
    this.recordOcr(converted);
    await writeFile(join(outDir, "content.md"), renderContentMd(basename(src), label, pageTexts, false, ocrPages.length));
    return {
      source: src,
      outDir,
      kind,
      pages: converted.pageCount,
      hasImages: false,
      tool: converted.engine,
      ocrPages,
      imageOnlyPages: converted.pages.filter((p) => p.imageOnly).map((p) => p.index),
    };
  }

  private async extractImage(src: string, outDir: string, opts: { ocr?: boolean } = {}): Promise<ExtractResult> {
    const pagesDir = join(outDir, "pages");
    await ensureDir(pagesDir);
    const dest = join(pagesDir, `page-1${extname(src).toLowerCase()}`);
    await cp(src, dest);
    // JPEG/PNG: read the text on-device when OCR is installed; the picture stays in pages/ either way.
    const ocr = await convertImage(new Uint8Array(await readFile(src)), { ocr: opts.ocr });
    if (ocr?.ok) {
      this.recordOcr(ocr);
      await writeFile(
        join(outDir, "content.md"),
        renderContentMd(basename(src), "image", [`${ocr.markdown}\n\n(image: ${dest})`], true, 1),
      );
      return { source: src, outDir, kind: "image", pages: 1, hasImages: true, tool: ocr.engine, ocrPages: [0] };
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

export function extractSlug(filename: string): string {
  return slugify(filename.replace(/\.[^.]+$/, "")) + "-" + (extname(filename).slice(1).toLowerCase() || "file");
}

function renderContentMd(
  filename: string,
  label: string,
  pageTexts: string[],
  hasImages: boolean,
  ocrPages = 0,
): string {
  const ocr = ocrPages ? ` · on-device OCR on ${ocrPages} page(s)` : "";
  const lines = [
    `# ${filename}`,
    "",
    `> ${label} · ${pageTexts.length} page(s) · local AnyDoc / pdf-inspector${ocr}${hasImages ? " · image in pages/" : ""}`,
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
