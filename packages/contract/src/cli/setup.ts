import { z } from "zod";

const OcrInstalled = z.object({
  platform: z.string(),
  pdfium: z.string(),
  onnxruntime: z.string(),
  model: z.string(),
  installedAt: z.string(),
});

/** The on-device OCR runtime as `setup ocr` and `doctor` see it. */
export const OcrRuntime = z.object({
  supported: z.boolean().describe("This platform has a pinned runtime (macOS arm64, Linux x64/arm64, Windows x64)"),
  ready: z.boolean().describe("Installed for the pinned versions; extraction will OCR pages without a text layer"),
  disabled: z.boolean().describe("Switched off with IMSTUDIUM_OCR=off"),
  platform: z.string().describe("e.g. darwin-arm64"),
  dir: z.string().describe("Where the runtime lives (IMSTUDIUM_OCR_DIR or ~/.local/share/imstudium/ocr)"),
  model: z.string(),
  pins: z.object({ pdfium: z.string(), onnxruntime: z.string() }).describe("The versions this CLI installs"),
  installed: OcrInstalled.nullable().describe("What is on disk, also when it is for older pins"),
  reason: z.string().nullable().describe("Why OCR will not run, when it won't"),
  math: z
    .object({
      ready: z.boolean().describe("Display formulas are read into LaTeX at extraction (setup ocr --math)"),
      disabled: z.boolean().describe("Switched off with IMSTUDIUM_MATH=off or IMSTUDIUM_OCR=off"),
      model: z.string(),
      layoutModel: z.string(),
      downloadBytes: z.number().int().describe("What setup ocr --math downloads"),
      reason: z.string().nullable(),
    })
    .describe("Optional on-device math recognition (PP-DocLayout-S + PP-FormulaNet+ S)"),
});
export type OcrRuntime = z.infer<typeof OcrRuntime>;

/** `imstudium setup ocr --json` (also with --force, --remove) */
export const SetupOcrOutput = z
  .object({
    action: z.enum(["installed", "unchanged", "removed", "absent"]).describe("installed: something was fetched · unchanged: all in place · removed / absent: --remove"),
    runtime: OcrRuntime,
    installed: z.array(z.string()).describe("Pieces fetched in this run: PDFium, ONNX Runtime, models, and with --math the binding, renderer and math models"),
    skipped: z.array(z.string()).describe("Pieces already in place"),
    downloadedBytes: z.number().int(),
    diskBytes: z.number().int().describe("Size on disk after the run (freed bytes with --remove)"),
    durationMs: z.number().int(),
  })
  .describe("Install, verify and warm the on-device OCR runtime, or remove it");
export type SetupOcrOutput = z.infer<typeof SetupOcrOutput>;

/** OCR totals for `sync --extract` and `extract`. */
export const OcrSummary = z.object({
  files: z.number().int().describe("Files with at least one page read by on-device OCR"),
  pages: z.number().int().describe("Pages read by OCR"),
  lowConfidencePages: z.number().int().describe("OCR pages below the confidence threshold, marked in content.md"),
  imageOnlyPages: z.number().int().describe("Pages that still have no text"),
  formulas: z.number().int().describe("Display formulas read into LaTeX on this machine ($$…$$ in content.md, boxes in math.json)"),
});
export type OcrSummary = z.infer<typeof OcrSummary>;
