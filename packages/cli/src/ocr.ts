import { ocrRuntimeStatus, PDFIUM_VERSION, ONNXRUNTIME_VERSION, type OcrRuntimeStatus, type OcrSummary } from "@imstudium/sdk";
import type { OcrRuntime } from "@imstudium/contract";

/** The runtime as the contract shows it (`setup ocr`, `doctor`). */
export function ocrRuntimeView(status: OcrRuntimeStatus = ocrRuntimeStatus()): OcrRuntime {
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
  };
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
  if (ocr.imageOnlyPages) {
    const tip = !status.ready && status.supported && !status.disabled ? ": imstudium setup ocr reads them on this machine" : "";
    parts.push(`${ocr.imageOnlyPages} page${ocr.imageOnlyPages === 1 ? "" : "s"} without text${tip}`);
  }
  return parts.join(" · ");
}
