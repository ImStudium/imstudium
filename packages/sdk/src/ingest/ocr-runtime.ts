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
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { arch, platform } from "node:os";
import { dirname, join } from "node:path";
import { paths } from "../config.js";

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

export function ocrRoot(): string {
  return join(paths.dataDir, "ocr");
}

const pdfiumDir = () => join(ocrRoot(), "pdfium", PDFIUM_VERSION);
const ortDir = () => join(ocrRoot(), "onnxruntime", ONNXRUNTIME_VERSION);
export const ocrModelCache = () => join(ocrRoot(), "models");
const markerFile = () => join(ocrRoot(), "runtime.json");

export interface OcrRuntimeStatus {
  /** This platform has a pinned runtime. */
  supported: boolean;
  /** Libraries unpacked and the model cache warmed by `imstudium setup ocr`. */
  ready: boolean;
  platform: string;
  pdfiumLib: string | null;
  onnxruntimeLib: string | null;
  modelCache: string;
  model: string;
  /** Turned off with IMSTUDIUM_OCR=off. */
  disabled: boolean;
}

/** Where everything lives and whether OCR can run — no network, no native loading. */
export function ocrRuntimeStatus(): OcrRuntimeStatus {
  const key = ocrPlatformKey();
  const rt = OCR_RUNTIMES[key];
  const pdfiumLib = rt ? join(pdfiumDir(), rt.pdfium.lib) : null;
  const onnxruntimeLib = rt ? join(ortDir(), rt.onnxruntime.lib) : null;
  const ready = !!(rt && pdfiumLib && onnxruntimeLib && existsSync(pdfiumLib) && existsSync(onnxruntimeLib) && existsSync(markerFile()));
  return {
    supported: !!rt,
    ready,
    platform: key,
    pdfiumLib,
    onnxruntimeLib,
    modelCache: ocrModelCache(),
    model: OCR_MODEL,
    disabled: /^(0|off|false|no)$/i.test(process.env.IMSTUDIUM_OCR ?? ""),
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

async function download(url: string, sha256: string): Promise<Buffer> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Download failed (${res.status}) — ${url}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const got = createHash("sha256").update(bytes).digest("hex");
  if (got !== sha256) throw new Error(`Checksum mismatch for ${url} (expected ${sha256}, got ${got}) — nothing was installed`);
  return bytes;
}

/** Unpack with the system tar (bsdtar on macOS and Windows 10+ also reads .zip). */
async function unpack(archive: string, into: string): Promise<void> {
  const { execFile } = await import("node:child_process");
  await mkdir(into, { recursive: true });
  await new Promise<void>((resolve, reject) =>
    execFile("tar", ["-xf", archive, "-C", into], (err, _out, stderr) =>
      err ? reject(new Error(`Unpacking ${archive} failed: ${stderr || err.message}`)) : resolve(),
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

async function installAsset(asset: PinnedAsset, dir: string, onProgress?: (msg: string) => void): Promise<void> {
  const name = asset.url.split("/").pop()!;
  onProgress?.(`downloading ${name}`);
  const bytes = await download(asset.url, asset.sha256);
  onProgress?.(`verified ${name} (sha256 ${asset.sha256.slice(0, 12)}…)`);
  await rm(dir, { recursive: true, force: true });
  const staging = `${dir}.staging`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  const archive = join(staging, name);
  await writeFile(archive, bytes);
  await unpack(archive, join(staging, "x"));
  const found = await locate(join(staging, "x"), asset.lib);
  if (!found) throw new Error(`${asset.lib} not found in ${name}`);
  // Keep the archive's own layout under dir so sibling libraries (libonnxruntime.1.dylib …) resolve:
  // the folder that holds `lib/…` (or `bin/…`) becomes dir.
  const top = found.slice(0, found.length - asset.lib.length - 1);
  await mkdir(dirname(dir), { recursive: true });
  const { rename } = await import("node:fs/promises");
  await rename(top, dir);
  await rm(staging, { recursive: true, force: true });
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
  installed: string[];
  skipped: string[];
}

/**
 * Download, verify and unpack the pinned runtime for this platform, then warm
 * the model cache with one local OCR run. Idempotent; `force` reinstalls.
 */
export async function installOcrRuntime(options: { force?: boolean; onProgress?: (msg: string) => void } = {}): Promise<OcrInstallResult> {
  const key = ocrPlatformKey();
  const rt = OCR_RUNTIMES[key];
  if (!rt) throw new Error(`No local OCR runtime for ${key} (supported: ${Object.keys(OCR_RUNTIMES).join(", ")})`);
  const installed: string[] = [];
  const skipped: string[] = [];

  for (const [label, asset, dir] of [
    ["PDFium", rt.pdfium, pdfiumDir()],
    ["ONNX Runtime", rt.onnxruntime, ortDir()],
  ] as const) {
    if (!options.force && existsSync(join(dir, asset.lib))) {
      skipped.push(label);
      continue;
    }
    await installAsset(asset, dir, options.onProgress);
    installed.push(label);
  }

  // Models: let pdf-inspector fetch and checksum them into our cache, once.
  const status = { ...ocrRuntimeStatus(), ready: true };
  process.env.PDFIUM_LIB_PATH = status.pdfiumLib!;
  process.env.ORT_DYLIB_PATH = status.onnxruntimeLib!;
  process.env.PDF_INSPECTOR_MODEL_CACHE = status.modelCache;
  await mkdir(status.modelCache, { recursive: true });
  options.onProgress?.(`preparing the OCR models (${OCR_MODEL})`);
  const { processPdfWithOcr } = await import("@firecrawl/pdf-inspector");
  await processPdfWithOcr(warmupPdf(), { mode: "Force" as never });
  // A second, offline run proves the cache is complete before we call it ready.
  await processPdfWithOcr(warmupPdf(), { mode: "Force" as never, offline: true });
  installed.push("models");

  await writeFile(
    markerFile(),
    `${JSON.stringify({ platform: key, pdfium: PDFIUM_VERSION, onnxruntime: ONNXRUNTIME_VERSION, model: OCR_MODEL, installedAt: new Date().toISOString() }, null, 2)}\n`,
  );
  return { status: ocrRuntimeStatus(), installed, skipped };
}

/** Remove the runtime and models (extraction falls back to native text + image-only markers). */
export async function removeOcrRuntime(): Promise<void> {
  await rm(ocrRoot(), { recursive: true, force: true });
}

/** For `doctor`: the installed versions, if any. */
export async function ocrRuntimeInfo(): Promise<Record<string, string> | null> {
  try {
    return JSON.parse(await readFile(markerFile(), "utf-8")) as Record<string, string>;
  } catch {
    return null;
  }
}
