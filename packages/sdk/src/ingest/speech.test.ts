import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ImstudiumError } from "../errors.js";
import { ocrPlatformKey } from "./ocr-runtime.js";
import { sha256Hex } from "./ocr-runtime.js";
import { installPinnedAssets, type PinnedAsset } from "./pinned.js";
import {
  findFfmpeg,
  SPEECH_ENGINE,
  SPEECH_MODEL,
  SPEECH_PLATFORMS,
  speechAssets,
  speechDisabledByEnv,
  speechRuntimeStatus,
  speechThreads,
  transcribeMedia,
} from "./speech.js";

/** No model, no native code, no ffmpeg run: the pins, the status and the checks around the engine. */

describe("pins", () => {
  it("every speech piece is a revision-pinned model file, a release asset or an npm tarball, with a SHA-256 and a size", () => {
    for (const key of Object.keys(SPEECH_PLATFORMS)) {
      for (const a of speechAssets(key)) {
        expect(a.url).toMatch(
          /^https:\/\/(huggingface\.co\/csukuangfj\/sherpa-onnx-nemo-parakeet-tdt-0\.6b-v3-int8\/resolve\/ed5d745623472f97cfc2e6c2916ee248798fc5a8\/|github\.com\/k2-fsa\/sherpa-onnx\/releases\/download\/asr-models\/|registry\.npmjs\.org\/sherpa-onnx-[a-z0-9-]+\/-\/sherpa-onnx-[a-z0-9-]+-2\.0\.1\.tgz$)/,
        );
        expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(a.bytes).toBeGreaterThan(0);
      }
    }
    const linux = speechAssets("linux-x64");
    expect(linux.find((a) => a.name === "encoder.int8.onnx")).toMatchObject({ sha256: "1afbe69c1ffdabee94755f42e4daf1d93549131a3da11356bda84fcef0f2c479", bytes: 652_282_294 });
    expect(linux.find((a) => a.name === "silero_vad.onnx")!.sha256).toBe("9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6");
    expect(linux.find((a) => a.name === "sherpa-onnx-node")!.sha256).toBe("06ef8dfb9ea0f3cc77c1866620cbe05bf11b7dd70a973a454b77ce4a66cbcee1");
  });

  it("each platform gets the binding, its own native package and the same models", () => {
    expect(Object.keys(SPEECH_PLATFORMS).sort()).toEqual(["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "win32-x64"]);
    expect(speechAssets("win32-x64").map((a) => a.name)).toContain("sherpa-onnx-win-x64");
    expect(speechAssets("darwin-arm64").map((a) => a.name)).toEqual(["sherpa-onnx-node", "sherpa-onnx-darwin-arm64", "encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt", "silero_vad.onnx"]);
    // No native package for an unknown platform: the status says unsupported instead.
    expect(speechAssets("aix-ppc64").map((a) => a.name)).not.toContain("sherpa-onnx-aix-ppc64");
  });

  it("the model string is the batch runner's, so its transcript.json files are reused", () => {
    expect(SPEECH_MODEL).toBe("parakeet-tdt-0.6b-v3-int8 (csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8 ed5d745)");
    expect(SPEECH_ENGINE).toBe("sherpa-onnx-node 2.0.1");
  });
});

describe("ffmpeg and threads", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "imstudium-ffmpeg-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("finds an executable ffmpeg on PATH, and nothing on an empty PATH", async () => {
    expect(findFfmpeg({ PATH: "" }, "linux")).toBeNull();
    expect(findFfmpeg({}, "linux")).toBeNull();
    const bin = join(dir, "bin");
    await mkdir(bin);
    await writeFile(join(bin, "ffmpeg"), "#!/bin/sh\n");
    await chmod(join(bin, "ffmpeg"), 0o644);
    if (process.platform !== "win32") expect(findFfmpeg({ PATH: bin }, "linux")).toBeNull();
    await chmod(join(bin, "ffmpeg"), 0o755);
    expect(findFfmpeg({ PATH: `${join(dir, "missing")}:${bin}` }, "linux")).toBe(join(bin, "ffmpeg"));
  });

  it("on Windows looks for ffmpeg.exe along a ;-separated Path", async () => {
    await writeFile(join(dir, "ffmpeg.exe"), "MZ");
    expect(findFfmpeg({ Path: `C:\\nowhere;${dir}` }, "win32")).toBe(join(dir, "ffmpeg.exe"));
  });

  it("uses half the cores, at most 8, unless IMSTUDIUM_SPEECH_THREADS says otherwise", () => {
    expect(speechThreads({}, 32)).toBe(8);
    expect(speechThreads({}, 6)).toBe(3);
    expect(speechThreads({}, 1)).toBe(1);
    expect(speechThreads({ IMSTUDIUM_SPEECH_THREADS: "12" }, 4)).toBe(12);
    expect(speechThreads({ IMSTUDIUM_SPEECH_THREADS: "zero" }, 4)).toBe(2);
    expect(speechThreads({ IMSTUDIUM_SPEECH_THREADS: "0" }, 4)).toBe(2);
  });

  it("a recording without ffmpeg is refused with FFMPEG_MISSING before any model loads", async () => {
    const err = await transcribeMedia(join(dir, "Vorlesung.mp4"), { ffmpeg: null }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ImstudiumError);
    expect((err as ImstudiumError).code).toBe("FFMPEG_MISSING");
    expect((err as ImstudiumError).hint).toMatch(/Install ffmpeg/);
  });
});

describe("speechRuntimeStatus", () => {
  const saved: Record<string, string | undefined> = {};
  let root: string;
  beforeEach(async () => {
    for (const k of ["IMSTUDIUM_SPEECH_DIR", "IMSTUDIUM_SPEECH", "PATH"]) saved[k] = process.env[k];
    delete process.env.IMSTUDIUM_SPEECH;
    root = await mkdtemp(join(tmpdir(), "imstudium-speech-"));
    process.env.IMSTUDIUM_SPEECH_DIR = root;
  });
  afterEach(async () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await rm(root, { recursive: true, force: true });
  });

  async function fakeSpeech(model = SPEECH_MODEL): Promise<void> {
    for (const a of speechAssets()) {
      const p = a.kind === "npm" ? join(root, "node_modules", a.name, "package.json") : join(root, "models", a.name);
      await mkdir(join(p, ".."), { recursive: true });
      await writeFile(p, "{}");
    }
    await writeFile(join(root, "speech.json"), JSON.stringify({ model, engine: SPEECH_ENGINE }));
  }

  const supported = !!SPEECH_PLATFORMS[ocrPlatformKey()];

  it("is not installed in an empty folder and names the download", () => {
    const s = speechRuntimeStatus();
    expect(s).toMatchObject({ ready: false, dir: root, model: SPEECH_MODEL });
    expect(s.downloadBytes).toBe(speechAssets().reduce((n, a) => n + a.bytes, 0));
    if (supported) expect(s.reason).toBe("not installed");
  });

  it.skipIf(!supported)("is ready with every pinned file and a current marker; the reason then only names a missing ffmpeg", async () => {
    await fakeSpeech();
    const bin = join(root, "bin");
    await mkdir(bin);
    await writeFile(join(bin, "ffmpeg"), "#!/bin/sh\n", { mode: 0o755 });
    process.env.PATH = bin;
    expect(speechRuntimeStatus()).toMatchObject({ ready: true, disabled: false, ffmpeg: join(bin, "ffmpeg"), reason: null });
    process.env.PATH = "";
    expect(speechRuntimeStatus()).toMatchObject({ ready: true, ffmpeg: null, reason: "ffmpeg not found on PATH" });
  });

  it.skipIf(!supported)("an older model marker or a missing file is not ready", async () => {
    await fakeSpeech("parakeet-tdt-0.6b-v2 (older)");
    expect(speechRuntimeStatus()).toMatchObject({ ready: false, reason: "incomplete or for older pins" });
    await fakeSpeech();
    await rm(join(root, "models", "joiner.int8.onnx"));
    expect(speechRuntimeStatus()).toMatchObject({ ready: false, reason: "incomplete or for older pins" });
  });

  it.skipIf(!supported)("IMSTUDIUM_SPEECH=off switches it off", async () => {
    await fakeSpeech();
    process.env.IMSTUDIUM_SPEECH = "off";
    expect(speechRuntimeStatus()).toMatchObject({ ready: true, disabled: true, reason: "switched off (IMSTUDIUM_SPEECH=off)" });
    expect(speechDisabledByEnv({ IMSTUDIUM_SPEECH: "0" })).toBe(true);
    expect(speechDisabledByEnv({ IMSTUDIUM_SPEECH: "on" })).toBe(false);
  });
});

describe("installPinnedAssets (shared with the math runtime)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "imstudium-pinned-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const bytes = new TextEncoder().encode("synthetic model bytes");
  const asset: PinnedAsset = { label: "tiny model", kind: "file", name: "tiny.onnx", url: "https://example.test/tiny.onnx", sha256: sha256Hex(bytes), bytes: bytes.length };
  const serve = (body: Uint8Array) => (async () => new Response(body, { status: 200 })) as unknown as typeof fetch;

  it("puts a verified file in place once, then skips it", async () => {
    const first = await installPinnedAssets(dir, [asset], { platformKey: "linux-x64", errorCode: "SPEECH_INSTALL_FAILED", fetchImpl: serve(bytes) });
    expect(first).toMatchObject({ installed: ["tiny model"], skipped: [], downloadedBytes: bytes.length });
    const again = await installPinnedAssets(dir, [asset], { platformKey: "linux-x64", errorCode: "SPEECH_INSTALL_FAILED", fetchImpl: serve(bytes) });
    expect(again).toMatchObject({ installed: [], skipped: ["tiny model"], downloadedBytes: 0 });
  });

  it("refuses a download whose SHA-256 differs, with the runtime's own error code", async () => {
    const err = await installPinnedAssets(dir, [asset], { platformKey: "linux-x64", errorCode: "SPEECH_INSTALL_FAILED", fetchImpl: serve(new TextEncoder().encode("something else")) }).catch((e: unknown) => e);
    expect((err as ImstudiumError).code).toBe("SPEECH_INSTALL_FAILED");
    expect((err as ImstudiumError).message).toMatch(/Checksum mismatch for tiny\.onnx/);
  });
});
