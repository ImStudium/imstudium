import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  activateOcrRuntime,
  dirBytes,
  downloadToFile,
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

describe("downloadToFile", () => {
  const body = Buffer.from("0123456789".repeat(1000));
  const sum = sha256Hex(body);
  /**
   * A server for `body`: honours Range unless `ranges` is false; the first `breaks` responses
   * stop after `cut` bytes with the error undici gives when a connection closes ("terminated").
   */
  const server = (o: { ranges?: boolean; breaks?: number; cut?: number; bytes?: Buffer } = {}) => {
    const calls: Array<string | null> = [];
    let breaks = o.breaks ?? 0;
    const bytes = o.bytes ?? body;
    const fetchImpl = (async (_url: string, init?: { headers?: Record<string, string> }) => {
      const range = init?.headers?.Range ?? null;
      calls.push(range);
      const from = range && o.ranges !== false ? Number(/bytes=(\d+)-/.exec(range)![1]) : 0;
      if (from >= bytes.length) return new Response(null, { status: 416 });
      const rest = bytes.subarray(from);
      const broken = breaks-- > 0;
      // Chunks first, the error on a later pull: erroring a stream drops what it still queues.
      let sent = false;
      const stream = new ReadableStream({
        pull(c) {
          if (sent) return broken ? c.error(new TypeError("terminated")) : c.close();
          sent = true;
          c.enqueue(new Uint8Array(broken ? rest.subarray(0, o.cut ?? 3000) : rest));
        },
      });
      return new Response(stream, { status: from ? 206 : 200 });
    }) as unknown as typeof fetch;
    return { fetchImpl, calls };
  };

  it("resumes where a broken-off connection stopped, then verifies the whole file", async () => {
    const dest = join(root, "m", "model.onnx");
    const s = server({ breaks: 2, cut: 3000 });
    const notes: string[] = [];
    const fetched = await downloadToFile("https://example.invalid/model.onnx", sum, dest, { fetchImpl: s.fetchImpl, waitMs: 0, onProgress: (m) => notes.push(m) });
    expect(await readFile(dest)).toEqual(body);
    expect(s.calls).toEqual([null, "bytes=3000-", "bytes=6000-"]);
    expect(fetched).toBe(body.length);
    expect(notes.some((n) => /broke off at .*terminated.*retrying/.test(n))).toBe(true);
  });

  it("a later run resumes the partial file a failed run left", async () => {
    const dest = join(root, "model.onnx");
    const err = await downloadToFile("https://example.invalid/model.onnx", sum, dest, { fetchImpl: server({ breaks: 9, cut: 4000 }).fetchImpl, retries: 0, waitMs: 0 }).catch((e) => e);
    expect(err).toMatchObject({ code: "OCR_INSTALL_FAILED", hint: expect.stringMatching(/resumes/) });
    expect((await readFile(`${dest}.part`)).length).toBe(4000);
    const s = server();
    expect(await downloadToFile("https://example.invalid/model.onnx", sum, dest, { fetchImpl: s.fetchImpl, waitMs: 0 })).toBe(body.length - 4000);
    expect(s.calls).toEqual(["bytes=4000-"]);
    expect(await readFile(dest)).toEqual(body);
  });

  it("starts over when the server ignores Range, and once more when a resumed file doesn't match its pin", async () => {
    const dest = join(root, "model.onnx");
    await writeFile(`${dest}.part`, body.subarray(0, 500));
    await downloadToFile("https://example.invalid/model.onnx", sum, dest, { fetchImpl: server({ ranges: false }).fetchImpl, waitMs: 0 });
    expect(await readFile(dest)).toEqual(body);
    // A partial file of an older pin under the same name.
    await writeFile(`${dest}.part`, Buffer.from("x".repeat(500)));
    const s = server();
    await downloadToFile("https://example.invalid/model.onnx", sum, join(root, "model.onnx"), { fetchImpl: s.fetchImpl, waitMs: 0 });
    expect(s.calls).toEqual(["bytes=500-", null]);
    expect(await readFile(dest)).toEqual(body);
  });

  it("refuses a file that doesn't match and leaves nothing behind; client errors are not retried", async () => {
    const dest = join(root, "model.onnx");
    const err = await downloadToFile("https://example.invalid/model.onnx", "0".repeat(64), dest, { fetchImpl: server().fetchImpl, waitMs: 0 }).catch((e) => e);
    expect(err).toMatchObject({ code: "OCR_INSTALL_FAILED", details: { expected: "0".repeat(64), got: sum } });
    expect(existsSync(dest) || existsSync(`${dest}.part`)).toBe(false);
    let calls = 0;
    const missing = (async () => (calls++, new Response("no", { status: 404 }))) as unknown as typeof fetch;
    await expect(downloadToFile("https://example.invalid/model.onnx", sum, dest, { fetchImpl: missing, waitMs: 0 })).rejects.toMatchObject({ status: 404 });
    expect(calls).toBe(1);
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
