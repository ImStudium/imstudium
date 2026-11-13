/**
 * On-device math recognition: display formulas on a PDF page become LaTeX.
 *
 *   PDFium (WASM, @hyzyla/pdfium)  renders the page, and reads its text layer for the check
 *   PP-DocLayoutV2                 finds display formulas (layout class "display_formula")
 *   UniRec-0.1B                    reads each crop into LaTeX (encoder + decoder with a KV cache)
 *   unirec_tokenizer_mapping.json  turns its tokens into text (byte-level BPE)
 *
 * The layout model comes from oar-ocr's GitHub release v0.3.0, UniRec-0.1B
 * from its authors' ONNX export (huggingface.co/topdu/unirec_0_1b_onnx,
 * Apache-2.0), both run on ONNX Runtime 1.27.0 through the onnxruntime-node
 * binding. Everything is a pinned, SHA-256-verified download that `imstudium
 * setup ocr --math` puts under <ocr>/math/; nothing here is an npm dependency,
 * and nothing leaves the machine. They were chosen on the hard Beamer slides
 * of the benchmark (docs/BENCHMARKS.md): the layout model finds every formula
 * there, and UniRec-0.1B read more of them exactly than PP-FormulaNet+ L,
 * GLM-OCR, TexTeller 3 and pix2text-mfr, and as many as PaddleOCR-VL-1.6 at
 * about a seventeenth of its time: about a second per formula.
 *
 * Every reading is checked (judgeFormula): its LaTeX must be well-formed and,
 * on a born-digital page, show exactly the letters and digits the PDF has in
 * the formula's box. Inline math (`$x_i$` inside a sentence) stays as
 * pdf-inspector's native text.
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { availableParallelism } from "node:os";
import { basename, join } from "node:path";
import { ImstudiumError } from "../errors.js";
import { buildPdf, dirBytes, downloadToFile, ocrPlatformKey, ocrRoot, OCR_RUNTIMES } from "./ocr-runtime.js";
import { encodePng } from "./png.js";

export const MATH_MODEL = "unirec-0.1b (topdu/unirec_0_1b_onnx e8f55f7)";
export const LAYOUT_MODEL = "pp-doclayoutv2 (oar-ocr v0.3.0)";
const OAR = "https://github.com/GreatV/oar-ocr/releases/download/v0.3.0";
const UNIREC = "https://huggingface.co/topdu/unirec_0_1b_onnx/resolve/e8f55f72013d544cbd6c27c576946ac63da247ed";
const NPM = "https://registry.npmjs.org";

interface MathAsset {
  label: string;
  url: string;
  sha256: string;
  bytes: number;
  /** npm: a package tarball unpacked to node_modules/<name>; file: saved as models/<name>. */
  kind: "npm" | "file";
  name: string;
  /** npm only: members to unpack (relative to package/); the platform's binary folder for the binding. */
  members?: (platformKey: string) => string[];
}

const ORT_PLATFORM_DIR: Record<string, string> = {
  "darwin-arm64": "darwin/arm64",
  "linux-x64": "linux/x64",
  "linux-arm64": "linux/arm64",
  "win32-x64": "win32/x64",
};

export const MATH_ASSETS: MathAsset[] = [
  {
    label: "ONNX Runtime binding",
    kind: "npm",
    name: "onnxruntime-node",
    url: `${NPM}/onnxruntime-node/-/onnxruntime-node-1.27.0.tgz`,
    sha256: "c3779c01c59832f8c03e2c392ac3af10bf08579f1822e8b1c63cc451edb302a2",
    bytes: 100_893_124,
    members: (key) => ["package.json", "dist", `bin/napi-v6/${ORT_PLATFORM_DIR[key]}`],
  },
  {
    label: "ONNX Runtime common",
    kind: "npm",
    name: "onnxruntime-common",
    url: `${NPM}/onnxruntime-common/-/onnxruntime-common-1.27.0.tgz`,
    sha256: "37faaa5883b7f317b0f357ae8b2f4f8c8d97d177638be12cbcdf8239d75bbd7b",
    bytes: 66_082,
    members: () => ["package.json", "dist/cjs"],
  },
  {
    label: "PDFium (WASM)",
    kind: "npm",
    name: "@hyzyla/pdfium",
    url: `${NPM}/@hyzyla/pdfium/-/pdfium-3.0.0.tgz`,
    sha256: "35ae2bd7aeb538927cb55de82bd8b9c2f629a2e6b2ca3960c6145c4f1024e857",
    bytes: 5_858_038,
    members: () => ["package.json", "LICENSE.md", "dist/index.cjs", "dist/pdfium.wasm"],
  },
  {
    label: "formula encoder",
    kind: "file",
    name: "unirec_encoder.onnx",
    url: `${UNIREC}/unirec_encoder.onnx`,
    sha256: "eb6b5d38f16c4f1abc39bab47e8d4ec83103b3246f642bde599edf6634289392",
    bytes: 164_645_880,
  },
  {
    label: "formula decoder",
    kind: "file",
    name: "unirec_decoder.onnx",
    url: `${UNIREC}/unirec_decoder.onnx`,
    sha256: "334326c877856d7595614424f1e15d6b1aab6ba24c26c769f09ab38901d5021c",
    bytes: 554_415_797,
  },
  {
    label: "formula tokens",
    kind: "file",
    name: "unirec_tokenizer_mapping.json",
    url: `${UNIREC}/unirec_tokenizer_mapping.json`,
    sha256: "769c66284765415c022ec213ea7b5e5266824aef5c5ea61d72b9ef087da525cc",
    bytes: 9_843_868,
  },
  {
    label: "layout model",
    kind: "file",
    name: "pp-doclayoutv2.onnx",
    url: `${OAR}/pp-doclayoutv2.onnx`,
    sha256: "a325532df1c7530538ef4e8254695c091adc6afd3366c0851425491f0816d1d1",
    bytes: 213_969_379,
  },
];

/** The pinned models, by file name (the engine loads these unless the benchmark points elsewhere). */
const LAYOUT_FILE = "pp-doclayoutv2.onnx";
const ENCODER_FILE = "unirec_encoder.onnx";
const DECODER_FILE = "unirec_decoder.onnx";
const TOKENS_FILE = "unirec_tokenizer_mapping.json";

export const mathDir = () => join(ocrRoot(), "math");
const modulesDir = () => join(mathDir(), "node_modules");
const modelsDir = () => join(mathDir(), "models");
const mathMarker = () => join(mathDir(), "math.json");
/** Each asset's SHA-256 once it was verified and put in place, written as the install goes (a broken run keeps what it finished). */
const verifiedFile = () => join(mathDir(), "verified.json");
/** Partial downloads, kept across runs so the next one resumes. */
const downloadsDir = () => join(mathDir(), "downloads");

function assetPath(a: MathAsset): string {
  return a.kind === "npm" ? join(modulesDir(), a.name, "package.json") : join(modelsDir(), a.name);
}

export function mathDisabledByEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return /^(0|off|false|no)$/i.test((env.IMSTUDIUM_MATH ?? "").trim());
}

export interface MathRuntimeStatus {
  supported: boolean;
  ready: boolean;
  /** IMSTUDIUM_MATH=off (or IMSTUDIUM_OCR=off). */
  disabled: boolean;
  dir: string;
  model: string;
  layoutModel: string;
  /** Total download for `setup ocr --math`. */
  downloadBytes: number;
  reason: string | null;
}

function readMathMarker(): { model?: string; layoutModel?: string } | null {
  try {
    return JSON.parse(readFileSync(mathMarker(), "utf-8")) as { model?: string; layoutModel?: string };
  } catch {
    return null;
  }
}

/** Whether math recognition can run here — no network, no native loading. */
export function mathRuntimeStatus(): MathRuntimeStatus {
  const key = ocrPlatformKey();
  const supported = !!OCR_RUNTIMES[key] && !!ORT_PLATFORM_DIR[key];
  const marker = readMathMarker();
  const complete = MATH_ASSETS.every((a) => existsSync(assetPath(a)));
  const current = marker?.model === MATH_MODEL && marker?.layoutModel === LAYOUT_MODEL;
  const disabled = mathDisabledByEnv() || /^(0|off|false|no)$/i.test((process.env.IMSTUDIUM_OCR ?? "").trim());
  const bun = typeof (process.versions as Record<string, string | undefined>).bun === "string";
  const ready = supported && complete && current && !bun;
  const reason = !supported
    ? `no pinned math runtime for ${key}`
    : !marker && !complete
      ? "not installed"
      : !current || !complete
        ? "incomplete or for older pins"
        : bun
          ? "runs under Node only"
          : disabled
            ? "switched off (IMSTUDIUM_MATH=off)"
            : null;
  return {
    supported,
    ready,
    disabled,
    dir: mathDir(),
    model: MATH_MODEL,
    layoutModel: LAYOUT_MODEL,
    downloadBytes: MATH_ASSETS.reduce((n, a) => n + a.bytes, 0),
    reason,
  };
}

async function unpackMembers(archive: string, into: string, members: string[]): Promise<void> {
  const { execFile } = await import("node:child_process");
  await mkdir(into, { recursive: true });
  await new Promise<void>((resolve, reject) =>
    execFile(
      "tar",
      ["--no-same-owner", "-xzf", archive, "-C", into, "--strip-components=1", ...members.map((m) => `package/${m}`)],
      { maxBuffer: 16 * 1024 * 1024 },
      (err, _out, stderr) => (err ? reject(new ImstudiumError(`Unpacking ${archive} failed: ${stderr || err.message}`, "OCR_INSTALL_FAILED")) : resolve()),
    ),
  );
}

export interface MathInstallResult {
  installed: string[];
  skipped: string[];
  downloadedBytes: number;
  diskBytes: number;
}

async function readVerified(): Promise<Record<string, string>> {
  try {
    return JSON.parse(await readFile(verifiedFile(), "utf-8")) as Record<string, string>;
  } catch {
    return {};
  }
}

/**
 * Whether `a` is in place as pinned: its SHA-256 was recorded when it was
 * verified. An install from before the record existed only put a file in place
 * after verifying it, so a file without a record counts when the old marker
 * names the same SHA-256 or names none (a run that broke off before the marker).
 */
export function assetUpToDate(a: Pick<MathAsset, "name" | "sha256">, present: boolean, verified: Record<string, string>, legacy: Record<string, string> | undefined): boolean {
  if (!present) return false;
  if (verified[a.name]) return verified[a.name] === a.sha256;
  return !legacy?.[a.name] || legacy[a.name] === a.sha256;
}

/**
 * Download, verify and unpack the math pieces, then prove one formula reads.
 * Idempotent and incremental: pieces already verified are kept, a download
 * that broke off resumes where it stopped (also in the next run), and a piece
 * whose pin changed is fetched again. `force` refetches everything.
 */
export async function installMathRuntime(options: { force?: boolean; onProgress?: (msg: string) => void; fetchImpl?: typeof fetch } = {}): Promise<MathInstallResult> {
  const key = ocrPlatformKey();
  if (!OCR_RUNTIMES[key] || !ORT_PLATFORM_DIR[key]) {
    throw new ImstudiumError(`No local math runtime for ${key}`, "OCR_UNSUPPORTED", undefined, undefined, { platform: key });
  }
  const installed: string[] = [];
  const skipped: string[] = [];
  let downloadedBytes = 0;
  if (options.force) await rm(mathDir(), { recursive: true, force: true });
  await mkdir(modelsDir(), { recursive: true });
  const verified = await readVerified();
  const legacy = (readMathMarker() as { sha256?: Record<string, string> } | null)?.sha256;
  for (const a of MATH_ASSETS) {
    if (assetUpToDate(a, existsSync(assetPath(a)), verified, legacy)) {
      skipped.push(a.label);
      continue;
    }
    options.onProgress?.(`downloading ${a.url.split("/").pop()} (${Math.round(a.bytes / 1e6)} MB)`);
    const target = a.kind === "file" ? assetPath(a) : join(downloadsDir(), basename(a.url));
    if (a.kind === "file") await rm(target, { force: true });
    downloadedBytes += await downloadToFile(a.url, a.sha256, target, { onProgress: options.onProgress, ...(options.fetchImpl ? { fetchImpl: options.fetchImpl, waitMs: 0 } : {}) });
    options.onProgress?.(`verified ${a.url.split("/").pop()} (sha256 ${a.sha256.slice(0, 12)}…)`);
    if (a.kind === "npm") {
      const dest = join(modulesDir(), a.name);
      const staging = `${dest}.staging`;
      await rm(staging, { recursive: true, force: true });
      await unpackMembers(target, staging, a.members!(key));
      await rm(dest, { recursive: true, force: true });
      await mkdir(join(dest, ".."), { recursive: true });
      await rename(staging, dest);
      await rm(target, { force: true });
    }
    verified[a.name] = a.sha256;
    await writeFile(verifiedFile(), `${JSON.stringify(verified, null, 2)}\n`);
    installed.push(a.label);
  }
  await rm(downloadsDir(), { recursive: true, force: true });
  // Models an earlier version pinned (e.g. the small ones before 0.3) are no longer used: free their space.
  const pinned = new Set(MATH_ASSETS.filter((a) => a.kind === "file").map((a) => a.name));
  for (const name of await readdir(modelsDir()).catch(() => [] as string[])) {
    if (!pinned.has(name) && /\.(onnx|json)$/.test(name)) await unlink(join(modelsDir(), name)).catch(() => {});
  }
  // One synthetic formula proves the binding, the renderer and both models load and agree.
  options.onProgress?.("checking a formula read on this machine");
  resetMathEngine();
  try {
    const probe = await probeMathRuntime();
    if (!probe.replace(/\s+/g, "").startsWith("E=mc")) throw new Error(`the probe formula E = mc² read as "${probe}"`);
  } catch (err) {
    throw new ImstudiumError(`The math runtime did not start: ${err instanceof Error ? err.message : String(err)}`, "OCR_INSTALL_FAILED", undefined, "Run: imstudium setup ocr --math --force");
  }
  await writeFile(mathMarker(), `${JSON.stringify({ model: MATH_MODEL, layoutModel: LAYOUT_MODEL, platform: key, installedAt: new Date().toISOString(), sha256: Object.fromEntries(MATH_ASSETS.map((a) => [a.name, a.sha256])) }, null, 2)}\n`);
  return { installed, skipped, downloadedBytes, diskBytes: await dirBytes(mathDir()) };
}

export async function removeMathRuntime(): Promise<{ removed: boolean; freedBytes: number }> {
  if (!existsSync(mathDir())) return { removed: false, freedBytes: 0 };
  const freedBytes = await dirBytes(mathDir());
  await rm(mathDir(), { recursive: true, force: true });
  resetMathEngine();
  return { removed: true, freedBytes };
}

// ── Engine ───────────────────────────────────────────────────────────────────

interface OrtTensor {
  data: ArrayLike<number | bigint>;
  dims: readonly number[];
  type: string;
}
interface OrtSession {
  inputNames: readonly string[];
  outputNames: readonly string[];
  inputMetadata?: ReadonlyArray<{ name: string; shape?: ReadonlyArray<number | string> }>;
  run(feeds: Record<string, unknown>): Promise<Record<string, OrtTensor>>;
}
interface Ort {
  InferenceSession: { create(path: string, options?: Record<string, unknown>): Promise<OrtSession> };
  Tensor: new (type: string, data: Float32Array | BigInt64Array, dims: number[]) => unknown;
}
/** The raw PDFium calls the glyph check needs (exported by @hyzyla/pdfium 3.0.0's WASM module). */
interface PdfiumModule {
  _FPDFText_LoadPage(page: number): number;
  _FPDFText_ClosePage(textPage: number): void;
  _FPDFText_CountChars(textPage: number): number;
  _FPDFText_GetUnicode(textPage: number, index: number): number;
  _FPDFText_HasUnicodeMapError(textPage: number, index: number): number;
  _FPDFText_GetCharBox(textPage: number, index: number, left: number, right: number, bottom: number, top: number): number;
  _FPDFText_GetFontInfo(textPage: number, index: number, buffer: number, buflen: number, flags: number): number;
  _FPDF_PageToDevice(page: number, startX: number, startY: number, sizeX: number, sizeY: number, rotate: number, pageX: number, pageY: number, deviceX: number, deviceY: number): number;
  wasmExports: { malloc(n: number): number; free(p: number): void };
  HEAPU8: Uint8Array;
}
interface PdfiumPage {
  render(options: { scale: number; render: "bitmap"; colorSpace?: "RGBA" | "Gray" }): Promise<{ width: number; height: number; data: Uint8Array }>;
  getOriginalSize(): { originalWidth: number; originalHeight: number };
  close(): void;
  module?: PdfiumModule;
  pageIdx?: number;
}
interface PdfiumDocument {
  getPageCount(): number;
  getPage(i: number): PdfiumPage;
  destroy(): void;
}
interface PdfiumLibrary {
  loadDocument(bytes: Uint8Array): Promise<PdfiumDocument>;
}

interface Engine {
  ort: Ort;
  pdfium: PdfiumLibrary;
  layout: OrtSession;
  encoder: OrtSession;
  decoder: OrtSession;
  /** UniRec's tokens by id, and its special ids. */
  tokens: string[];
  special: { bos: number; eos: number; pad: number };
  /** Decoder cache: layers, heads and head size, from the model's inputs. */
  kv: { layers: number; heads: number; dim: number };
  /** Square input side of the layout model (800 for PP-DocLayoutV2). */
  layoutInput: number;
  /** Layout classes that are display formulas. */
  formulaClasses: number[];
  /** Layout classes for inline formulas and for running text (see displayLikeInline); empty when unknown. */
  inlineClasses: number[];
  textClasses: number[];
}

/** Display-formula class ids per layout model (PP-DocLayoutV2 has its own label list). */
const FORMULA_CLASSES: Record<string, number[]> = { "pp-doclayoutv2.onnx": [5] };
/** PP-DocLayoutV2's inline_formula and text classes. */
const INLINE_CLASSES: Record<string, number[]> = { "pp-doclayoutv2.onnx": [15] };
const TEXT_CLASSES: Record<string, number[]> = { "pp-doclayoutv2.onnx": [22] };
/** Class 7 ("formula") in the PP-DocLayout family other than V2. */

/** The square side of a model input from its metadata, e.g. image:[1,3,480,480] → 480. */
function inputSide(session: OrtSession, name: string, fallback: number): number {
  const shape = session.inputMetadata?.find((m) => m.name === name)?.shape;
  const side = shape?.[shape.length - 1];
  return typeof side === "number" && side > 0 ? side : fallback;
}

let engine: Promise<Engine> | null = null;
let pdfiumOnly: Promise<PdfiumLibrary> | null = null;

export function resetMathEngine(): void {
  engine = null;
  pdfiumOnly = null;
}

/** PDFium alone (WASM, a few MB): enough to render pages and read the text layer, without loading the models. */
function getPdfium(): Promise<PdfiumLibrary> {
  pdfiumOnly ??= (async () => {
    const req = createRequire(join(modulesDir(), "loader.cjs"));
    const { PDFiumLibrary } = req("@hyzyla/pdfium") as { PDFiumLibrary: { init(o?: { wasmBinary?: Uint8Array }): Promise<PdfiumLibrary> } };
    const wasmBinary = await readFile(join(modulesDir(), "@hyzyla", "pdfium", "dist", "pdfium.wasm"));
    return PDFiumLibrary.init({ wasmBinary });
  })().catch((err) => {
    pdfiumOnly = null;
    throw err;
  });
  return pdfiumOnly;
}

async function loadEngine(): Promise<Engine> {
  const req = createRequire(join(modulesDir(), "loader.cjs"));
  const ort = req("onnxruntime-node") as Ort;
  const pdfium = await getPdfium();
  const threads = Math.max(1, Math.min(4, availableParallelism()));
  // Benchmark only: IMSTUDIUM_MATH_LAYOUT points at another layout model file to compare it.
  const layoutFile = process.env.IMSTUDIUM_MATH_LAYOUT || join(modelsDir(), LAYOUT_FILE);
  const options = { intraOpNumThreads: threads, interOpNumThreads: 1, graphOptimizationLevel: "all" };
  const layout = await ort.InferenceSession.create(layoutFile, { intraOpNumThreads: threads });
  const encoder = await ort.InferenceSession.create(join(modelsDir(), ENCODER_FILE), options);
  const decoder = await ort.InferenceSession.create(join(modelsDir(), DECODER_FILE), options);
  const map = JSON.parse(await readFile(join(modelsDir(), TOKENS_FILE), "utf-8")) as {
    id_to_token: Record<string, string>;
    special_tokens: { bos_token_id: number; eos_token_id: number; pad_token_id: number };
  };
  const tokens: string[] = [];
  for (const [id, t] of Object.entries(map.id_to_token)) tokens[Number(id)] = t;
  const past = decoder.inputMetadata?.find((m) => m.name === "past_key_0")?.shape;
  return {
    ort,
    pdfium,
    layout,
    encoder,
    decoder,
    tokens,
    special: { bos: map.special_tokens.bos_token_id, eos: map.special_tokens.eos_token_id, pad: map.special_tokens.pad_token_id },
    kv: {
      layers: decoder.inputNames.filter((n) => n.startsWith("past_key_")).length,
      heads: typeof past?.[1] === "number" ? past[1] : 6,
      dim: typeof past?.[3] === "number" ? past[3] : 128,
    },
    layoutInput: inputSide(layout, "image", LAYOUT_INPUT),
    formulaClasses: FORMULA_CLASSES[basename(layoutFile)] ?? [FORMULA_CLASS],
    inlineClasses: INLINE_CLASSES[basename(layoutFile)] ?? [],
    textClasses: TEXT_CLASSES[basename(layoutFile)] ?? [],
  };
}

function getEngine(): Promise<Engine> {
  engine ??= loadEngine().catch((err) => {
    engine = null;
    throw err;
  });
  return engine;
}

// ── Pure parts (tested without the models) ───────────────────────────────────

/** GPT-2 byte-level alphabet: the character each byte is written as in the vocabulary. */
const BYTE_OF_CHAR: Map<string, number> = (() => {
  const bs: number[] = [];
  for (let b = 33; b <= 126; b++) bs.push(b);
  for (let b = 161; b <= 172; b++) bs.push(b);
  for (let b = 174; b <= 255; b++) bs.push(b);
  const cs = [...bs];
  let n = 0;
  for (let b = 0; b < 256; b++) {
    if (!bs.includes(b)) {
      bs.push(b);
      cs.push(256 + n++);
    }
  }
  return new Map(cs.map((c, i) => [String.fromCodePoint(c), bs[i]!]));
})();

/**
 * UniRec token ids → text: stop at the end token, drop the other special
 * tokens (`<|…|>`; `<|sn|>` is a line break in text, a space here), undo the
 * byte-level encoding (Ġ is a space, Ċ a newline, multi-byte UTF-8 rejoins).
 */
export function decodeUnirecTokens(ids: Iterable<number>, tokens: readonly string[], eos: number): string {
  let text = "";
  const bytes: number[] = [];
  const flush = () => {
    text += Buffer.from(bytes).toString("utf-8");
    bytes.length = 0;
  };
  for (const id of ids) {
    if (id === eos) break;
    const t = tokens[id];
    if (t === undefined) continue;
    if (/^<\|.*\|>$/.test(t)) {
      flush();
      if (t === "<|sn|>") text += " ";
      continue;
    }
    for (const ch of t) {
      const b = BYTE_OF_CHAR.get(ch);
      if (b !== undefined) bytes.push(b);
    }
  }
  flush();
  return text;
}

/** A relation that starts a continuation line of a derivation (`= …`, `\le …`). */
const LEADING_RELATION = /^(=|<|>|\\(?:leq?|geq?|approx|equiv|sim|neq?|Rightarrow|Leftrightarrow|iff|to|subseteq?)(?![a-zA-Z]))/;

/**
 * UniRec writes a formula the way a document shows it: inside `\[ … \]` or
 * `$$ … $$`, now and then with an equation number after it (`\[ … \](1)`),
 * and a multi-line derivation as one display per line (`a = b \]\[ = c`).
 * This gives the bare formula: the wrapper and a trailing equation number go
 * (the number is not part of the formula), and lines become an `aligned`
 * block aligned at their leading relation, or `gathered` when they have none.
 * Nothing inside a line is changed.
 */
export function unirecLatex(raw: string): string {
  let s = raw.trim().replace(/^\$\$([\s\S]*)\$\$$/, "$1").trim();
  s = s.replace(/\\\]\s*\(\s*\d+(?:\.\d+)*\s*\)\s*$/, "\\]");
  if (s.startsWith("\\[") && s.endsWith("\\]")) s = s.slice(2, -2).trim();
  else if (s.startsWith("\\(") && s.endsWith("\\)")) s = s.slice(2, -2).trim();
  const lines = s.split(/\\\]\s*\\\[/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return lines[0] ?? "";
  if (!lines.slice(1).every((l) => LEADING_RELATION.test(l))) return `\\begin{gathered}${lines.join("\\\\")}\\end{gathered}`;
  return `\\begin{aligned}${[alignAtRelation(lines[0]!), ...lines.slice(1).map((l) => `&${l}`)].join("\\\\")}\\end{aligned}`;
}

/** `&` before the first relation outside braces (`\\sum_{i=1}` keeps its `=`), or at the end when there is none. */
function alignAtRelation(line: string): string {
  let depth = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === "\\" && (line[i + 1] === "{" || line[i + 1] === "}")) {
      i++;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (depth === 0 && (ch === "\\" || "=<>".includes(ch)) && LEADING_RELATION.test(line.slice(i)) && !(ch === "\\" && /^\\(to|sim)/.test(line.slice(i)))) return `${line.slice(0, i)}&${line.slice(i)}`;
  }
  return `${line}&`;
}

/**
 * The model writes LaTeX as space-separated tokens ("E [ X ] = \sum _ { i }").
 * Port of PaddleOCR's LaTeXOCRDecode.post_process: drop spaces between
 * non-letters and between a letter and a non-letter, keep spaces between
 * letters (so "\sum x" stays a command plus a variable), keep "\ " thin spaces.
 * A trailing sentence period the model often adds is dropped.
 */
export function normalizeLatex(raw: string): string {
  const textCommand = /(\\(operatorname|mathrm|text|mathbf)\s?\*? \{.*?\})/g;
  let s = raw.replace(/"/g, "").replace(textCommand, (m) => m.replace(/ /g, ""));
  const noletter = String.raw`[\W_^\d]`;
  const letter = "[a-zA-Z]";
  const rules = [
    new RegExp(String.raw`(?!\\ )(${noletter})\s+?(${noletter})`, "g"),
    new RegExp(String.raw`(?!\\ )(${noletter})\s+?(${letter})`, "g"),
    new RegExp(String.raw`(${letter})\s+?(${noletter})`, "g"),
  ];
  for (let round = 0; round < 50; round++) {
    const next = rules.reduce((acc, re) => acc.replace(re, "$1$2"), s);
    if (next === s) break;
    s = next;
  }
  s = s.trim();
  // A trailing full stop or comma is sentence punctuation, except the one that closes \right. (an empty delimiter).
  return /\\right\s*\.$/.test(s) ? s : s.replace(/\s*[.,]$/, "").trim();
}

// ── Glyph check: does the LaTeX show the letters and digits the PDF has in that box? ──

const GREEK: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε", zeta: "ζ", eta: "η", theta: "θ", vartheta: "θ",
  iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", varpi: "π", rho: "ρ", varrho: "ρ", sigma: "σ", varsigma: "σ",
  tau: "τ", upsilon: "υ", phi: "φ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ", Upsilon: "Υ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
};
/** Commands typeset as their own name in upright letters. */
const NAMED = new Set(["log", "ln", "lg", "exp", "sin", "cos", "tan", "cot", "sec", "csc", "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh", "det", "dim", "ker", "deg", "gcd", "hom", "lim", "liminf", "limsup", "max", "min", "sup", "inf", "arg", "Pr"]);
/** Environments whose next brace group is a column spec, not content. */
const SPEC_ENVS = new Set(["array", "tabular"]);

/**
 * The letters (Latin and Greek) and digits a LaTeX formula puts on the page,
 * in order: `\\frac{n!}{k!}` → n k, `\\log_2 n` → l o g 2 n, `\\mathbb{R}` → R,
 * `\\pmod{m}` → m o d m, plus the accents a font sets as glyphs (`\\hat`
 * ˆ, `\\tilde` ˜, `\\bar` ¯, `\\dot`, `\\ddot`) and vertical bars (`|x|`,
 * `\\mid`, `\\|`). Structure, operators and other delimiters are left out:
 * they are what a PDF's text layer most often can't name.
 */
export function latexGlyphs(latex: string): string[] {
  const out: string[] = [];
  const toks = latex.match(/\\[a-zA-Z]+\*?|\\.|[^\s]/g) ?? [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    if (t === "\\begin" || t === "\\end") {
      // Skip {name}, and the column spec after \begin{array}.
      let j = i + 1;
      const name: string[] = [];
      if (toks[j] === "{") for (j++; j < toks.length && toks[j] !== "}"; j++) name.push(toks[j]!);
      i = j;
      if (t === "\\begin" && SPEC_ENVS.has(name.join("")) && toks[i + 1] === "{") {
        let depth = 0;
        for (j = i + 1; j < toks.length; j++) {
          if (toks[j] === "{") depth++;
          else if (toks[j] === "}" && --depth === 0) break;
        }
        i = j;
      }
      continue;
    }
    if (t.startsWith("\\")) {
      const name = t.slice(1).replace(/\*$/, "");
      if (GREEK[name]) out.push(GREEK[name]!);
      else if (NAMED.has(name)) out.push(...name);
      else if (name === "pmod" || name === "bmod" || name === "mod") out.push("m", "o", "d");
      else if (ACCENTS[name]) out.push(ACCENTS[name]!);
      else if (!sized(toks, i) && BARS[name]) out.push(...BARS[name]!);
      continue;
    }
    if (t === "|" && !sized(toks, i)) out.push("|");
    else if (/^[a-zA-Z0-9]$/.test(t)) out.push(t);
  }
  return out;
}

/** Accent glyphs a TeX font sets as characters of their own, as PDFium names them (˜ U+02DC, ¯ U+00AF, ˆ U+02C6). */
const ACCENTS: Record<string, string> = { hat: "ˆ", tilde: "˜", bar: "¯", dot: "˙", ddot: "¨" };
/** What may stand for such a glyph without being one: rules and extension-font pieces. */
const ACCENT_LIKE: Record<string, string> = { overline: "¯", widehat: "ˆ", widetilde: "˜" };
/** Vertical bars: |x|, conditionals, norms. */
const BARS: Record<string, string[]> = { vert: ["|"], lvert: ["|"], rvert: ["|"], mid: ["|"], "|": ["|", "|"], Vert: ["|", "|"], lVert: ["|", "|"], rVert: ["|", "|"] };
const SIZERS = new Set(["\\left", "\\right", "\\middle", "\\big", "\\Big", "\\bigg", "\\Bigg", "\\bigl", "\\bigr", "\\Bigl", "\\Bigr", "\\biggl", "\\biggr", "\\Biggl", "\\Biggr", "\\bigm", "\\Bigm"]);
/** A delimiter after \left, \big…: drawn from extension-font pieces, which a text layer may not name. */
const sized = (toks: string[], i: number) => SIZERS.has(toks[i - 1] ?? "");

/**
 * Marks the LaTeX may show without the PDF naming them as such: \overline,
 * \widehat and \widetilde (a rule or extension glyph where the page may have
 * a plain accent), and bars after \left or \big. They excuse a PDF glyph
 * that would otherwise be missing; they never count as extra.
 */
export function latexOptionalGlyphs(latex: string): string[] {
  const out: string[] = [];
  const toks = latex.match(/\\[a-zA-Z]+\*?|\\.|[^\s]/g) ?? [];
  toks.forEach((t, i) => {
    const name = t.startsWith("\\") ? t.slice(1) : t;
    if (ACCENT_LIKE[name]) out.push(ACCENT_LIKE[name]!);
    else if (sized(toks, i) && (t === "|" || BARS[name])) out.push(...(BARS[name] ?? ["|"]));
  });
  return out;
}

/** Folds a PDF character to the alphabet latexGlyphs uses: math italic and bold letters to plain, Greek variants to one form. Null when it isn't a letter or digit. */
export function foldGlyph(ch: string): string | null {
  const cp = ch.codePointAt(0)!;
  // Mathematical Alphanumeric Symbols: 13 Latin alphabets of 52, then digits.
  if (cp >= 0x1d400 && cp <= 0x1d6a3) {
    const k = (cp - 0x1d400) % 52;
    return String.fromCharCode(k < 26 ? 65 + k : 97 + k - 26);
  }
  if (cp >= 0x1d7ce && cp <= 0x1d7ff) return String((cp - 0x1d7ce) % 10);
  if (cp === 0x210e) return "h"; // ℎ, the italic h outside the block
  if (cp === 0x211d) return "R"; // ℝ
  if (cp === 0x2115) return "N"; // ℕ
  if (cp === 0x2124) return "Z"; // ℤ
  if (cp === 0x211a) return "Q"; // ℚ
  if (cp === 0x2102) return "C"; // ℂ
  const variants: Record<string, string> = { "ϵ": "ε", "ϑ": "θ", "ϕ": "φ", "ϱ": "ρ", "ς": "σ", "ϖ": "π", "µ": "μ" };
  if (variants[ch]) return variants[ch]!;
  // Accents (spacing or combining) and bars, folded to latexGlyphs' marks.
  const marks: Record<string, string> = {
    // KaTeX (browser-typeset pages) sets \\hat as ^ and \\tilde as ~.
    "ˆ": "ˆ", "^": "ˆ", "\u0302": "ˆ", "˜": "˜", "~": "˜", "\u0303": "˜", "¯": "¯", "ˉ": "¯", "\u0304": "¯", "˙": "˙", "\u0307": "˙", "¨": "¨", "\u0308": "¨",
    "|": "|", "∣": "|", "‖": "||", "∥": "||",
  };
  if (marks[ch]) return marks[ch]!;
  if (/^[a-zA-Z0-9]$/.test(ch) || /^[\u0391-\u03a9\u03b1-\u03c9]$/.test(ch)) return ch;
  // Ligatures from text fonts.
  const lig: Record<string, string> = { "ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl", "ﬃ": "ffi", "ﬄ": "ffl" };
  return lig[ch] ?? null;
}

export interface GlyphDiff {
  /** Letters/digits the PDF has in the box that the LaTeX doesn't show. */
  missing: string[];
  /** Letters/digits the LaTeX shows that the PDF doesn't have in the box. */
  extra: string[];
}

/**
 * Multiset difference of what the LaTeX shows and what the PDF has (both as
 * latexGlyphs/foldGlyph produce them). `pdf` are the glyphs inside the
 * formula: each one the LaTeX lacks is missing. `visible` (default `pdf`)
 * are those at least partly in the image the reader saw, a superset: only a
 * glyph the LaTeX has beyond these is extra. A subscript the detector's box
 * cut off is then neither missing nor invented.
 */
export function compareGlyphs(latex: string[], pdf: string[], visible: string[] = pdf, optional: string[] = []): GlyphDiff {
  const tally = (gs: string[]) => gs.reduce((m, g) => m.set(g, (m.get(g) ?? 0) + 1), new Map<string, number>());
  const want = tally(latex);
  const may = tally(optional);
  const inside = tally(pdf);
  const seen = tally(visible);
  const extra: string[] = [];
  const missing: string[] = [];
  for (const [g, n] of want) for (let k = seen.get(g) ?? 0; k < n; k++) extra.push(g);
  for (const [g, n] of inside) for (let k = (want.get(g) ?? 0) + (may.get(g) ?? 0); k < n; k++) missing.push(g);
  return { missing: missing.sort(), extra: extra.sort() };
}

/** A letter or digit from the PDF's text layer, at its centre in points from the top-left of the page. */
interface PageGlyph {
  x: number;
  y: number;
  g: string;
  /** The character's own box [left, top, right, bottom]. */
  box: [number, number, number, number];
  /** Set in a bold face (by its font's name: Bold, Black, CM's bx/mib/bsy, …); null when the name doesn't tell (a Type 3 font named F59). */
  bold: boolean | null;
}

/** A font name that says nothing about the face: empty, or a resource name like F59 (pdfTeX's Type 3 bitmap fonts). */
const FACELESS_FONT = /^([A-Z]{6}\+)?([A-Z]{1,2}\d+(\.\d+)?)?$/;

/** A bold face by its PDF font name (subset prefix and all): Bold/Black/Heavy/Semibold, CM's bx, mib and bsy. */
const BOLD_FONT = /bold|black|heavy|semibold|demi|(^|[+_-]|\b)(cm|lm|cmss|lmss)?(bx|mib|bsy)\d*(\b|$)/i;

/**
 * Whether a PDF font name says bold (true), regular (false) or nothing
 * (null): pdfTeX's Type 3 bitmap fonts carry only a resource name like F59,
 * and Beamer's sans-serif math sets its letters in them.
 */
export function fontIsBold(font: string): boolean | null {
  const name = font.trim();
  return FACELESS_FONT.test(name) ? null : BOLD_FONT.test(name);
}

/**
 * The letters a LaTeX formula shows in bold: inside `\mathbf`, `\boldsymbol`,
 * `\bm`, `\mathbfit`, `\pmb`, `\textbf`, or a `{\bf …}` group.
 */
export function latexBoldLetters(latex: string): string[] {
  const out: string[] = [];
  const re = /\\(mathbf|boldsymbol|bm|mathbfit|pmb|textbf)\s*\{|\{\s*\\bf(?![a-zA-Z])/g;
  for (let m = re.exec(latex); m; m = re.exec(latex)) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    for (; i < latex.length && depth > 0; i++) {
      if (latex[i] === "\\") i++;
      else if (latex[i] === "{") depth++;
      else if (latex[i] === "}") depth--;
    }
    out.push(...latexGlyphs(latex.slice(start, i - 1)).filter(isLetter));
  }
  return out;
}

const isLetter = (g: string) => /^[a-zA-Z\u0370-\u03ff]$/.test(g);

/**
 * Bold that the LaTeX and the PDF don't share, letter by letter: bold in the
 * LaTeX where the PDF sets that letter in regular type only (an invented
 * vector), or bold in the PDF where the LaTeX writes it plain (a dropped one).
 */
export function boldIssues(latex: string, pdf: { bold: string[]; regular: string[] }): string[] {
  const latexBold = new Set(latexBoldLetters(latex));
  const plainInLatex = new Set(latexGlyphs(latex).filter(isLetter));
  const pdfBold = new Set(pdf.bold.filter(isLetter));
  const pdfRegular = new Set(pdf.regular.filter(isLetter));
  const invented = [...latexBold].filter((g) => !pdfBold.has(g) && pdfRegular.has(g));
  const dropped = [...pdfBold].filter((g) => !latexBold.has(g) && plainInLatex.has(g));
  const issues: string[] = [];
  if (invented.length) issues.push(`the LaTeX sets ${invented.join(" ")} in bold, the PDF in regular type`);
  if (dropped.length) issues.push(`the PDF sets ${dropped.join(" ")} in bold, the LaTeX doesn't`);
  return issues;
}

/**
 * TeX's extension fonts put big operators and delimiter pieces at letter
 * codes (∑ is "X", ∏ "Y", ∫ "Z" in cmex10). Without a Unicode map PDFium
 * reports those letters, so they are not glyphs of the formula.
 */
const EXTENSION_FONT = /(^|\+)(cmex|euex|lmex|mathx|esint|stmary|txex|pxex|cmexb)/i;

/**
 * Every letter and digit in the page's text layer with its centre, in the
 * same top-left point space as Formula.bbox. A character PDFium can't map
 * through the PDF's own Unicode table still counts, it was mapped by its
 * font's encoding: pdflatex's sans-serif math and text fonts come out right
 * that way. Unmapped characters of TeX's extension fonts don't count.
 * Empty for a page without a text layer.
 */
function pageGlyphs(page: PdfiumPage): PageGlyph[] {
  const m = page.module;
  if (!m || page.pageIdx === undefined) return [];
  const { originalWidth, originalHeight } = page.getOriginalSize();
  const tp = m._FPDFText_LoadPage(page.pageIdx);
  if (!tp) return [];
  const buf = m.wasmExports.malloc(48);
  const fontBuf = m.wasmExports.malloc(256);
  const out: PageGlyph[] = [];
  // Device space 10× the page size, so integer device coordinates still resolve 0.1 pt.
  const K = 10;
  try {
    const n = m._FPDFText_CountChars(tp);
    for (let i = 0; i < n; i++) {
      const len = m._FPDFText_GetFontInfo(tp, i, fontBuf, 240, buf + 40);
      const font = len > 1 ? new TextDecoder().decode(new Uint8Array(m.HEAPU8.buffer, fontBuf, len - 1)) : "";
      if (m._FPDFText_HasUnicodeMapError(tp, i) && EXTENSION_FONT.test(font)) continue;
      const bold = fontIsBold(font);
      const code = m._FPDFText_GetUnicode(tp, i);
      if (!code) continue;
      const folded = foldGlyph(String.fromCodePoint(code));
      if (!folded) continue;
      if (!m._FPDFText_GetCharBox(tp, i, buf, buf + 8, buf + 16, buf + 24)) continue;
      const [left, right, bottom, top] = [...new Float64Array(m.HEAPU8.buffer, buf, 4)] as [number, number, number, number];
      const toDevice = (x: number, y: number) => {
        m._FPDF_PageToDevice(page.pageIdx!, 0, 0, Math.round(originalWidth * K), Math.round(originalHeight * K), 0, x, y, buf + 32, buf + 36);
        const dv = new Int32Array(m.HEAPU8.buffer, buf + 32, 2);
        return [dv[0]! / K, dv[1]! / K] as const;
      };
      const [x, y] = toDevice((left + right) / 2, (bottom + top) / 2);
      const [ax, ay] = toDevice(left, top);
      const [bx, by] = toDevice(right, bottom);
      const box: PageGlyph["box"] = [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
      for (const g of folded) out.push({ x, y, g, box, bold });
    }
  } finally {
    m.wasmExports.free(buf);
    m.wasmExports.free(fontBuf);
    m._FPDFText_ClosePage(tp);
  }
  return out;
}

/** Margin around the detector's box in a formula's crop and stored bbox, in points. */
const CROP_PAD_PT = 4;

/**
 * The PDF's letters and digits for the formula stored with `bbox` (the
 * padded crop): `inside` have their centre in the detector's own box (bbox
 * less the padding), `visible` overlap the crop at all.
 */
function glyphsFor(glyphs: PageGlyph[], bbox: readonly number[]): { inside: string[]; visible: string[]; bold: string[]; regular: string[] } {
  const [x0, y0, x1, y1] = bbox as [number, number, number, number];
  const pad = Math.min(CROP_PAD_PT, (x1 - x0) / 4, (y1 - y0) / 4);
  const tol = 0.5;
  const inside = glyphs.filter((p) => p.x >= x0 + pad - tol && p.x <= x1 - pad + tol && p.y >= y0 + pad - tol && p.y <= y1 - pad + tol);
  const visible = glyphs.filter((p) => p.box[0] < x1 && p.box[2] > x0 && p.box[1] < y1 && p.box[3] > y0);
  return { inside: inside.map((p) => p.g), visible: visible.map((p) => p.g), bold: inside.filter((p) => p.bold === true).map((p) => p.g), regular: inside.filter((p) => p.bold === false).map((p) => p.g) };
}

export type FormulaCheck = "match" | "differs" | "unchecked";

export interface FormulaVerdict {
  /** Problems in the LaTeX itself (latexIssues). */
  issues: string[];
  /** The PDF's own letters and digits in the box against the LaTeX's; null when the box has none (scan, picture). */
  glyphs: (GlyphDiff & { pdf: number }) | null;
  /**
   * match: no issues, and every letter and digit agrees with the PDF (their
   * positions, sub/superscripts and fraction parts are not compared).
   * differs: issues, or letters/digits that don't agree.
   * unchecked: nothing to compare with; only the image can tell.
   */
  check: FormulaCheck;
}

/**
 * Judges `latex` against the PDF's glyphs for the formula: an array is both
 * inside and visible; `{ inside, visible }` as glyphsFor gives them. Null or
 * nothing visible: unchecked.
 */
export function judgeFormula(latex: string, pdf: string[] | { inside: string[]; visible: string[]; bold?: string[]; regular?: string[] } | null): FormulaVerdict {
  const issues = latexIssues(latex);
  const { inside, visible } = Array.isArray(pdf) ? { inside: pdf, visible: pdf } : (pdf ?? { inside: [], visible: [] });
  // Bold is compared where the PDF says which face each letter is in (glyphsFor gives it).
  if (pdf && !Array.isArray(pdf) && pdf.bold && pdf.regular && !issues.length) issues.push(...boldIssues(latex, { bold: pdf.bold, regular: pdf.regular }));
  const glyphs = visible.length ? { ...compareGlyphs(latexGlyphs(latex), inside, visible, latexOptionalGlyphs(latex)), pdf: inside.length } : null;
  const differs = issues.length > 0 || (glyphs !== null && (glyphs.missing.length > 0 || glyphs.extra.length > 0));
  return { issues, glyphs, check: differs ? "differs" : glyphs ? "match" : "unchecked" };
}

/**
 * Checks any LaTeX (the model's, or a correction) against page `page`
 * (0-based) of `pdf` for the formula stored with `bbox` (math.json's padded
 * box): the same verdict recognizeMath gives.
 * This is how a correction proves it adds nothing the PDF doesn't have.
 */
export async function checkFormula(pdf: Uint8Array, page: number, bbox: readonly number[], latex: string): Promise<FormulaVerdict> {
  const doc = await (await getPdfium()).loadDocument(pdf);
  try {
    if (page < 0 || page >= doc.getPageCount()) throw new ImstudiumError(`page ${page + 1} is not in the document`, "BAD_ARGS");
    const p = doc.getPage(page);
    try {
      return judgeFormula(latex, glyphsFor(pageGlyphs(p), bbox));
    } finally {
      p.close();
    }
  } finally {
    doc.destroy();
  }
}

/** Command names that only mean something with their backslash: seen bare, the model produced garbage. */
const BARE_COMMANDS = /(?<![\\a-zA-Z])(binom|frac|dfrac|sqrt|bigl|bigr|Bigl|Bigr|cdot|cdots|ldots|mathbb|mathcal|mathbf|mathrm|operatorname|begin|end|alpha|beta|gamma|delta|varepsilon|epsilon|lambda|sigma|theta|infty|partial|nabla|prod|sum|int|lim|limsup|liminf)(?![a-zA-Z])/;

/**
 * Command names long enough that a run of plain letters containing one is a
 * dropped backslash, even glued to a variable (`Aboldsymbol`): no variable
 * product spells them.
 */
const GLUED_COMMANDS = /boldsymbol|mathsf|mathbb|mathcal|mathrm|mathbf|mathit|mathtt|operatorname|displaystyle|overline|underline|widetilde|widehat|overrightarrow|textbf|textrm/;

let katexModule: { renderToString(latex: string, options: object): string } | null | undefined;

/** KaTeX, loaded on first use (pure JS, ~600 KB); null if it can't be loaded. */
function katex() {
  if (katexModule === undefined) {
    try {
      katexModule = createRequire(import.meta.url)("katex") as NonNullable<typeof katexModule>;
    } catch {
      katexModule = null;
    }
  }
  return katexModule;
}

/**
 * The formula's symbols in their structure, as KaTeX lays it out (MathML
 * tokens without attributes, fonts, spacing, operator or cell boundaries, or
 * delimiter sizing); null when KaTeX can't parse it. Two readings with the same
 * symbols print the same formula however their LaTeX is spelled.
 */
function symbolTokens(latex: string): string | null {
  const k = katex();
  if (!k) return null;
  let mml: string;
  try {
    const unsized = latex.replace(/\\(left|right)\s*\./g, "").replace(/\\(left|right|[bB]igg?[lr]?)(?![a-zA-Z])/g, "");
    mml = k.renderToString(unsized, { output: "mathml", throwOnError: true, displayMode: true, strict: "ignore", trust: false, maxExpand: 200 });
  } catch {
    return null;
  }
  const body = mml
    .replace(/<annotation[\s\S]*?<\/annotation>/g, "")
    .replace(/<(\/?)(\w+)[^>]*>/g, "<$1$2>")
    .replace(/<\/?(mrow|semantics|math|mstyle|span)>/g, "");
  const variants: Record<string, string> = { "ϵ": "ε", "∣": "|", "‾": "ˉ", "ϕ": "φ" };
  return (body.match(/<\/?\w+>|[^<]/gu) ?? [])
    .filter((t) => !/^[⁡-⁤\s  -​ ]$/u.test(t) && !/^<\/?(mi|mn|mo|mtd|mtext|mrow)>$/.test(t))
    .map((t) => variants[t] ?? t)
    .join(" ");
}

/** Same symbols in the same structure (see symbolTokens); false when either doesn't parse. */
export function sameMeaning(a: string, b: string): boolean {
  if (a.replace(/\s+/g, "") === b.replace(/\s+/g, "")) return true;
  const x = symbolTokens(a);
  return x !== null && x === symbolTokens(b);
}

/** Why KaTeX can't typeset `latex` (display mode), or null when it can (or KaTeX isn't there). */
export function katexError(latex: string): string | null {
  const k = katex();
  if (!k) return null;
  try {
    // Strict only where LaTeX itself would fail: a text accent (`\\=`) or text unit in math mode.
    const strict = (code: string) => (code === "mathVsTextAccents" || code === "mathVsTextUnits" ? "error" : "ignore");
    k.renderToString(latex, { displayMode: true, throwOnError: true, strict, output: "mathml", trust: false, maxExpand: 200 });
    return null;
  } catch (err) {
    return (err instanceof Error ? err.message : String(err)).replace(/^KaTeX parse error:\s*/, "").split("\n")[0]!.slice(0, 120);
  }
}

/**
 * Structural problems in recognised LaTeX that mean it can't be what the page
 * shows: unbalanced braces, \left without \right, an environment that isn't
 * closed, a command name without its backslash, or text that is no LaTeX at
 * all. Empty when nothing is wrong on the surface (which still doesn't make it
 * right). Never changes the LaTeX.
 */
export function latexIssues(latex: string): string[] {
  const issues: string[] = [];
  const plain = latex.replace(/\\[{}]/g, "");
  let depth = 0;
  let underflow = false;
  for (const ch of plain) {
    if (ch === "{") depth++;
    else if (ch === "}" && --depth < 0) underflow = true;
  }
  if (depth !== 0 || underflow) issues.push("unbalanced braces");
  const lefts = (latex.match(/\\left(?![a-zA-Z])/g) ?? []).length;
  const rights = (latex.match(/\\right(?![a-zA-Z])/g) ?? []).length;
  if (lefts !== rights) issues.push(`\\left ×${lefts} but \\right ×${rights}`);
  if (/\\right(?![a-zA-Z])\s*($|[a-zA-Z{}])/.test(latex)) issues.push("\\right without a delimiter");
  const envs: string[] = [];
  for (const m of latex.matchAll(/\\(begin|end)\{([a-zA-Z*]+)\}/g)) {
    if (m[1] === "begin") envs.push(m[2]!);
    else if (envs.pop() !== m[2]) {
      issues.push(`\\end{${m[2]}} does not close its \\begin`);
      break;
    }
  }
  if (envs.length) issues.push(`\\begin{${envs[envs.length - 1]}} is never closed`);
  const outsideText = latex.replace(/\\(text|mathrm|operatorname\*?|textrm|mbox)\s*\{[^{}]*\}/g, "");
  const bare = BARE_COMMANDS.exec(outsideText);
  const glued = bare ? null : [...outsideText.matchAll(/(?<![\\a-zA-Z])[a-zA-Z]+/g)].map((m) => GLUED_COMMANDS.exec(m[0])).find(Boolean);
  if (bare) issues.push(`"${bare[1]}" without its backslash`);
  else if (glued) issues.push(`"${glued[0]}" without its backslash`);
  if (/\\ [a-zA-Z]{3,}/.test(outsideText)) issues.push("a word after an escaped space");
  if (/\[object Object\]|undefined|NaN/.test(latex)) issues.push("text that is not LaTeX");
  // Characters a formula reader writes as commands: anything else outside \text is something it made up (e.g. CJK).
  const foreign = outsideText.match(/[^\x20-\x7e]/gu);
  if (foreign) issues.push(`characters that aren't math: ${[...new Set(foreign)].join(" ")}`);
  if (hasEmptyFraction(latex)) issues.push("a fraction with an empty part");
  // Models box a formula when its crop catches a frame (a Beamer block, a table rule).
  if (/\\(boxed|fbox|framebox)\b/.test(latex)) issues.push("a box around it: keep \\boxed only if the formula itself is boxed on the page");
  // The same frame's top edge, read as a line over the whole formula: an overline spanning a relation is no mathematical overline.
  if (overlinesWholeEquation(latex)) issues.push("a line over the whole formula: keep \\overline only if the page draws one (a Beamer block's frame reads as one)");
  // On slides a • in a formula is nearly always the item markers the box caught, read as math.
  if (/\\bullet(?![a-zA-Z])/.test(latex)) issues.push("a list bullet (•): the box may have caught the slide's item markers");
  // One-sided brace around one line: cases with a single row, usually an invented \left\{.
  if (/\\left\s*(\\\{|\\lbrace)/.test(latex) && /\\right\s*\./.test(latex) && !/\\\\/.test(latex)) issues.push("a one-sided brace around a single line");
  // Last, and only for what passed the cheap rules: whatever KaTeX can't typeset, a reader's renderer likely can't either.
  if (!issues.length) {
    const err = katexError(latex);
    if (err) issues.push(`KaTeX can't typeset it: ${err}`);
  }
  return issues;
}

/** A `\frac` whose numerator or denominator group is empty or missing, nested groups included. */
/** `\\overline{…}` around the whole formula, with a relation (`=`, `\\le`, …) inside it at its top level. */
function overlinesWholeEquation(latex: string): boolean {
  const m = /^\s*\\overline\s*\{/.exec(latex);
  if (!m) return false;
  let depth = 1;
  let i = m[0].length;
  let relation = false;
  for (; i < latex.length && depth > 0; i++) {
    const ch = latex[i]!;
    if (ch === "\\" && (latex[i + 1] === "{" || latex[i + 1] === "}")) {
      i++;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (depth === 1 && LEADING_RELATION.test(latex.slice(i))) relation = true;
  }
  return depth === 0 && relation && latex.slice(i).trim() === "";
}

function hasEmptyFraction(latex: string): boolean {
  for (const m of latex.matchAll(/\\[dt]?frac(?![a-zA-Z])/g)) {
    let i = m.index + m[0].length;
    for (let part = 0; part < 2; part++) {
      while (latex[i] === " ") i++;
      if (i >= latex.length) return true;
      if (latex[i] !== "{") {
        // a single-token argument such as \frac12 or \frac\pi2
        if (latex[i] === "\\") for (i++; /[a-zA-Z]/.test(latex[i] ?? ""); i++);
        else i++;
        continue;
      }
      const start = ++i;
      let depth = 1;
      while (i < latex.length && depth > 0) {
        if (latex[i] === "\\") i++;
        else if (latex[i] === "{") depth++;
        else if (latex[i] === "}") depth--;
        i++;
      }
      if (!latex.slice(start, i - 1).trim()) return true;
    }
  }
  return false;
}

/** Characters that only show up in pdf-inspector's text when a page has typeset math. */
const MATH_GLYPHS = /[∑∏∫∮√∞≤≥≠≈≡∈∉⊂⊆⊃⊇∪∩∀∃∂∇±∓×÷→←↔⇒⇐⇔↦∝∘⊕⊗⟨⟩‖αβγδεζηθικλμνξπρστυφχψωΓΔΘΛΞΠΣΦΨΩ]/;

/** Worth the layout pass: math glyphs, sub/superscripts, or no text layer at all. */
export function isMathCandidate(markdown: string): boolean {
  return MATH_GLYPHS.test(markdown) || /<su[bp]>/.test(markdown);
}

/** Area-average downscale (or bilinear upscale) of an RGBA buffer to RGB planes in [0, 1], CHW. */
function resizeToChw(src: Uint8Array, w: number, h: number, W: number, H: number): Float32Array {
  const out = new Float32Array(3 * W * H);
  const sx = w / W;
  const sy = h / H;
  for (let y = 0; y < H; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.min(h, Math.floor((y + 1) * sy)));
    for (let x = 0; x < W; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.min(w, Math.floor((x + 1) * sx)));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * w + xx) * 4;
          r += src[i]!;
          g += src[i + 1]!;
          b += src[i + 2]!;
          n++;
        }
      }
      const p = y * W + x;
      out[p] = r / n / 255;
      out[W * H + p] = g / n / 255;
      out[2 * W * H + p] = b / n / 255;
    }
  }
  return out;
}

/** UniRec's input limits: both sides a multiple of 64, at most 960 wide and 1408 high. */
const UNIREC_MAX_W = 960;
const UNIREC_MAX_H = 1408;

/** Catmull-Rom cubic weight (a = -0.5), as Pillow's and libvips' bicubic. */
function cubic(x: number): number {
  const t = Math.abs(x);
  if (t < 1) return 1.5 * t ** 3 - 2.5 * t ** 2 + 1;
  if (t < 2) return -0.5 * t ** 3 + 2.5 * t ** 2 - 4 * t + 2;
  return 0;
}

/** One axis of a bicubic resample, widened when shrinking so every source pixel counts (antialiased). */
function resampleAxis(src: Float32Array, w: number, h: number, size: number, horizontal: boolean): Float32Array {
  const n = horizontal ? w : h;
  const scale = n / size;
  const support = 2 * Math.max(1, scale);
  const out = new Float32Array(horizontal ? size * h : w * size);
  for (let o = 0; o < size; o++) {
    const centre = (o + 0.5) * scale;
    const lo = Math.max(0, Math.floor(centre - support));
    const hi = Math.min(n - 1, Math.ceil(centre + support));
    const ws: number[] = [];
    let sum = 0;
    for (let i = lo; i <= hi; i++) {
      const v = cubic((i + 0.5 - centre) / Math.max(1, scale));
      ws.push(v);
      sum += v;
    }
    const lines = horizontal ? h : w;
    for (let l = 0; l < lines; l++) {
      let acc = 0;
      for (let i = lo; i <= hi; i++) acc += ws[i - lo]! * src[horizontal ? l * w + i : i * w + l]!;
      out[horizontal ? l * size + o : o * w + l] = acc / sum;
    }
  }
  return out;
}

/**
 * UniRec input for one gray crop, as its authors' ONNX pipeline prepares it:
 * shrink to fit 960×1408 when larger, round both sides down to a multiple of
 * 64 (at least 64), bicubic resample, three equal channels scaled to −1…1.
 * Null when the crop has no ink.
 */
export function unirecInput(gray: Uint8Array, w: number, h: number): { data: Float32Array; width: number; height: number } | null {
  let mn = 255;
  let mx = 0;
  for (let i = 0; i < w * h; i++) {
    const v = gray[i]!;
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  if (mx === mn) return null;
  let W = w;
  let H = h;
  if (w > UNIREC_MAX_W || h > UNIREC_MAX_H) {
    const ar = w / h;
    if (UNIREC_MAX_W / UNIREC_MAX_H >= ar) [W, H] = [Math.trunc(UNIREC_MAX_H * ar), UNIREC_MAX_H];
    else [W, H] = [UNIREC_MAX_W, Math.trunc(UNIREC_MAX_W / ar)];
  }
  W = Math.max(64, Math.floor(W / 64) * 64);
  H = Math.max(64, Math.floor(H / 64) * 64);
  const src = Float32Array.from(gray);
  const resized = resampleAxis(resampleAxis(src, w, h, W, true), W, h, H, false);
  const plane = W * H;
  const data = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    const v = (Math.min(255, Math.max(0, Math.round(resized[i]!))) / 255 - 0.5) / 0.5;
    data[i] = v;
    data[plane + i] = v;
    data[2 * plane + i] = v;
  }
  return { data, width: W, height: H };
}

// ── Recognition ──────────────────────────────────────────────────────────────

export interface Formula extends FormulaVerdict {
  /** `p<page>-<n>`: page (1-based) and position on the page, top to bottom (1-based). */
  id: string;
  /** 0-based page. */
  page: number;
  /** [x0, y0, x1, y1] in PDF points, top-left origin. */
  bbox: [number, number, number, number];
  latex: string;
  /** Layout detector confidence. */
  score: number;
  /** How likely the reading is exactly right, from decideReading (0–1). */
  confidence?: number;
  /** The other readings of the same box at lower resolutions, where they differ from `latex`. */
  otherReadings?: string[];
  /** With `readings: true` (benchmark): every reading of the box, at each resolution factor, with its check. */
  readings?: Reading[];
}

/** One reading of a formula box at `factor` times the page's render scale. */
export interface Reading extends FormulaVerdict {
  latex: string;
  factor: number;
}

/**
 * Every formula box is read at the page's render scale and again at 3/4 and
 * 1/2 of it (288, 216 and 144 dpi on slides): the model makes different
 * mistakes at each, and where it is right the readings tend to agree.
 * IMSTUDIUM_MATH_READINGS=1 reads once (benchmark only).
 */
export const READING_FACTORS = [1, 0.75, 0.5] as const;

/**
 * The decision model: logistic weights over a reading's signals, fitted on
 * UniRec-0.1B's readings of the synthetic formula benchmark (scripts/bench),
 * scored leave-one-deck-out in docs/BENCHMARKS.md. Raw feature scale, bias
 * first. Features in order:
 * check passes (no issues, letters and digits agree or nothing to compare),
 * letters and digits match the PDF, has issues, letters the PDF doesn't have
 * (up to 3), share of the other readings with the same LaTeX, share with the
 * same symbols, read at the full scale, read at 3/4, log(1 + length).
 */
export const DECISION_WEIGHTS = [-2.338, 2.141, 0.382, -0.948, -3.351, 1.145, 4.652, 0.905, 0.883, -0.21];
/** How a box's readings become one, kept in the manifest: 1 = READING_FACTORS and the decision model (before: one reading). */
export const MATH_DECISION = 1;
/** Below this, a reading whose check passed is still marked for a look. */
export const DECISION_FLAG_BELOW = 0.8;

/** The decision model's inputs for `readings[i]` (see DECISION_WEIGHTS). */
export function readingFeatures(readings: readonly Reading[], i: number): number[] {
  const r = readings[i]!;
  const others = readings.filter((_, j) => j !== i);
  const flat = (s: string) => s.replace(/\s+/g, "");
  const share = (f: (o: Reading) => boolean) => (others.length ? others.filter(f).length / others.length : 1);
  return [
    r.check !== "differs" ? 1 : 0,
    r.check === "match" ? 1 : 0,
    r.issues.length ? 1 : 0,
    Math.min(3, r.glyphs?.extra.length ?? 0),
    share((o) => flat(o.latex) === flat(r.latex)),
    share((o) => sameMeaning(o.latex, r.latex)),
    r.factor === 1 ? 1 : 0,
    r.factor === 0.75 ? 1 : 0,
    Math.log(1 + r.latex.length),
  ];
}

/**
 * The reading the decision model trusts most, and how likely it is exactly
 * right; ties go to the higher resolution. When some readings pass their
 * check, only those are chosen from: two readings that agree on a bar the
 * page doesn't draw lose to the one that doesn't, and its low likelihood
 * still marks it for a look. Agreement counts all readings either way.
 */
export function decideReading(readings: readonly Reading[], weights: readonly number[] = DECISION_WEIGHTS): { index: number; confidence: number } {
  const anyPasses = readings.some((r) => r.check !== "differs");
  let best = { index: -1, confidence: -1 };
  readings.forEach((r, i) => {
    if (anyPasses && r.check === "differs") return;
    const z = readingFeatures(readings, i).reduce((s, v, j) => s + v * weights[j + 1]!, weights[0]!);
    const p = 1 / (1 + Math.exp(-z));
    if (p > best.confidence + 1e-9) best = { index: i, confidence: p };
  });
  return best.index < 0 ? { index: 0, confidence: 0 } : best;
}

/**
 * The chosen reading's verdict, marked for a look when the decision model is
 * unsure although the check passed, naming what the other readings saw.
 */
export function decidedVerdict(readings: readonly Reading[], index: number, confidence: number): FormulaVerdict {
  const r = readings[index]!;
  const verdict: FormulaVerdict = { issues: r.issues, glyphs: r.glyphs, check: r.check };
  if (confidence >= DECISION_FLAG_BELOW || r.check === "differs") return verdict;
  const others = [...new Set(readings.filter((o, j) => j !== index && !sameMeaning(o.latex, r.latex)).map((o) => o.latex))];
  const why = others.length ? `read differently at lower resolution: ${others.map((o) => `\`${o}\``).join(", ")}` : "the model is unsure of this reading";
  return { ...verdict, issues: [...r.issues, why], check: "differs" };
}

export interface MathResult {
  formulas: Formula[];
  /** With `crops: true`: each formula's image (gray PNG, as the model saw it before scaling), aligned with `formulas`. */
  crops?: Uint8Array[];
  /** Pages the layout pass looked at. */
  pages: number[];
  ms: number;
}

const LAYOUT_INPUT = 480;
const FORMULA_CLASS = 7;
const MIN_SCORE = 0.5;
/** Render so the long side is about this many pixels (≈ 200–290 DPI for slides and A4). */
const RENDER_LONG_SIDE = 2400;
/** Page render scale for layout and crops (4 = 288 dpi), at most RENDER_LONG_SIDE pixels on the long side. */
const RENDER_SCALE = 4;

/**
 * Inline formulas that are display formulas in all but name, the way lecture
 * slides write them inside bullets: taller than 1.3 text lines
 * (`$\displaystyle\frac…$`, sums with limits, roots), or alone on their line
 * (an item that is only a formula). `$x$`, `$\mathbb{R}^3$` or a formula
 * inside a sentence stay pdf-inspector's text. The line height is the 25th
 * percentile of the page's text boxes, else of its inline formulas.
 */
export function displayLikeInline<T extends { box: number[] }>(inline: T[], text: number[][]): T[] {
  if (!inline.length) return [];
  const h = (b: number[]) => b[3]! - b[1]!;
  const heights = (text.length ? text : inline.map((f) => f.box)).map(h).sort((a, b) => a - b);
  const lineH = heights[Math.floor((heights.length - 1) / 4)]!;
  return inline.filter(({ box }) => {
    if (h(box) >= 1.3 * lineH) return true;
    // The one-line text box it sits in: alone when it starts right after the bullet (within 1.5
    // lines of the box's left edge) and fills the rest. "Für $0 \le k \le n$:" is not alone.
    const tol = lineH / 2;
    const line = text.find((t) => h(t) < 1.6 * lineH && t[0]! <= box[0]! + tol && t[1]! <= box[1]! + tol && t[2]! >= box[2]! - tol && t[3]! >= box[3]! - tol);
    return !!line && box[0]! - line[0]! <= 1.5 * lineH && box[2]! - box[0]! >= 0.8 * (line[2]! - line[0]!) - 1.5 * lineH;
  });
}

const iou = (a: number[], b: number[]) => {
  const ix = Math.max(0, Math.min(a[2]!, b[2]!) - Math.max(a[0]!, b[0]!));
  const iy = Math.max(0, Math.min(a[3]!, b[3]!) - Math.max(a[1]!, b[1]!));
  const inter = ix * iy;
  const area = (r: number[]) => (r[2]! - r[0]!) * (r[3]! - r[1]!);
  return inter / Math.max(1e-6, area(a) + area(b) - inter);
};

/** Decoder steps per formula; a reading that runs longer is cut there (a looping model). */
const MAX_TOKENS = 1024;

/** UniRec over prepared crops, one at a time (greedy decoding with a KV cache); one bare, normalised LaTeX string per crop ("" when nothing was read). */
async function readCrops(e: Engine, inputs: Array<{ data: Float32Array; width: number; height: number }>): Promise<string[]> {
  const out: string[] = [];
  const { layers, heads, dim } = e.kv;
  for (const input of inputs) {
    const enc = await e.encoder.run({ [e.encoder.inputNames[0]!]: new e.ort.Tensor("float32", input.data, [1, 3, input.height, input.width]) });
    const crossK = enc.cross_k ?? enc[e.encoder.outputNames[1]!];
    const crossV = enc.cross_v ?? enc[e.encoder.outputNames[2]!];
    let past: unknown[] = [];
    for (let i = 0; i < 2 * layers; i++) past.push(new e.ort.Tensor("float32", new Float32Array(0), [1, heads, 0, dim]));
    const ids = [e.special.bos];
    for (let step = 0; step < MAX_TOKENS; step++) {
      const feeds: Record<string, unknown> = {
        input_ids: new e.ort.Tensor("int64", BigInt64Array.from([BigInt(ids[ids.length - 1]!)]), [1, 1]),
        position_ids: new e.ort.Tensor("int64", BigInt64Array.from([BigInt(e.special.pad + 1 + step)]), [1, 1]),
        cross_k: crossK,
        cross_v: crossV,
      };
      for (let i = 0; i < layers; i++) {
        feeds[`past_key_${i}`] = past[2 * i];
        feeds[`past_value_${i}`] = past[2 * i + 1];
      }
      const res = await e.decoder.run(feeds);
      const logits = res[e.decoder.outputNames[0]!]!;
      const V = logits.dims[logits.dims.length - 1]!;
      const off = logits.data.length - V;
      let best = 0;
      for (let j = 1; j < V; j++) if ((logits.data[off + j] as number) > (logits.data[off + best] as number)) best = j;
      past = [];
      for (let i = 0; i < layers; i++) past.push(res[`present_key_${i}`] ?? res[e.decoder.outputNames[1 + 2 * i]!], res[`present_value_${i}`] ?? res[e.decoder.outputNames[2 + 2 * i]!]);
      ids.push(best);
      if (best === e.special.eos) break;
    }
    out.push(normalizeLatex(unirecLatex(decodeUnirecTokens(ids, e.tokens, e.special.eos))));
  }
  return out;
}

/** The gray crop of `box` (render pixels) from an RGBA render, padded by `pad` pixels; null when too small. */
function grayCrop(r: { data: Uint8Array | Uint8ClampedArray; width: number; height: number }, box: readonly number[], pad: number) {
  const X0 = Math.max(0, Math.floor(box[0]!) - pad);
  const Y0 = Math.max(0, Math.floor(box[1]!) - pad);
  const X1 = Math.min(r.width, Math.ceil(box[2]!) + pad);
  const Y1 = Math.min(r.height, Math.ceil(box[3]!) + pad);
  const w = X1 - X0;
  const h = Y1 - Y0;
  if (w < 4 || h < 4) return null;
  const gray = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = ((Y0 + y) * r.width + X0 + x) * 4;
      gray[y * w + x] = Math.round(0.299 * r.data[i]! + 0.587 * r.data[i + 1]! + 0.114 * r.data[i + 2]!);
    }
  }
  return { gray, w, h, box: [X0, Y0, X1, Y1] };
}

/**
 * Display formulas on the given pages (0-based; all pages when omitted), read
 * into LaTeX on this machine. Each box is read at READING_FACTORS of the
 * page's render scale and decideReading keeps the reading it trusts most.
 * `readings: true` keeps every reading on the formula (benchmark).
 */
export async function recognizeMath(pdf: Uint8Array, options: { pages?: number[]; crops?: boolean; readings?: boolean } = {}): Promise<MathResult> {
  const started = Date.now();
  const e = await getEngine();
  const doc = await e.pdfium.loadDocument(pdf);
  const formulas: Formula[] = [];
  const pngs: Uint8Array[] = [];
  const pages = options.pages ?? Array.from({ length: doc.getPageCount() }, (_, i) => i);
  // Benchmark only: IMSTUDIUM_MATH_READINGS=1 reads each box once, as before the decision model.
  const factors = process.env.IMSTUDIUM_MATH_READINGS === "1" ? [1] : [...READING_FACTORS];
  try {
    for (const index of pages) {
      if (index < 0 || index >= doc.getPageCount()) continue;
      const page = doc.getPage(index);
      try {
        const { originalWidth, originalHeight } = page.getOriginalSize();
        // Benchmark only: IMSTUDIUM_MATH_RENDER_SCALE renders at another scale to compare.
        const scale = Number(process.env.IMSTUDIUM_MATH_RENDER_SCALE) || Math.min(RENDER_SCALE, RENDER_LONG_SIDE / Math.max(originalWidth, originalHeight));
        const r = await page.render({ scale, render: "bitmap", colorSpace: "RGBA" });
        const L = e.layoutInput;
        const image = new e.ort.Tensor("float32", resizeToChw(r.data, r.width, r.height, L, L), [1, 3, L, L]);
        const scaleFactor = new e.ort.Tensor("float32", new Float32Array([L / r.height, L / r.width]), [1, 2]);
        const feeds: Record<string, unknown> = { image, scale_factor: scaleFactor };
        if (e.layout.inputNames.includes("im_shape")) feeds.im_shape = new e.ort.Tensor("float32", new Float32Array([L, L]), [1, 2]);
        const out = await e.layout.run(feeds);
        const det = Object.values(out).find((t) => t.dims.length === 2 && t.dims[1]! >= 6);
        if (!det) continue;
        const width = det.dims[1]!;
        const boxes: Array<{ box: number[]; score: number }> = [];
        const inline: Array<{ box: number[]; score: number }> = [];
        const text: number[][] = [];
        for (let i = 0; i < det.dims[0]!; i++) {
          const cls = Number(det.data[i * width]);
          const score = Number(det.data[i * width + 1]);
          if (score < MIN_SCORE) continue;
          const box = [2, 3, 4, 5].map((k) => Number(det.data[i * width + k]));
          if (e.inlineClasses.includes(cls)) inline.push({ box, score });
          else if (e.textClasses.includes(cls)) text.push(box);
          if (!e.formulaClasses.includes(cls)) continue;
          if (boxes.some((b) => iou(b.box, box) > 0.5)) continue;
          boxes.push({ box, score });
        }
        for (const f of displayLikeInline(inline, text)) {
          if (!boxes.some((b) => iou(b.box, f.box) > 0.3)) boxes.push(f);
        }
        if (!boxes.length) continue;
        boxes.sort((a, b) => a.box[1]! - b.box[1]! || a.box[0]! - b.box[0]!);
        // The same page at the lower reading scales; the boxes are scaled to it.
        const renders = [r];
        for (const f of factors.slice(1)) renders.push(await page.render({ scale: scale * f, render: "bitmap", colorSpace: "RGBA" }));
        type Input = NonNullable<ReturnType<typeof unirecInput>>;
        const crops: Array<{ box: number[]; score: number; inputs: Array<Input | null>; png?: Uint8Array }> = [];
        for (const { box, score } of boxes) {
          const base = grayCrop(r, box, Math.round(CROP_PAD_PT * (r.width / originalWidth)));
          if (!base) continue;
          const inputs = factors.map((f, k) => {
            if (k === 0) return unirecInput(base.gray, base.w, base.h);
            const rk = renders[k]!;
            const c = grayCrop(rk, box.map((v) => v * (rk.width / r.width)), Math.round(CROP_PAD_PT * (rk.width / originalWidth)));
            return c ? unirecInput(c.gray, c.w, c.h) : null;
          });
          if (!inputs[0]) continue;
          crops.push({ box: base.box, score, inputs, ...(options.crops ? { png: encodePng(base.gray, base.w, base.h, 1) } : {}) });
        }
        const k = originalWidth / r.width;
        const flat = crops.flatMap((c) => c.inputs.filter((x): x is Input => !!x));
        const read = await readCrops(e, flat);
        const glyphs = crops.length ? pageGlyphs(page) : [];
        let n = 0;
        let at = 0;
        for (const c of crops) {
          const bbox = c.box.map((v) => Math.round(v * k * 10) / 10) as [number, number, number, number];
          // From the stored box, so `imstudium formulas check` later judges exactly the same way.
          const pdfGlyphs = glyphsFor(glyphs, bbox);
          const readings: Reading[] = [];
          c.inputs.forEach((input, j) => {
            if (!input) return;
            const latex = read[at++]!;
            if (latex) readings.push({ latex, factor: factors[j]!, ...judgeFormula(latex, pdfGlyphs) });
          });
          if (!readings.length) continue;
          n++;
          const { index: chosen, confidence } = readings.length > 1 ? decideReading(readings) : { index: 0, confidence: 1 };
          const r0 = readings[chosen]!;
          const others = [...new Set(readings.filter((x) => x.latex !== r0.latex).map((x) => x.latex))];
          formulas.push({
            id: `p${index + 1}-${n}`,
            page: index,
            bbox,
            latex: r0.latex,
            score: Math.round(c.score * 100) / 100,
            ...decidedVerdict(readings, chosen, confidence),
            ...(readings.length > 1 ? { confidence: Math.round(confidence * 100) / 100 } : {}),
            ...(others.length ? { otherReadings: others } : {}),
            ...(options.readings ? { readings } : {}),
          });
          if (c.png) pngs.push(c.png);
        }
      } finally {
        page.close();
      }
    }
  } finally {
    doc.destroy();
  }
  return { formulas, pages, ms: Date.now() - started, ...(options.crops ? { crops: pngs } : {}) };
}

export interface RenderedPage {
  /** 0-based page. */
  page: number;
  width: number;
  height: number;
  /** RGBA, row-major. */
  rgba: Uint8Array;
}

/** Pages rendered at `dpi` with the math runtime's PDFium (all pages when `pages` is omitted). */
export async function renderPdfPages(pdf: Uint8Array, options: { dpi?: number; pages?: number[] } = {}): Promise<RenderedPage[]> {
  const doc = await (await getPdfium()).loadDocument(pdf);
  const out: RenderedPage[] = [];
  try {
    const pages = options.pages ?? Array.from({ length: doc.getPageCount() }, (_, i) => i);
    for (const index of pages) {
      if (index < 0 || index >= doc.getPageCount()) continue;
      const page = doc.getPage(index);
      try {
        const r = await page.render({ scale: (options.dpi ?? 150) / 72, render: "bitmap", colorSpace: "RGBA" });
        out.push({ page: index, width: r.width, height: r.height, rgba: new Uint8Array(r.data) });
      } finally {
        page.close();
      }
    }
  } finally {
    doc.destroy();
  }
  return out;
}

/**
 * Install check: render "E = mc²" set in Times on a tiny PDF, run the layout
 * model over the page (it must load and answer) and read the whole page as one
 * formula. Returns what the formula model read.
 */
export async function probeMathRuntime(): Promise<string> {
  const e = await getEngine();
  const doc = await e.pdfium.loadDocument(probePdf());
  try {
    const page = doc.getPage(0);
    const r = await page.render({ scale: 2, render: "bitmap", colorSpace: "RGBA" });
    page.close();
    const L = e.layoutInput;
    const feeds: Record<string, unknown> = {
      image: new e.ort.Tensor("float32", resizeToChw(r.data, r.width, r.height, L, L), [1, 3, L, L]),
      scale_factor: new e.ort.Tensor("float32", new Float32Array([L / r.height, L / r.width]), [1, 2]),
    };
    if (e.layout.inputNames.includes("im_shape")) feeds.im_shape = new e.ort.Tensor("float32", new Float32Array([L, L]), [1, 2]);
    await e.layout.run(feeds);
    const gray = new Uint8Array(r.width * r.height);
    for (let i = 0; i < gray.length; i++) gray[i] = Math.round(0.299 * r.data[i * 4]! + 0.587 * r.data[i * 4 + 1]! + 0.114 * r.data[i * 4 + 2]!);
    const input = unirecInput(gray, r.width, r.height);
    return input ? ((await readCrops(e, [input]))[0] ?? "") : "";
  } finally {
    doc.destroy();
  }
}

function probePdf(): Uint8Array {
  const stream = "BT /F1 40 Tf 200 400 Td (E = mc) Tj /F1 26 Tf 18 Ts (2) Tj ET";
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Times-Italic >>",
  ];
  return buildPdf(objs);
}
