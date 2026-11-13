/**
 * On-device math recognition: display formulas on a PDF page become LaTeX.
 *
 *   PDFium (WASM, @hyzyla/pdfium)  renders the page
 *   PP-DocLayout-S                 finds display formulas (layout class "formula")
 *   PP-FormulaNet+ S               reads each crop into LaTeX tokens
 *   unimernet_tokenizer.json       turns the tokens into text (byte-level BPE)
 *
 * Both models come from oar-ocr's GitHub release v0.3.0 and run on ONNX
 * Runtime 1.27.0 through the onnxruntime-node binding. Everything is a pinned,
 * SHA-256-verified download that `imstudium setup ocr --math` puts under
 * <ocr>/math/; nothing here is an npm dependency, and nothing leaves the
 * machine. Inline math (`$x_i$` inside a sentence) is not detected by the
 * small layout model and stays as pdf-inspector's native text.
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { ImstudiumError } from "../errors.js";
import { buildPdf, dirBytes, downloadVerified, ocrPlatformKey, ocrRoot, OCR_RUNTIMES } from "./ocr-runtime.js";

export const MATH_MODEL = "pp-formulanet_plus-s (oar-ocr v0.3.0)";
export const LAYOUT_MODEL = "pp-doclayout-s (oar-ocr v0.3.0)";
const OAR = "https://github.com/GreatV/oar-ocr/releases/download/v0.3.0";
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
    label: "formula model",
    kind: "file",
    name: "pp-formulanet_plus-s.onnx",
    url: `${OAR}/pp-formulanet_plus-s.onnx`,
    sha256: "449d205c8fb2fe0a9b134a5e4a0f2421c2e7812fd902ea67dfda4e9ef4588978",
    bytes: 231_878_904,
  },
  {
    label: "formula tokenizer",
    kind: "file",
    name: "unimernet_tokenizer.json",
    url: `${OAR}/unimernet_tokenizer.json`,
    sha256: "2811d82701ec97c192fa256aa2b4516929373870ae660326cc5b1dc879b95ff2",
    bytes: 2_140_014,
  },
  {
    label: "layout model",
    kind: "file",
    name: "pp-doclayout-s.onnx",
    url: `${OAR}/pp-doclayout-s.onnx`,
    sha256: "c2336493a0a13cd9b9b457ca68aea370b327c362a4a7da4917c2bba96029bceb",
    bytes: 4_914_918,
  },
];

export const mathDir = () => join(ocrRoot(), "math");
const modulesDir = () => join(mathDir(), "node_modules");
const modelsDir = () => join(mathDir(), "models");
const mathMarker = () => join(mathDir(), "math.json");

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

/** Download, verify and unpack the math pieces, then prove one formula reads. Idempotent; `force` refetches. */
export async function installMathRuntime(options: { force?: boolean; onProgress?: (msg: string) => void } = {}): Promise<MathInstallResult> {
  const key = ocrPlatformKey();
  if (!OCR_RUNTIMES[key] || !ORT_PLATFORM_DIR[key]) {
    throw new ImstudiumError(`No local math runtime for ${key}`, "OCR_UNSUPPORTED", undefined, undefined, { platform: key });
  }
  const installed: string[] = [];
  const skipped: string[] = [];
  let downloadedBytes = 0;
  if (options.force) await rm(mathDir(), { recursive: true, force: true });
  await mkdir(modelsDir(), { recursive: true });
  for (const a of MATH_ASSETS) {
    if (existsSync(assetPath(a))) {
      skipped.push(a.label);
      continue;
    }
    options.onProgress?.(`downloading ${a.url.split("/").pop()} (${Math.round(a.bytes / 1e6)} MB)`);
    const bytes = await downloadVerified(a.url, a.sha256);
    downloadedBytes += bytes.length;
    options.onProgress?.(`verified ${a.url.split("/").pop()} (sha256 ${a.sha256.slice(0, 12)}…)`);
    if (a.kind === "file") {
      const tmp = `${assetPath(a)}.part`;
      await writeFile(tmp, bytes);
      await rename(tmp, assetPath(a));
    } else {
      const dest = join(modulesDir(), a.name);
      const staging = `${dest}.staging`;
      await rm(staging, { recursive: true, force: true });
      await mkdir(staging, { recursive: true });
      const archive = join(staging, "package.tgz");
      await writeFile(archive, bytes);
      const out = join(staging, "x");
      await unpackMembers(archive, out, a.members!(key));
      await rm(dest, { recursive: true, force: true });
      await mkdir(join(dest, ".."), { recursive: true });
      await rename(out, dest);
      await rm(staging, { recursive: true, force: true });
    }
    installed.push(a.label);
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
  run(feeds: Record<string, unknown>): Promise<Record<string, OrtTensor>>;
}
interface Ort {
  InferenceSession: { create(path: string, options?: Record<string, unknown>): Promise<OrtSession> };
  Tensor: new (type: string, data: Float32Array, dims: number[]) => unknown;
}
interface PdfiumPage {
  render(options: { scale: number; render: "bitmap"; colorSpace?: "RGBA" | "Gray" }): Promise<{ width: number; height: number; data: Uint8Array }>;
  getOriginalSize(): { originalWidth: number; originalHeight: number };
  close(): void;
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
  formula: OrtSession;
  vocab: string[];
}

let engine: Promise<Engine> | null = null;

export function resetMathEngine(): void {
  engine = null;
}

async function loadEngine(): Promise<Engine> {
  const req = createRequire(join(modulesDir(), "loader.cjs"));
  const ort = req("onnxruntime-node") as Ort;
  const { PDFiumLibrary } = req("@hyzyla/pdfium") as { PDFiumLibrary: { init(o?: { wasmBinary?: Uint8Array }): Promise<PdfiumLibrary> } };
  const wasmBinary = await readFile(join(modulesDir(), "@hyzyla", "pdfium", "dist", "pdfium.wasm"));
  const pdfium = await PDFiumLibrary.init({ wasmBinary });
  const threads = Math.max(1, Math.min(4, availableParallelism()));
  const layout = await ort.InferenceSession.create(join(modelsDir(), "pp-doclayout-s.onnx"), { intraOpNumThreads: threads });
  const formula = await ort.InferenceSession.create(join(modelsDir(), "pp-formulanet_plus-s.onnx"), { intraOpNumThreads: threads });
  const tok = JSON.parse(await readFile(join(modelsDir(), "unimernet_tokenizer.json"), "utf-8")) as { model: { vocab: Record<string, number> } };
  const vocab: string[] = [];
  for (const [t, id] of Object.entries(tok.model.vocab)) vocab[id] = t;
  return { ort, pdfium, layout, formula, vocab };
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

const BOS = 0;
const EOS = 2;
const VOCAB_SIZE = 50_000;

/** Token ids → text: stop at </s> or a sentinel id, drop <s>, undo the byte-level encoding. */
export function decodeFormulaTokens(ids: Iterable<number>, vocab: string[]): string {
  const pieces: string[] = [];
  for (const id of ids) {
    if (id === EOS || id >= VOCAB_SIZE) break;
    if (id < 0 || id === BOS || id === 1) continue;
    pieces.push(vocab[id] ?? "");
  }
  const bytes: number[] = [];
  for (const ch of pieces.join("")) {
    const b = BYTE_OF_CHAR.get(ch);
    if (b !== undefined) bytes.push(b);
  }
  return Buffer.from(bytes).toString("utf-8");
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
  return s.trim().replace(/\s*[.,]$/, "").trim();
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

export const FORMULA_INPUT = 384;
const FORMULA_MEAN = 0.7931;
const FORMULA_STD = 0.1738;

/**
 * PP-FormulaNet input for one gray crop: trim the margin (ink = below 200 after
 * a min–max stretch), fit inside 384×384 keeping the aspect ratio, centre on
 * black, normalise. Returns null when the crop has no ink.
 */
export function formulaInput(gray: Uint8Array, w: number, h: number, size = FORMULA_INPUT): Float32Array | null {
  let mn = 255;
  let mx = 0;
  for (let i = 0; i < w * h; i++) {
    const v = gray[i]!;
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  if (mx === mn) return null;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (Math.floor(((gray[y * w + x]! - mn) / (mx - mn)) * 255) < 200) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 <= x0 || y1 <= y0) return null;
  const cw = x1 - x0 + 1;
  const ch = y1 - y0 + 1;
  const scale = size / Math.max(cw, ch);
  const nw = Math.max(1, Math.min(size, Math.floor(cw * scale)));
  const nh = Math.max(1, Math.min(size, Math.floor(ch * scale)));
  const out = new Float32Array(size * size).fill((0 - FORMULA_MEAN) / FORMULA_STD);
  const left = Math.floor((size - nw) / 2);
  const top = Math.floor((size - nh) / 2);
  const at = (xx: number, yy: number) => gray[(y0 + yy) * w + x0 + xx]!;
  for (let y = 0; y < nh; y++) {
    const sy = Math.min(ch - 1, Math.max(0, (y + 0.5) / scale - 0.5));
    const ya = Math.floor(sy);
    const yb = Math.min(ch - 1, ya + 1);
    const fy = sy - ya;
    for (let x = 0; x < nw; x++) {
      const sx = Math.min(cw - 1, Math.max(0, (x + 0.5) / scale - 0.5));
      const xa = Math.floor(sx);
      const xb = Math.min(cw - 1, xa + 1);
      const fx = sx - xa;
      const v = (at(xa, ya) * (1 - fx) + at(xb, ya) * fx) * (1 - fy) + (at(xa, yb) * (1 - fx) + at(xb, yb) * fx) * fy;
      out[(top + y) * size + left + x] = (v / 255 - FORMULA_MEAN) / FORMULA_STD;
    }
  }
  return out;
}

// ── Recognition ──────────────────────────────────────────────────────────────

export interface Formula {
  /** 0-based page. */
  page: number;
  /** [x0, y0, x1, y1] in PDF points, top-left origin. */
  bbox: [number, number, number, number];
  latex: string;
  /** Layout detector confidence. */
  score: number;
}

export interface MathResult {
  formulas: Formula[];
  /** Pages the layout pass looked at. */
  pages: number[];
  ms: number;
}

const LAYOUT_INPUT = 480;
const FORMULA_CLASS = 7;
const MIN_SCORE = 0.5;
/** Render so the long side is about this many pixels (≈ 200–290 DPI for slides and A4). */
const RENDER_LONG_SIDE = 2400;
const BATCH = 8;

const iou = (a: number[], b: number[]) => {
  const ix = Math.max(0, Math.min(a[2]!, b[2]!) - Math.max(a[0]!, b[0]!));
  const iy = Math.max(0, Math.min(a[3]!, b[3]!) - Math.max(a[1]!, b[1]!));
  const inter = ix * iy;
  const area = (r: number[]) => (r[2]! - r[0]!) * (r[3]! - r[1]!);
  return inter / Math.max(1e-6, area(a) + area(b) - inter);
};

/** PP-FormulaNet over prepared crops, in batches; one normalised LaTeX string per crop ("" when nothing was read). */
async function readCrops(e: Engine, inputs: Float32Array[]): Promise<string[]> {
  const out: string[] = [];
  for (let b = 0; b < inputs.length; b += BATCH) {
    const batch = inputs.slice(b, b + BATCH);
    const data = new Float32Array(batch.length * FORMULA_INPUT * FORMULA_INPUT);
    batch.forEach((input, i) => data.set(input, i * FORMULA_INPUT * FORMULA_INPUT));
    const res = await e.formula.run({ [e.formula.inputNames[0]!]: new e.ort.Tensor("float32", data, [batch.length, 1, FORMULA_INPUT, FORMULA_INPUT]) });
    const ids = Object.values(res).find((t) => t.dims.length === 2 && t.type === "int64");
    const len = ids?.dims[1] ?? 0;
    batch.forEach((_, i) => {
      const row = ids ? Array.from({ length: len }, (_, k) => Number(ids.data[i * len + k])) : [];
      out.push(normalizeLatex(decodeFormulaTokens(row, e.vocab)));
    });
  }
  return out;
}

/** Display formulas on the given pages (0-based; all pages when omitted), read into LaTeX on this machine. */
export async function recognizeMath(pdf: Uint8Array, options: { pages?: number[] } = {}): Promise<MathResult> {
  const started = Date.now();
  const e = await getEngine();
  const doc = await e.pdfium.loadDocument(pdf);
  const formulas: Formula[] = [];
  const pages = options.pages ?? Array.from({ length: doc.getPageCount() }, (_, i) => i);
  try {
    for (const index of pages) {
      if (index < 0 || index >= doc.getPageCount()) continue;
      const page = doc.getPage(index);
      try {
        const { originalWidth, originalHeight } = page.getOriginalSize();
        const scale = Math.min(4, RENDER_LONG_SIDE / Math.max(originalWidth, originalHeight));
        const r = await page.render({ scale, render: "bitmap", colorSpace: "RGBA" });
        const image = new e.ort.Tensor("float32", resizeToChw(r.data, r.width, r.height, LAYOUT_INPUT, LAYOUT_INPUT), [1, 3, LAYOUT_INPUT, LAYOUT_INPUT]);
        const scaleFactor = new e.ort.Tensor("float32", new Float32Array([LAYOUT_INPUT / r.height, LAYOUT_INPUT / r.width]), [1, 2]);
        const feeds: Record<string, unknown> = { image, scale_factor: scaleFactor };
        if (e.layout.inputNames.includes("im_shape")) feeds.im_shape = new e.ort.Tensor("float32", new Float32Array([LAYOUT_INPUT, LAYOUT_INPUT]), [1, 2]);
        const out = await e.layout.run(feeds);
        const det = Object.values(out).find((t) => t.dims.length === 2 && t.dims[1]! >= 6);
        if (!det) continue;
        const width = det.dims[1]!;
        const boxes: Array<{ box: number[]; score: number }> = [];
        for (let i = 0; i < det.dims[0]!; i++) {
          const cls = Number(det.data[i * width]);
          const score = Number(det.data[i * width + 1]);
          if (cls !== FORMULA_CLASS || score < MIN_SCORE) continue;
          const box = [2, 3, 4, 5].map((k) => Number(det.data[i * width + k]));
          if (boxes.some((b) => iou(b.box, box) > 0.5)) continue;
          boxes.push({ box, score });
        }
        boxes.sort((a, b) => a.box[1]! - b.box[1]! || a.box[0]! - b.box[0]!);
        const crops: Array<{ input: Float32Array; box: number[]; score: number }> = [];
        for (const { box, score } of boxes) {
          const pad = Math.round(4 * (r.width / originalWidth));
          const X0 = Math.max(0, Math.floor(box[0]!) - pad);
          const Y0 = Math.max(0, Math.floor(box[1]!) - pad);
          const X1 = Math.min(r.width, Math.ceil(box[2]!) + pad);
          const Y1 = Math.min(r.height, Math.ceil(box[3]!) + pad);
          const w = X1 - X0;
          const h = Y1 - Y0;
          if (w < 4 || h < 4) continue;
          const gray = new Uint8Array(w * h);
          for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
              const i = ((Y0 + y) * r.width + X0 + x) * 4;
              gray[y * w + x] = Math.round(0.299 * r.data[i]! + 0.587 * r.data[i + 1]! + 0.114 * r.data[i + 2]!);
            }
          }
          const input = formulaInput(gray, w, h);
          if (input) crops.push({ input, box: [X0, Y0, X1, Y1], score });
        }
        const k = originalWidth / r.width;
        const latex = await readCrops(e, crops.map((c) => c.input));
        crops.forEach((c, i) => {
          if (!latex[i]) return;
          const bbox = c.box.map((v) => Math.round(v * k * 10) / 10) as [number, number, number, number];
          formulas.push({ page: index, bbox, latex: latex[i]!, score: Math.round(c.score * 100) / 100 });
        });
      } finally {
        page.close();
      }
    }
  } finally {
    doc.destroy();
  }
  return { formulas, pages, ms: Date.now() - started };
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
    await e.layout.run({
      image: new e.ort.Tensor("float32", resizeToChw(r.data, r.width, r.height, LAYOUT_INPUT, LAYOUT_INPUT), [1, 3, LAYOUT_INPUT, LAYOUT_INPUT]),
      scale_factor: new e.ort.Tensor("float32", new Float32Array([LAYOUT_INPUT / r.height, LAYOUT_INPUT / r.width]), [1, 2]),
    });
    const gray = new Uint8Array(r.width * r.height);
    for (let i = 0; i < gray.length; i++) gray[i] = Math.round(0.299 * r.data[i * 4]! + 0.587 * r.data[i * 4 + 1]! + 0.114 * r.data[i * 4 + 2]!);
    const input = formulaInput(gray, r.width, r.height);
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
