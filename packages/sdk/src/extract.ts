import { execFile } from "node:child_process";
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { promisify } from "node:util";
import { ensureDir, slugify } from "./config.js";
import {
  buildCourseSearchIndex,
} from "./search-corpus.js";
import type { ExtractManifest, ExtractResult, MaterialKind } from "./types.js";
import type { StudiumCourse } from "./types.js";

const exec = promisify(execFile);
const MAX_BUFFER = 64 * 1024 * 1024;

const PDF_EXT = new Set([".pdf"]);
const OFFICE_EXT = new Set([
  ".pptx", ".ppt", ".odp",
  ".docx", ".doc", ".odt", ".rtf",
  ".xlsx", ".xls", ".ods",
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
  pdftotext?: string;
  pdftoppm?: string;
  soffice?: string;
  unzip?: string;
  tesseract?: string;
}

const SOFFICE_CANDIDATES = [
  "soffice",
  "/Applications/LibreOffice.app/Contents/MacOS/soffice",
  "/usr/bin/soffice",
];

async function which(bin: string): Promise<string | undefined> {
  try {
    if (bin.startsWith("/")) {
      await stat(bin);
      return bin;
    }
    const { stdout } = await exec("which", [bin]);
    const p = stdout.trim();
    return p || undefined;
  } catch {
    return undefined;
  }
}

export async function detectTools(): Promise<ExtractTools> {
  const [pdftotext, pdftoppm, unzip, tesseract] = await Promise.all([
    which("pdftotext"),
    which("pdftoppm"),
    which("unzip"),
    which("tesseract"),
  ]);
  let soffice: string | undefined;
  for (const c of SOFFICE_CANDIDATES) {
    soffice = await which(c);
    if (soffice) break;
  }
  return { pdftotext, pdftoppm, soffice, unzip, tesseract };
}

export function toolHints(tools: ExtractTools): string[] {
  const hints: string[] = [];
  if (!tools.pdftotext || !tools.pdftoppm) {
    hints.push("Install poppler for PDF text + slide images: brew install poppler (macOS) / apt install poppler-utils (Linux)");
  }
  if (!tools.soffice) {
    hints.push("Install LibreOffice for full Office rendering: brew install --cask libreoffice / apt install libreoffice");
  }
  if (!tools.tesseract) {
    hints.push("Install Tesseract for OCR on scanned PDFs and photos: brew install tesseract tesseract-lang / apt install tesseract-ocr tesseract-ocr-deu");
  }
  return hints;
}

/** Indices (0-based) of pages whose extracted text is empty — OCR candidates. Exported for tests. */
export function pickOcrPages(pageTexts: string[]): number[] {
  const out: number[] = [];
  pageTexts.forEach((t, i) => {
    if (!t.trim()) out.push(i);
  });
  return out;
}

/** Strip PPTX/DOCX XML down to readable text. Exported for tests. */
export function stripOfficeXml(xml: string, format: "pptx" | "docx"): string {
  const runTag = format === "pptx" ? "a:t" : "w:t";
  const re = new RegExp(`<${runTag}[^>]*>([\\s\\S]*?)</${runTag}>`, "g");
  const parts: string[] = [];
  // Paragraph boundaries become newlines so slide text stays structured.
  const paraSplit = format === "pptx" ? /<\/a:p>/ : /<\/w:p>/;
  for (const para of xml.split(paraSplit)) {
    const runs: string[] = [];
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(para)) !== null) runs.push(m[1]);
    const line = decodeXmlEntities(runs.join("")).trim();
    if (line) parts.push(line);
  }
  return parts.join("\n");
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&amp;/g, "&");
}

/** Order slide entries numerically: slide2.xml before slide10.xml. Exported for tests. */
export function sortSlideEntries(entries: string[]): string[] {
  return [...entries].sort((a, b) => {
    const na = parseInt(a.match(/slide(\d+)\.xml/)?.[1] ?? "0", 10);
    const nb = parseInt(b.match(/slide(\d+)\.xml/)?.[1] ?? "0", 10);
    return na - nb;
  });
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

  /**
   * Extract one file into outDir: content.md + pages/*.png + manifest.json.
   * Incremental — skips when the source is unchanged unless force is set.
   */
  async extractFile(
    src: string,
    outDir: string,
    opts: { images?: boolean; dpi?: number; force?: boolean } = {},
  ): Promise<ExtractResult> {
    const name = basename(src);
    const kind = detectKind(name);
    const images = opts.images !== false;
    const dpi = opts.dpi ?? 144;
    const tools = await this.getTools();

    const srcStat = await stat(src);
    const manifestPath = join(outDir, "manifest.json");
    if (!opts.force) {
      try {
        const prev = JSON.parse(await readFile(manifestPath, "utf-8")) as ExtractManifest;
        if (prev.sourceMtimeMs === srcStat.mtimeMs && prev.sourceSize === srcStat.size) {
          return { source: src, outDir, kind, pages: prev.pages, skipped: true, tool: prev.tool };
        }
      } catch {
        // no previous extraction
      }
    }

    await ensureDir(outDir);

    let result: ExtractResult;
    switch (kind) {
      case "pdf":
        result = await this.extractPdf(src, outDir, { images, dpi, tools });
        break;
      case "office":
        result = await this.extractOffice(src, outDir, { images, dpi, tools });
        break;
      case "image":
        result = await this.extractImage(src, outDir);
        break;
      case "text":
        result = await this.extractText(src, outDir);
        break;
      default:
        result = {
          source: src, outDir, kind, pages: 0,
          error: `Unsupported file type: ${extname(name)}`,
        };
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
    };
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    return result;
  }

  /** Extract every supported file under filesDir into outRoot/<file-slug>/. */
  async extractDir(
    filesDir: string,
    outRoot: string,
    opts: {
      images?: boolean;
      dpi?: number;
      force?: boolean;
      course?: Pick<StudiumCourse, "title" | "path">;
      workspaceRoot?: string;
    } = {},
  ): Promise<ExtractResult[]> {
    const files = await walkFiles(filesDir);
    const results: ExtractResult[] = [];
    for (const f of files) {
      if (detectKind(f) === "unsupported") continue;
      const outDir = join(outRoot, extractSlug(basename(f)));
      results.push(await this.extractFile(f, outDir, opts));
    }

    if (opts.course) {
      const courseDir = filesDir.replace(/\/files\/?$/, "");
      await buildCourseSearchIndex(courseDir, opts.course, opts.workspaceRoot);
    }

    return results;
  }

  private async extractPdf(
    src: string,
    outDir: string,
    opts: { images: boolean; dpi: number; tools: ExtractTools },
  ): Promise<ExtractResult> {
    const { tools } = opts;
    if (!tools.pdftotext) {
      return {
        source: src, outDir, kind: "pdf", pages: 0,
        error: "pdftotext not found", hint: toolHints(tools)[0],
      };
    }

    const { stdout } = await exec(tools.pdftotext, ["-layout", src, "-"], { maxBuffer: MAX_BUFFER });
    // pdftotext separates pages with form feeds.
    const pageTexts = stdout.split("\f").map((p) => p.trimEnd());
    while (pageTexts.length > 0 && !pageTexts[pageTexts.length - 1].trim()) pageTexts.pop();

    let imagePages = 0;
    let pageFiles: string[] = [];
    if (opts.images && tools.pdftoppm) {
      const pagesDir = join(outDir, "pages");
      await ensureDir(pagesDir);
      await exec(
        tools.pdftoppm,
        ["-png", "-r", String(opts.dpi), src, join(pagesDir, "page")],
        { maxBuffer: MAX_BUFFER },
      );
      pageFiles = (await readdir(pagesDir)).filter((f) => f.endsWith(".png")).sort();
      imagePages = pageFiles.length;
    }

    // Scanned PDFs have no text layer — OCR the rendered images for those pages.
    let ocrUsed = false;
    if (tools.tesseract && pageFiles.length > 0) {
      while (pageTexts.length < pageFiles.length) pageTexts.push("");
      for (const i of pickOcrPages(pageTexts)) {
        if (!pageFiles[i]) continue;
        const text = await runOcr(tools.tesseract, join(outDir, "pages", pageFiles[i]));
        if (text) {
          pageTexts[i] = `_(OCR)_\n${text}`;
          ocrUsed = true;
        }
      }
    }

    const pages = Math.max(pageTexts.length, imagePages);
    await writeFile(join(outDir, "content.md"), renderContentMd(basename(src), "pdf", pageTexts, imagePages > 0));
    return {
      source: src, outDir, kind: "pdf", pages, hasImages: imagePages > 0,
      tool: ocrUsed ? "poppler+tesseract" : "poppler",
    };
  }

  private async extractOffice(
    src: string,
    outDir: string,
    opts: { images: boolean; dpi: number; tools: ExtractTools },
  ): Promise<ExtractResult> {
    const { tools } = opts;

    // Preferred: LibreOffice → PDF → full poppler pipeline (text + slide images).
    if (tools.soffice && tools.pdftotext) {
      const tmp = join(tmpdir(), `imstudium-extract-${Date.now()}`);
      await mkdir(tmp, { recursive: true });
      try {
        await exec(tools.soffice, ["--headless", "--convert-to", "pdf", "--outdir", tmp, src], {
          maxBuffer: MAX_BUFFER,
          timeout: 120_000,
        });
        const pdfName = (await readdir(tmp)).find((f) => f.endsWith(".pdf"));
        if (pdfName) {
          const result = await this.extractPdf(join(tmp, pdfName), outDir, opts);
          return { ...result, source: src, kind: "office", tool: "libreoffice+poppler" };
        }
      } catch {
        // fall through to native extraction
      } finally {
        await rm(tmp, { recursive: true, force: true });
      }
    }

    // Fallback: native XML text extraction (PPTX/DOCX are zip archives) — no images.
    const ext = extname(src).toLowerCase();
    if (tools.unzip && (ext === ".pptx" || ext === ".docx")) {
      const text = await this.extractOfficeNative(tools.unzip, src, ext === ".pptx" ? "pptx" : "docx");
      const pageTexts = ext === ".pptx" ? text.split("\u0000") : [text];
      await writeFile(
        join(outDir, "content.md"),
        renderContentMd(basename(src), ext === ".pptx" ? "slides" : "document", pageTexts, false),
      );
      return {
        source: src, outDir, kind: "office", pages: pageTexts.length,
        hasImages: false, tool: "native-xml",
        hint: tools.soffice ? undefined : toolHints(tools).find((h) => h.includes("LibreOffice")),
      };
    }

    return {
      source: src, outDir, kind: "office", pages: 0,
      error: "No extraction tool for Office files", hint: toolHints(tools).join(" · "),
    };
  }

  /** PPTX slides / DOCX body → text. Slides joined with NUL so callers can split per slide. */
  private async extractOfficeNative(
    unzip: string,
    src: string,
    format: "pptx" | "docx",
  ): Promise<string> {
    if (format === "docx") {
      const { stdout } = await exec(unzip, ["-p", src, "word/document.xml"], { maxBuffer: MAX_BUFFER });
      return stripOfficeXml(stdout, "docx");
    }
    const { stdout: listing } = await exec(unzip, ["-Z1", src], { maxBuffer: MAX_BUFFER });
    const slides = sortSlideEntries(
      listing.split("\n").filter((l) => /^ppt\/slides\/slide\d+\.xml$/.test(l.trim())).map((l) => l.trim()),
    );
    const texts: string[] = [];
    for (const slide of slides) {
      const { stdout } = await exec(unzip, ["-p", src, slide], { maxBuffer: MAX_BUFFER });
      texts.push(stripOfficeXml(stdout, "pptx"));
    }
    return texts.join("\u0000");
  }

  private async extractImage(src: string, outDir: string): Promise<ExtractResult> {
    const pagesDir = join(outDir, "pages");
    await ensureDir(pagesDir);
    const dest = join(pagesDir, `page-1${extname(src).toLowerCase()}`);
    await cp(src, dest);

    // OCR photos (Tafelbilder, scans) so their text is searchable; the image stays primary.
    const tools = await this.getTools();
    let body = `(image file — view ${dest} to comprehend it)`;
    let tool = "copy";
    if (tools.tesseract && /\.(png|jpe?g|tiff?|bmp|webp)$/i.test(src)) {
      const text = await runOcr(tools.tesseract, src);
      if (text) {
        body = `_(OCR — verify against the image)_\n${text}`;
        tool = "copy+tesseract";
      }
    }

    await writeFile(
      join(outDir, "content.md"),
      renderContentMd(basename(src), "image", [body], true),
    );
    return { source: src, outDir, kind: "image", pages: 1, hasImages: true, tool };
  }

  private async extractText(src: string, outDir: string): Promise<ExtractResult> {
    const raw = await readFile(src, "utf-8");
    await writeFile(join(outDir, "content.md"), renderContentMd(basename(src), "text", [raw], false));
    return { source: src, outDir, kind: "text", pages: 1, tool: "passthrough" };
  }
}

/** OCR one image. German course materials first, plain default as fallback. */
async function runOcr(tesseract: string, imagePath: string): Promise<string> {
  const langs = [process.env.IMSTUDIUM_OCR_LANG || "deu+eng", ""];
  for (const lang of langs) {
    try {
      const args = [imagePath, "stdout", ...(lang ? ["-l", lang] : [])];
      const { stdout } = await exec(tesseract, args, { maxBuffer: MAX_BUFFER, timeout: 60_000 });
      const text = stdout.trim();
      if (text) return text;
    } catch {
      // missing language pack or unreadable image — try next
    }
  }
  return "";
}

export function extractSlug(filename: string): string {
  return slugify(filename.replace(/\.[^.]+$/, "")) + "-" + (extname(filename).slice(1).toLowerCase() || "file");
}

function renderContentMd(
  filename: string,
  label: string,
  pageTexts: string[],
  hasImages: boolean,
): string {
  const lines = [
    `# ${filename}`,
    "",
    `> Extracted ${label} · ${pageTexts.length} page(s)${hasImages ? " · rendered images in pages/ — READ the PNGs to visually comprehend diagrams, formulas, and layout" : ""}`,
    "",
  ];
  const unit = label === "slides" ? "Slide" : "Page";
  pageTexts.forEach((text, i) => {
    if (pageTexts.length > 1) lines.push(`## ${unit} ${i + 1}`, "");
    lines.push(text.trim() || "_(no extractable text — check the page image)_", "");
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
