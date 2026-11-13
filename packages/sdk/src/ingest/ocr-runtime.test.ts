import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  activateOcrRuntime,
  dirBytes,
  downloadVerified,
  ocrDisabledByEnv,
  OCR_MODEL,
  OCR_RUNTIMES,
  ocrPlatformKey,
  ocrRuntimeStatus,
  ONNXRUNTIME_VERSION,
  PDFIUM_VERSION,
  removeOcrRuntime,
  sha256Hex,
} from "./ocr-runtime.js";

/** No network and no native code: a temp IMSTUDIUM_OCR_DIR with stand-in files. */

const ENV_KEYS = ["IMSTUDIUM_OCR_DIR", "IMSTUDIUM_OCR", "PDFIUM_LIB_PATH", "ORT_DYLIB_PATH", "PDF_INSPECTOR_MODEL_CACHE"] as const;
const saved: Record<string, string | undefined> = {};
let root: string;

beforeEach(async () => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
  root = await mkdtemp(join(tmpdir(), "imstudium-ocr-"));
  process.env.IMSTUDIUM_OCR_DIR = root;
});

afterEach(async () => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  await rm(root, { recursive: true, force: true });
});

const supported = !!OCR_RUNTIMES[ocrPlatformKey()];

/** Lay out what `setup ocr` leaves behind, with fake libraries. */
async function fakeInstall(marker: Partial<{ pdfium: string; onnxruntime: string; model: string }> = {}): Promise<void> {
  const rt = OCR_RUNTIMES[ocrPlatformKey()]!;
  const pdfium = join(root, "pdfium", PDFIUM_VERSION, rt.pdfium.lib);
  const ort = join(root, "onnxruntime", ONNXRUNTIME_VERSION, rt.onnxruntime.lib);
  for (const f of [pdfium, ort]) {
    await mkdir(dirname(f), { recursive: true });
    await writeFile(f, "not a real library");
  }
  await mkdir(join(root, "models", "pp-ocrv6-small"), { recursive: true });
  await writeFile(join(root, "models", "pp-ocrv6-small", "det.onnx"), Buffer.alloc(1000));
  await writeFile(
    join(root, "runtime.json"),
    JSON.stringify({ platform: ocrPlatformKey(), pdfium: PDFIUM_VERSION, onnxruntime: ONNXRUNTIME_VERSION, model: OCR_MODEL, installedAt: "2026-11-13T10:00:00.000Z", ...marker }),
  );
}

describe("pins", () => {
  it("every platform pins a GitHub release asset with a SHA-256", () => {
    for (const [key, rt] of Object.entries(OCR_RUNTIMES)) {
      for (const asset of [rt.pdfium, rt.onnxruntime]) {
        expect(asset.url, key).toMatch(/^https:\/\/github\.com\/(firecrawl\/pdfium-rs|microsoft\/onnxruntime)\/releases\/download\//);
        expect(asset.sha256, key).toMatch(/^[0-9a-f]{64}$/);
      }
      expect(rt.onnxruntime.url).toContain(ONNXRUNTIME_VERSION);
      expect(rt.pdfium.url).toContain(PDFIUM_VERSION);
    }
    expect(Object.keys(OCR_RUNTIMES).sort()).toEqual(["darwin-arm64", "linux-arm64", "linux-x64", "win32-x64"]);
  });
});

describe("ocrRuntimeStatus", () => {
  it("lives under IMSTUDIUM_OCR_DIR and is not ready before an install", () => {
    const s = ocrRuntimeStatus();
    expect(s.dir).toBe(root);
    expect(s.modelCache).toBe(join(root, "models"));
    expect(s.ready).toBe(false);
    expect(s.installed).toBeNull();
    expect(s.reason).toBe(supported ? "not installed" : `no pinned OCR runtime for ${ocrPlatformKey()}`);
    expect(activateOcrRuntime(s)).toBe(false);
    expect(process.env.PDFIUM_LIB_PATH).toBeUndefined();
  });

  it.skipIf(!supported)("is ready once libraries and runtime.json for the pinned versions are there", async () => {
    await fakeInstall();
    const s = ocrRuntimeStatus();
    expect(s.ready).toBe(true);
    expect(s.reason).toBeNull();
    expect(s.installed).toMatchObject({ pdfium: PDFIUM_VERSION, onnxruntime: ONNXRUNTIME_VERSION, model: OCR_MODEL });
    expect(s.pdfiumLib!.startsWith(join(root, "pdfium", PDFIUM_VERSION))).toBe(true);
  });

  it.skipIf(!supported)("activation points pdf-inspector at our libraries and model cache", async () => {
    await fakeInstall();
    expect(activateOcrRuntime()).toBe(true);
    const s = ocrRuntimeStatus();
    expect(process.env.PDFIUM_LIB_PATH).toBe(s.pdfiumLib);
    expect(process.env.ORT_DYLIB_PATH).toBe(s.onnxruntimeLib);
    expect(process.env.PDF_INSPECTOR_MODEL_CACHE).toBe(join(root, "models"));
  });

  it.skipIf(!supported)("an install for older pins is not ready and says so", async () => {
    await fakeInstall({ onnxruntime: "1.20.0" });
    const s = ocrRuntimeStatus();
    expect(s.ready).toBe(false);
    expect(s.reason).toMatch(/older pins/);
    expect(activateOcrRuntime(s)).toBe(false);
  });

  it.skipIf(!supported)("a marker without libraries is not ready", async () => {
    await fakeInstall();
    await rm(join(root, "pdfium"), { recursive: true });
    const s = ocrRuntimeStatus();
    expect(s.ready).toBe(false);
    expect(s.reason).toBe("libraries missing");
  });

  it.skipIf(!supported)("IMSTUDIUM_OCR=off keeps an installed runtime idle", async () => {
    await fakeInstall();
    process.env.IMSTUDIUM_OCR = "off";
    const s = ocrRuntimeStatus();
    expect(s.disabled).toBe(true);
    expect(s.reason).toMatch(/IMSTUDIUM_OCR=off/);
    expect(activateOcrRuntime(s)).toBe(false);
    expect(process.env.PDFIUM_LIB_PATH).toBeUndefined();
  });
});

describe("ocrDisabledByEnv", () => {
  it.each([
    ["off", true],
    ["OFF", true],
    ["0", true],
    ["false", true],
    ["no", true],
    [" off ", true],
    ["", false],
    ["on", false],
    ["1", false],
  ])("IMSTUDIUM_OCR=%j → %s", (value, disabled) => {
    expect(ocrDisabledByEnv({ IMSTUDIUM_OCR: value })).toBe(disabled);
  });
});

describe("downloadVerified", () => {
  const body = Buffer.from("pinned archive bytes");
  const fakeFetch = (status: number, bytes = body) => (async () => new Response(bytes, { status })) as unknown as typeof fetch;

  it("returns the bytes when the SHA-256 matches", async () => {
    const got = await downloadVerified("https://example.invalid/a.tgz", sha256Hex(body), fakeFetch(200));
    expect(got.equals(body)).toBe(true);
  });

  it("refuses a file whose SHA-256 differs (OCR_INSTALL_FAILED, both sums in details)", async () => {
    const err = await downloadVerified("https://example.invalid/a.tgz", "0".repeat(64), fakeFetch(200)).catch((e) => e);
    expect(err.code).toBe("OCR_INSTALL_FAILED");
    expect(err.message).toMatch(/Checksum mismatch for a\.tgz/);
    expect(err.details).toMatchObject({ expected: "0".repeat(64), got: sha256Hex(body) });
  });

  it("reports HTTP errors and network failures with the same code", async () => {
    await expect(downloadVerified("https://example.invalid/a.tgz", sha256Hex(body), fakeFetch(404))).rejects.toMatchObject({ code: "OCR_INSTALL_FAILED", status: 404 });
    const offline = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(downloadVerified("https://example.invalid/a.tgz", sha256Hex(body), offline)).rejects.toMatchObject({ code: "OCR_INSTALL_FAILED" });
  });
});

describe("removeOcrRuntime", () => {
  it.skipIf(!supported)("deletes the runtime and reports the bytes freed", async () => {
    await fakeInstall();
    const size = await dirBytes(root);
    expect(size).toBeGreaterThan(1000);
    const r = await removeOcrRuntime();
    expect(r).toEqual({ removed: true, freedBytes: size, dir: root });
    expect(existsSync(root)).toBe(false);
    expect(ocrRuntimeStatus().reason).toBe("not installed");
  });

  it("is a no-op when nothing is installed", async () => {
    await rm(root, { recursive: true, force: true });
    expect(await removeOcrRuntime()).toEqual({ removed: false, freedBytes: 0, dir: root });
  });
});
