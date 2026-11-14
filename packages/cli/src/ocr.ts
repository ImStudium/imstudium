import { mathRuntimeStatus, ocrRuntimeStatus, PDFIUM_VERSION, ONNXRUNTIME_VERSION, type MathRuntimeStatus, type OcrRuntimeStatus, type OcrSummary } from "@imstudium/sdk";
import type { OcrRuntime } from "@imstudium/contract";

/** The runtime as the contract shows it (`setup ocr`, `doctor`). */
export function ocrRuntimeView(status: OcrRuntimeStatus = ocrRuntimeStatus(), math: MathRuntimeStatus = mathRuntimeStatus()): OcrRuntime {
  return {
    supported: status.supported,
    ready: status.ready,
    disabled: status.disabled,
    platform: status.platform,
    dir: status.dir,
    model: status.model,
    pins: { pdfium: PDFIUM_VERSION, onnxruntime: ONNXRUNTIME_VERSION },
    installed: status.installed,
    reason: status.reason,
    math: {
      ready: math.ready,
      disabled: math.disabled,
      model: math.model,
      layoutModel: math.layoutModel,
      downloadBytes: math.downloadBytes,
      reason: math.reason,
    },
  };
}

/** Size of the OCR folder on disk (math included). */
export async function ocrDiskBytes(dir: string): Promise<number> {
  const { readdir, stat } = await import("node:fs/promises");
  const { join } = await import("node:path");
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) total += await ocrDiskBytes(p);
    else if (entry.isFile()) total += (await stat(p).catch(() => ({ size: 0 }))).size;
  }
  return total;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** "OCR read 12 pages in 3 files (1 low confidence)" — empty when OCR read nothing and nothing is left unread. */
export function ocrSummaryLine(ocr: OcrSummary, status: Pick<OcrRuntimeStatus, "ready" | "supported" | "disabled"> = ocrRuntimeStatus()): string {
  const parts: string[] = [];
  if (ocr.pages) {
    parts.push(
      `on-device OCR read ${ocr.pages} page${ocr.pages === 1 ? "" : "s"} in ${ocr.files} file${ocr.files === 1 ? "" : "s"}${ocr.lowConfidencePages ? ` (${ocr.lowConfidencePages} with low confidence, marked in content.md)` : ""}`,
    );
  }
  if (ocr.recoveredPages) parts.push(`${ocr.recoveredPages} page${ocr.recoveredPages === 1 ? "" : "s"} of text recovered from the PDF's own text layer`);
  if (ocr.formulas) {
    const checks = [
      ocr.formulasChecked ? `${ocr.formulasChecked} checked against the PDF` : "",
      ocr.formulasNeedLook ? `${ocr.formulasNeedLook} need${ocr.formulasNeedLook === 1 ? "s" : ""} a look` : "",
      ocr.formulasUnchecked ? `${ocr.formulasUnchecked} can't be checked (scans and picture formulas)` : "",
    ].filter(Boolean);
    parts.push(`${ocr.formulas} formula${ocr.formulas === 1 ? "" : "s"} read as LaTeX${checks.length ? `: ${checks.join(", ")}` : ""}`);
  }
  if (ocr.imageOnlyPages) {
    const tip = !status.ready && status.supported && !status.disabled ? ": imstudium setup ocr reads them on this machine" : "";
    parts.push(`${ocr.imageOnlyPages} page${ocr.imageOnlyPages === 1 ? "" : "s"} without text${tip}`);
  }
  return parts.join(" · ");
}
