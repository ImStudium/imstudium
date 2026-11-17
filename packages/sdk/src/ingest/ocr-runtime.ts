/**
 * On-device OCR for pdf-inspector: PDFium renders a page, ONNX Runtime runs the
 * PP-OCRv6 small models over it. Nothing leaves the machine — no Firecrawl
 * Parse, no AnyDoc `ocr: 'hosted'`, no cloud. The three pieces are downloaded
 * once, pinned and SHA-256-verified, into ~/.local/share/imstudium/ocr/:
 *
 *   pdfium/<version>/   Firecrawl's PDFium build (github.com/firecrawl/pdfium-rs)
 *   onnxruntime/<ver>/  Microsoft ONNX Runtime (github.com/microsoft/onnxruntime)
 *   models/             PP-OCRv6 small, fetched and verified by pdf-inspector itself
 *                       (github.com/GreatV/oar-ocr v0.7.0, ~31 MB)
 *
 * After `installOcrRuntime()`, extraction runs with `offline: true`: the engine
 * may not download anything, so documents are only ever read locally.
 */
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { arch, platform } from "node:os";
import { dirname, join } from "node:path";
import { paths } from "../config.js";
import { ImstudiumError } from "../errors.js";

export const PDFIUM_VERSION = "native-v7988";
export const ONNXRUNTIME_VERSION = "1.27.0";
export const OCR_MODEL = "pp-ocrv6-small (oar-ocr v0.7.0)";

interface PinnedAsset {
  url: string;
  sha256: string;
  /** The shared library inside the archive. */
  lib: string;
}

interface PlatformRuntime {
  pdfium: PinnedAsset;
  onnxruntime: PinnedAsset;
}

const PDFIUM = (asset: string, sha256: string, lib: string): PinnedAsset => ({
  url: `https://github.com/firecrawl/pdfium-rs/releases/download/${PDFIUM_VERSION}/${asset}`,
  sha256,
  lib,
});
const ORT = (asset: string, sha256: string, lib: string): PinnedAsset => ({
  url: `https://github.com/microsoft/onnxruntime/releases/download/v${ONNXRUNTIME_VERSION}/${asset}`,
  sha256,
  lib,
});

/**
 * The release pdf-inspector's OCR is tested against (docs/ocr-runtime.md upstream).
 * Intel macOS has PDFium but no ONNX Runtime 1.27 build, so no local OCR there.
 */
export const OCR_RUNTIMES: Record<string, PlatformRuntime> = {
  "darwin-arm64": {
    pdfium: PDFIUM("firecrawl-pdfium-mac-arm64.tgz", "4168356c2e62ad5e79553e2e9162f5c99949759d90cb83876a50311f0c32b9b3", "lib/libpdfium.dylib"),
    onnxruntime: ORT("onnxruntime-osx-arm64-1.27.0.tgz", "545e81c58152353acb0d1e8bd6ce4b62f830c0961f5b3acfedc790ffd76e477a", "lib/libonnxruntime.dylib"),
  },
  "linux-x64": {
    pdfium: PDFIUM("firecrawl-pdfium-linux-x64.tgz", "6248189e07bbc33cdeb31976c539a88614307c8a19f3276dbd018efbe5b4a2a2", "lib/libpdfium.so"),
    onnxruntime: ORT("onnxruntime-linux-x64-1.27.0.tgz", "547e40a48f1fe73e3f812d7c88a948612c23f896b91e4e2ee1e232d7b468246f", "lib/libonnxruntime.so"),
  },
  "linux-arm64": {
    pdfium: PDFIUM("firecrawl-pdfium-linux-arm64.tgz", "fb67e132abf9a816194bb40cbe1c9e1f6e3bfcaa0b0ef645bf2e6b9f155c8a73", "lib/libpdfium.so"),
    onnxruntime: ORT("onnxruntime-linux-aarch64-1.27.0.tgz", "3e4d83ac06924a32a07b6d7f91ce6f852876153fc0bbdf931bf517a140bfbe48", "lib/libonnxruntime.so"),
  },
  "win32-x64": {
    pdfium: PDFIUM("firecrawl-pdfium-win-x64.tgz", "6f398552d8021a89078f64466557251a204999177287b876be49877eb8750d50", "bin/pdfium.dll"),
    onnxruntime: ORT("onnxruntime-win-x64-1.27.0.zip", "c5c81710938e68079ff1a192b04897faabe4b43830d48f39f27ecd4e16138bfc", "lib/onnxruntime.dll"),
  },
};

export function ocrPlatformKey(): string {
  return `${platform()}-${arch()}`;
}

/** ~/.local/share/imstudium/ocr, or IMSTUDIUM_OCR_DIR (read on every call). */
export function ocrRoot(): string {
  return process.env.IMSTUDIUM_OCR_DIR || join(paths.dataDir, "ocr");
}

const pdfiumDir = () => join(ocrRoot(), "pdfium", PDFIUM_VERSION);
const ortDir = () => join(ocrRoot(), "onnxruntime", ONNXRUNTIME_VERSION);
export const ocrModelCache = () => join(ocrRoot(), "models");
const markerFile = () => join(ocrRoot(), "runtime.json");

/** What `imstudium setup ocr` wrote into runtime.json. */
export interface OcrRuntimeInfo {
  platform: string;
  pdfium: string;
  onnxruntime: string;
  model: string;
  installedAt: string;
}

export interface OcrRuntimeStatus {
  /** This platform has a pinned runtime. */
  supported: boolean;
  /** Libraries unpacked and the model cache warmed by `imstudium setup ocr`, for the pinned versions. */
  ready: boolean;
  platform: string;
  /** Root of the runtime (IMSTUDIUM_OCR_DIR or ~/.local/share/imstudium/ocr). */
  dir: string;
  pdfiumLib: string | null;
  onnxruntimeLib: string | null;
  modelCache: string;
  model: string;
  /** Turned off with IMSTUDIUM_OCR=off. */
  disabled: boolean;
  /** The install found on disk, also when it is for older pins. */
  installed: OcrRuntimeInfo | null;
  /** Why OCR will not run, when it won't. */
  reason: string | null;
}

export function ocrDisabledByEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return /^(0|off|false|no)$/i.test((env.IMSTUDIUM_OCR ?? "").trim());
}

function readMarker(): OcrRuntimeInfo | null {
  try {
    return JSON.parse(readFileSync(markerFile(), "utf-8")) as OcrRuntimeInfo;
  } catch {
    return null;
  }
}

/** Where everything lives and whether OCR can run — no network, no native loading. */
export function ocrRuntimeStatus(): OcrRuntimeStatus {
  const key = ocrPlatformKey();
  const rt = OCR_RUNTIMES[key];
  const pdfiumLib = rt ? join(pdfiumDir(), rt.pdfium.lib) : null;
  const onnxruntimeLib = rt ? join(ortDir(), rt.onnxruntime.lib) : null;
  const installed = readMarker();
  const current = !!installed && installed.pdfium === PDFIUM_VERSION && installed.onnxruntime === ONNXRUNTIME_VERSION && installed.model === OCR_MODEL;
  const unpacked = !!(pdfiumLib && onnxruntimeLib && existsSync(pdfiumLib) && existsSync(onnxruntimeLib));
  const disabled = ocrDisabledByEnv();
  // Bun's process.env setter does not reach the native loader, so the runtime can't be pointed at.
  const bun = typeof (process.versions as Record<string, string | undefined>).bun === "string";
  const ready = !!rt && unpacked && current;
  const reason = !rt
    ? `no pinned OCR runtime for ${key}`
    : !installed && !unpacked
      ? "not installed"
      : !current
        ? `installed for older pins (${installed?.pdfium ?? "?"}, ONNX Runtime ${installed?.onnxruntime ?? "?"})`
        : !unpacked
          ? "libraries missing"
          : disabled
            ? "switched off (IMSTUDIUM_OCR=off)"
            : bun
              ? "runs under Node only (Bun does not pass the library paths to native code)"
              : null;
  return {
    supported: !!rt,
    ready: ready && !bun,
    platform: key,
    dir: ocrRoot(),
    pdfiumLib,
    onnxruntimeLib,
    modelCache: ocrModelCache(),
    model: OCR_MODEL,
    disabled,
    installed,
    reason,
  };
}

/**
 * Point pdf-inspector at our libraries and model cache. Node's process.env
 * setter updates the real environment, which the native loader reads on the
 * first OCR call. Returns false when OCR can't run here.
 */
export function activateOcrRuntime(status = ocrRuntimeStatus()): boolean {
  if (!status.ready || status.disabled || !status.pdfiumLib || !status.onnxruntimeLib) return false;
  process.env.PDFIUM_LIB_PATH = status.pdfiumLib;
  process.env.ORT_DYLIB_PATH = status.onnxruntimeLib;
  process.env.PDF_INSPECTOR_MODEL_CACHE = status.modelCache;
  return true;
}

/** sha256 of a buffer, hex. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Fetch a pinned file and refuse it unless its SHA-256 matches. */
export async function downloadVerified(url: string, sha256: string, fetchImpl: typeof fetch = fetch): Promise<Buffer> {
  let res: Response;
  try {
    res = await fetchImpl(url, { redirect: "follow" });
  } catch (err) {
    throw new ImstudiumError(`Could not download ${url.split("/").pop()}: ${err instanceof Error ? err.message : String(err)}`, "OCR_INSTALL_FAILED", undefined, undefined, { url });
  }
  if (!res.ok) throw new ImstudiumError(`Download failed (${res.status}): ${url}`, "OCR_INSTALL_FAILED", res.status, undefined, { url });
  const bytes = Buffer.from(await res.arrayBuffer());
  const got = sha256Hex(bytes);
  if (got !== sha256) {
    throw new ImstudiumError(`Checksum mismatch for ${url.split("/").pop()}; nothing was installed`, "OCR_INSTALL_FAILED", undefined, "The download was not the pinned file. Try again later; if it persists, open an issue", {
      url,
      expected: sha256,
      got,
    });
  }
  return bytes;
}

/** sha256 of a file on disk, streamed (a model is too big to hold twice), hex. */
export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/**
 * Fetch a pinned file to `dest` through `dest.part`, which survives a broken
 * run: a partial file is resumed with an HTTP Range request (from scratch when
 * the server ignores it), and a connection that breaks off mid-file
 * ("terminated") is retried from where it stopped, up to `retries` times. The
 * finished file must match `sha256`, else it is deleted and nothing is
 * installed. Returns the bytes fetched by this call.
 */
export async function downloadToFile(
  url: string,
  sha256: string,
  dest: string,
  options: { fetchImpl?: typeof fetch; retries?: number; onProgress?: (msg: string) => void; waitMs?: number; startedOver?: boolean; errorCode?: "OCR_INSTALL_FAILED" | "SPEECH_INSTALL_FAILED" } = {},
): Promise<number> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const code = options.errorCode ?? "OCR_INSTALL_FAILED";
  const retries = options.retries ?? 5;
  const name = url.split("/").pop()!;
  const part = `${dest}.part`;
  await mkdir(dirname(dest), { recursive: true });
  const size = async () => (await stat(part).catch(() => null))?.size ?? 0;
  let fetched = 0;
  // A resumed file that doesn't match (a partial file left by an older pin of the same name) is fetched once more from scratch.
  let resumed = false;
  for (let attempt = 0; ; attempt++) {
    const have = await size();
    let failure: unknown;
    try {
      const res = await fetchImpl(url, { redirect: "follow", ...(have ? { headers: { Range: `bytes=${have}-` } } : {}) });
      if (res.status === 416 && have) break; // the partial file is already whole: verify it below
      if (!res.ok) {
        if (res.status < 500) throw new ImstudiumError(`Download failed (${res.status}): ${url}`, code, res.status, undefined, { url });
        throw new Error(`HTTP ${res.status}`);
      }
      const append = have > 0 && res.status === 206;
      resumed ||= append;
      if (have && !append) options.onProgress?.(`${name}: the server can't resume, starting over`);
      else if (have) options.onProgress?.(`${name}: resuming at ${Math.round(have / 1e6)} MB`);
      // Each chunk is on disk before the next is read, so a break keeps everything received.
      const out = await open(part, append ? "a" : "w");
      try {
        for await (const chunk of (res.body ?? []) as AsyncIterable<Uint8Array>) {
          await out.write(chunk);
          fetched += chunk.length;
        }
      } finally {
        await out.close();
      }
      break;
    } catch (err) {
      if (err instanceof ImstudiumError) throw err;
      failure = err;
    }
    const why = failure instanceof Error ? failure.message : String(failure);
    if (attempt >= retries) {
      throw new ImstudiumError(`Could not download ${name}: ${why}`, code, undefined, `Run the same command again: it resumes at ${Math.round((await size()) / 1e6)} MB`, { url });
    }
    options.onProgress?.(`${name}: connection broke off at ${Math.round((await size()) / 1e6)} MB (${why}), retrying`);
    await new Promise((r) => setTimeout(r, (options.waitMs ?? 2000) * (attempt + 1)));
  }
  const got = await sha256File(part);
  if (got !== sha256 && resumed && !options.startedOver) {
    await rm(part, { force: true });
    options.onProgress?.(`${name}: the resumed file doesn't match its pin, starting over`);
    return fetched + (await downloadToFile(url, sha256, dest, { ...options, startedOver: true }));
  }
  if (got !== sha256) {
    await rm(part, { force: true });
    throw new ImstudiumError(`Checksum mismatch for ${name}; nothing was installed`, code, undefined, "The download was not the pinned file. Try again later; if it persists, open an issue", {
      url,
      expected: sha256,
      got,
    });
  }
  await rename(part, dest);
  return fetched;
}

/**
 * Unpack with the system tar (bsdtar on macOS and Windows 10+ also reads .zip).
 * `--no-same-owner`: as root, GNU tar would otherwise keep the archive's uid.
 */
async function unpack(archive: string, into: string): Promise<void> {
  const { execFile } = await import("node:child_process");
  await mkdir(into, { recursive: true });
  await new Promise<void>((resolve, reject) =>
    execFile("tar", ["--no-same-owner", "-xf", archive, "-C", into], (err, _out, stderr) =>
      err ? reject(new ImstudiumError(`Unpacking ${archive} failed: ${stderr || err.message}`, "OCR_INSTALL_FAILED")) : resolve(),
    ),
  );
}

/** Archives wrap their files in a top folder (onnxruntime-osx-arm64-1.27.0/…); find the library wherever it landed. */
async function locate(root: string, rel: string): Promise<string | null> {
  if (existsSync(join(root, rel))) return join(root, rel);
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isDirectory() && existsSync(join(root, entry.name, rel))) return join(root, entry.name, rel);
  }
  return null;
}

async function installAsset(asset: PinnedAsset, dir: string, onProgress?: (msg: string) => void): Promise<number> {
  const name = asset.url.split("/").pop()!;
  onProgress?.(`downloading ${name}`);
  const bytes = await downloadVerified(asset.url, asset.sha256);
  onProgress?.(`verified ${name} (sha256 ${asset.sha256.slice(0, 12)}…)`);
  await rm(dir, { recursive: true, force: true });
  const staging = `${dir}.staging`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  const archive = join(staging, name);
  await writeFile(archive, bytes);
  await unpack(archive, join(staging, "x"));
  const found = await locate(join(staging, "x"), asset.lib);
  if (!found) throw new ImstudiumError(`${asset.lib} not found in ${name}`, "OCR_INSTALL_FAILED");
  // Keep the archive's own layout under dir so sibling libraries (libonnxruntime.1.dylib …) resolve:
  // the folder that holds `lib/…` (or `bin/…`) becomes dir.
  const top = found.slice(0, found.length - asset.lib.length - 1);
  await mkdir(dirname(dir), { recursive: true });
  await rename(top, dir);
  await rm(staging, { recursive: true, force: true });
  return bytes.length;
}

/** A one-page text PDF; OCR in Force mode renders and reads it, which fetches and verifies the models once. */
function warmupPdf(): Buffer {
  const stream = "BT /F1 48 Tf 72 700 Td (ImStudium OCR) Tj ET";
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  return buildPdf(objs);
}

/** Serialise numbered objects into a PDF with a correct xref table. */
export function buildPdf(objects: Array<string | Buffer>): Buffer {
  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "latin1")];
  const offsets: number[] = [];
  let length = parts[0]!.length;
  objects.forEach((obj, i) => {
    offsets.push(length);
    const body = Buffer.isBuffer(obj) ? obj : Buffer.from(obj, "latin1");
    const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, "latin1"), body, Buffer.from("\nendobj\n", "latin1")]);
    parts.push(chunk);
    length += chunk.length;
  });
  const xref = [
    "xref",
    `0 ${objects.length + 1}`,
    "0000000000 65535 f ",
    ...offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n `),
    "trailer",
    `<< /Size ${objects.length + 1} /Root 1 0 R >>`,
    "startxref",
    String(length),
    "%%EOF",
    "",
  ].join("\n");
  parts.push(Buffer.from(xref, "latin1"));
  return Buffer.concat(parts);
}

export interface OcrInstallResult {
  status: OcrRuntimeStatus;
  /** Pieces fetched in this run: "PDFium", "ONNX Runtime", "models". */
  installed: string[];
  /** Pieces already in place. */
  skipped: string[];
  /** Bytes downloaded for the libraries (the models are fetched by pdf-inspector). */
  downloadedBytes: number;
  /** Size of the runtime on disk after the install. */
  diskBytes: number;
  durationMs: number;
}

async function hasOnnxModels(dir: string): Promise<boolean> {
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (entry.isFile() && entry.name.endsWith(".onnx")) return true;
    if (entry.isDirectory() && (await hasOnnxModels(join(dir, entry.name)))) return true;
  }
  return false;
}

/** Total size of a directory tree in bytes (symlinks not followed). */
export async function dirBytes(dir: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) total += await dirBytes(p);
    else if (entry.isFile()) total += (await stat(p).catch(() => ({ size: 0 }))).size;
  }
  return total;
}

/**
 * Download, verify and unpack the pinned runtime for this platform, then warm
 * the model cache with one local OCR run. Idempotent; `force` reinstalls
 * everything, models included.
 */
export async function installOcrRuntime(options: { force?: boolean; onProgress?: (msg: string) => void } = {}): Promise<OcrInstallResult> {
  const started = Date.now();
  const key = ocrPlatformKey();
  const rt = OCR_RUNTIMES[key];
  if (!rt) {
    throw new ImstudiumError(`No local OCR runtime for ${key}`, "OCR_UNSUPPORTED", undefined, undefined, { platform: key, supported: Object.keys(OCR_RUNTIMES) });
  }
  if (typeof (process.versions as Record<string, string | undefined>).bun === "string") {
    throw new ImstudiumError("Local OCR runs under Node", "OCR_UNSUPPORTED", undefined, "Run imstudium with Node (npm i -g @imstudium/sdk), not Bun", { platform: key, runtime: "bun" });
  }
  const installed: string[] = [];
  const skipped: string[] = [];
  let downloadedBytes = 0;
  const previous = readMarker();
  const stale = !!previous && (previous.pdfium !== PDFIUM_VERSION || previous.onnxruntime !== ONNXRUNTIME_VERSION);

  for (const [label, asset, dir] of [
    ["PDFium", rt.pdfium, pdfiumDir()],
    ["ONNX Runtime", rt.onnxruntime, ortDir()],
  ] as const) {
    if (!options.force && existsSync(join(dir, asset.lib))) {
      skipped.push(label);
      continue;
    }
    downloadedBytes += await installAsset(asset, dir, options.onProgress);
    installed.push(label);
  }
  // Older pins left behind by an upgrade.
  if (stale && previous) {
    if (previous.pdfium !== PDFIUM_VERSION) await rm(join(ocrRoot(), "pdfium", previous.pdfium), { recursive: true, force: true });
    if (previous.onnxruntime !== ONNXRUNTIME_VERSION) await rm(join(ocrRoot(), "onnxruntime", previous.onnxruntime), { recursive: true, force: true });
  }

  // Models: let pdf-inspector fetch and checksum them into our cache, once.
  const modelCache = ocrModelCache();
  if (options.force) await rm(modelCache, { recursive: true, force: true });
  const hadModels = await hasOnnxModels(modelCache);
  process.env.PDFIUM_LIB_PATH = join(pdfiumDir(), rt.pdfium.lib);
  process.env.ORT_DYLIB_PATH = join(ortDir(), rt.onnxruntime.lib);
  process.env.PDF_INSPECTOR_MODEL_CACHE = modelCache;
  await mkdir(modelCache, { recursive: true });
  const { processPdfWithOcr } = await import("@firecrawl/pdf-inspector");
  try {
    if (!hadModels) {
      options.onProgress?.(`fetching the OCR models (${OCR_MODEL}), verified by pdf-inspector`);
      await processPdfWithOcr(warmupPdf(), { mode: "Force" as never });
    }
    // An offline run proves the cache is complete before we call it ready.
    options.onProgress?.("checking an offline OCR run");
    await processPdfWithOcr(warmupPdf(), { mode: "Force" as never, offline: true });
  } catch (err) {
    throw new ImstudiumError(`The OCR runtime did not start: ${err instanceof Error ? err.message : String(err)}`, "OCR_INSTALL_FAILED", undefined, "Run: imstudium setup ocr --force");
  }
  (hadModels ? skipped : installed).push("models");

  const info: OcrRuntimeInfo = { platform: key, pdfium: PDFIUM_VERSION, onnxruntime: ONNXRUNTIME_VERSION, model: OCR_MODEL, installedAt: new Date().toISOString() };
  await writeFile(markerFile(), `${JSON.stringify({ ...info, sha256: { pdfium: rt.pdfium.sha256, onnxruntime: rt.onnxruntime.sha256 } }, null, 2)}\n`);
  return { status: ocrRuntimeStatus(), installed, skipped, downloadedBytes, diskBytes: await dirBytes(ocrRoot()), durationMs: Date.now() - started };
}

/** Remove the runtime and models (extraction falls back to native text + image-only markers). Returns the bytes freed. */
export async function removeOcrRuntime(): Promise<{ removed: boolean; freedBytes: number; dir: string }> {
  const dir = ocrRoot();
  if (!existsSync(dir)) return { removed: false, freedBytes: 0, dir };
  const freedBytes = await dirBytes(dir);
  await rm(dir, { recursive: true, force: true });
  return { removed: true, freedBytes, dir };
}

/** For `doctor`: the installed versions, if any. */
export async function ocrRuntimeInfo(): Promise<OcrRuntimeInfo | null> {
  try {
    return JSON.parse(await readFile(markerFile(), "utf-8")) as OcrRuntimeInfo;
  } catch {
    return null;
  }
}
