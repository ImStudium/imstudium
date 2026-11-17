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
    .describe("Optional on-device math recognition (PP-DocLayoutV2 + UniRec-0.1B)"),
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

/** The on-device speech runtime as `setup speech` and `doctor` see it. */
export const SpeechRuntime = z.object({
  supported: z.boolean().describe("This platform has a pinned sherpa-onnx build (macOS arm64/x64, Linux x64/arm64, Windows x64)"),
  ready: z.boolean().describe("Installed for the pinned versions; extraction transcribes audio and video (ffmpeg must be on PATH too)"),
  disabled: z.boolean().describe("Switched off with IMSTUDIUM_SPEECH=off"),
  platform: z.string(),
  dir: z.string().describe("Where the runtime lives (IMSTUDIUM_SPEECH_DIR or ~/.local/share/imstudium/speech)"),
  model: z.string().describe("The model string every transcript.json carries"),
  vad: z.string(),
  engine: z.string(),
  downloadBytes: z.number().int().describe("What setup speech downloads on this platform"),
  ffmpeg: z.string().nullable().describe("ffmpeg on PATH, which decodes the recordings; null when missing"),
  threads: z.number().int().describe("Recognizer threads (IMSTUDIUM_SPEECH_THREADS, else half the cores, at most 8)"),
  reason: z.string().nullable().describe("Why recordings will not be transcribed, when they won't"),
});
export type SpeechRuntime = z.infer<typeof SpeechRuntime>;

/** `imstudium setup speech --json` (also with --force, --remove) */
export const SetupSpeechOutput = z
  .object({
    action: z.enum(["installed", "unchanged", "removed", "absent"]).describe("installed: something was fetched · unchanged: all in place · removed / absent: --remove"),
    runtime: SpeechRuntime,
    installed: z.array(z.string()).describe("Pieces fetched in this run: the sherpa-onnx binding and native library, the Parakeet encoder, decoder, joiner and tokens, the voice activity model"),
    skipped: z.array(z.string()).describe("Pieces already in place"),
    downloadedBytes: z.number().int(),
    diskBytes: z.number().int().describe("Size on disk after the run (freed bytes with --remove)"),
    durationMs: z.number().int(),
  })
  .describe("Install, verify and start the on-device speech runtime for lecture recordings, or remove it");
export type SetupSpeechOutput = z.infer<typeof SetupSpeechOutput>;

/** OCR totals for `sync --extract` and `extract`. */
export const OcrSummary = z.object({
  files: z.number().int().describe("Files with at least one page read by on-device OCR"),
  pages: z.number().int().describe("Pages read by OCR"),
  lowConfidencePages: z.number().int().describe("OCR pages below the confidence threshold, marked in content.md"),
  imageOnlyPages: z.number().int().describe("Pages that still have no text"),
  recoveredPages: z.number().int().default(0).describe("Pages whose own text layer was recovered through PDFium on the OCR path (the PDF's text, not OCR)"),
  formulas: z.number().int().describe("Display formulas read into LaTeX on this machine ($$…$$ in content.md, boxes in math.json)"),
  formulasChecked: z.number().int().default(0).describe("Of those, checked against the PDF's own text (or corrected so they check)"),
  formulasNeedLook: z.number().int().default(0).describe("Of those, whose check didn't pass: imstudium formulas list <file> --needs-look"),
  formulasUnchecked: z.number().int().default(0).describe("Of those, not fully checkable against the PDF: scanned pages, formulas that are pictures, and formulas partly drawn as pictures"),
});
export type OcrSummary = z.infer<typeof OcrSummary>;
