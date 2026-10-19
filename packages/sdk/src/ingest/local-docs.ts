/**
 * Single local ingest pipeline — Firecrawl AnyDoc + pdf-inspector.
 * No API key, no Tesseract, no poppler, no LibreOffice.
 *
 *   PDF      → pdf-inspector extractPagesMarkdownAsync
 *   Office   → AnyDoc toMarkdownBytes
 *   scanned  → image-only page markers (no OCR)
 */
import { Buffer } from "node:buffer";
import { formatFromBytes, formatFromPath, toMarkdownBytes } from "@firecrawl/anydoc";
import { extractPagesMarkdownAsync } from "@firecrawl/pdf-inspector";

export type LocalEngine = "pdf-inspector" | "anydoc";

export type LocalPage = {
  /** 0-based */
  index: number;
  markdown: string;
  imageOnly?: boolean;
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

const IMAGE_ONLY = "_(image-only page — no text layer)_";

function asError(err: unknown, fallback: string): Error {
  return err instanceof Error ? err : new Error(fallback);
}

async function convertPdf(bytes: Uint8Array): Promise<LocalConvertResult> {
  try {
    const extracted = await extractPagesMarkdownAsync(toNodeBuffer(bytes));
    const pages: LocalPage[] = extracted.pages.map((p) => {
      const markdown = (p.markdown ?? "").trim();
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

async function convertAnydoc(bytes: Uint8Array, fileName: string): Promise<LocalConvertResult> {
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
): Promise<LocalConvertResult> {
  const name = fileName.trim().split(/[/\\]/).pop() || fileName;
  const sniffed = formatFromBytes(bytes);
  if (isPdfFileName(name) || sniffed === "pdf") return convertPdf(bytes);
  return convertAnydoc(bytes, name);
}

export async function probeLocalIngest(): Promise<{
  anydoc: boolean;
  pdfInspector: boolean;
  error?: string;
}> {
  try {
    formatFromPath("lecture.pptx");
    toNodeBuffer(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
    return { anydoc: true, pdfInspector: true };
  } catch (err) {
    return {
      anydoc: false,
      pdfInspector: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
