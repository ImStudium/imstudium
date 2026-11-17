/**
 * On-device transcripts for lecture recordings: audio and video become text
 * with timestamps, on the student's machine.
 *
 *   ffmpeg (on PATH)             decodes any recording to 16 kHz mono samples
 *   Silero VAD                   cuts them into stretches of speech (at most 20 s each)
 *   Parakeet TDT 0.6B v3 (int8)  reads each stretch (25 European languages, German and English among them)
 *   sherpa-onnx-node 2.0.1       runs both on its own ONNX Runtime, in this process
 *
 * Everything but ffmpeg is a pinned, SHA-256-verified download that `imstudium
 * setup speech` puts under <dataDir>/speech (or IMSTUDIUM_SPEECH_DIR); nothing
 * here is an npm dependency, and no sample leaves the machine. The addon finds
 * its own libraries: sherpa-onnx.node carries RUNPATH $ORIGIN on Linux and
 * @loader_path on macOS, and Node loads a Windows addon with its folder on the
 * search path, so no LD_LIBRARY_PATH or DYLD_LIBRARY_PATH is set.
 *
 * The settings and the model string match the batch runner that transcribed
 * the first lectures. Its transcript.json files, and those of any other runner
 * with the same schema, are read rather than redone (transcript.ts).
 */
import { accessSync, constants as fsConstants, existsSync, readFileSync, statSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { availableParallelism } from "node:os";
import { basename, delimiter, join } from "node:path";
import { paths } from "../config.js";
import { ImstudiumError } from "../errors.js";
import { dirBytes, ocrPlatformKey } from "./ocr-runtime.js";
import { installPinnedAssets, pinnedAssetsPresent, pinnedModelsDir, pinnedModulesDir, type PinnedAsset } from "./pinned.js";
import type { TranscriptSegment } from "./transcript.js";

/** The model string a transcript made here carries (the batch runner's too). */
export const SPEECH_MODEL = "parakeet-tdt-0.6b-v3-int8 (csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8 ed5d745)";
export const SPEECH_VAD = "silero-vad (k2-fsa/sherpa-onnx asr-models)";
export const SHERPA_ONNX_VERSION = "2.0.1";
export const SPEECH_ENGINE = `sherpa-onnx-node ${SHERPA_ONNX_VERSION}`;

const NPM = "https://registry.npmjs.org";
const PARAKEET = "https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/resolve/ed5d745623472f97cfc2e6c2916ee248798fc5a8";

/** sherpa-onnx's native package for each platform (Node's `<platform>-<arch>`), 2.0.1 on npm. */
export const SPEECH_PLATFORMS: Record<string, { name: string; sha256: string; bytes: number }> = {
  "linux-x64": { name: "sherpa-onnx-linux-x64", sha256: "08c6fe2b65838febbd0c260aaa9991990d2d592e503e758bfd2f5db6cbc79338", bytes: 11_005_484 },
  "linux-arm64": { name: "sherpa-onnx-linux-arm64", sha256: "b8f18ee34c8e14bbafb7f51332361a6ab91f4ddbb4a4eac58f74ec0dafb39e87", bytes: 13_822_449 },
  "darwin-arm64": { name: "sherpa-onnx-darwin-arm64", sha256: "afc9415260e232c4dadc25a29a8645acb0ba06ef989060d32274f4c749a4830e", bytes: 10_013_200 },
  "darwin-x64": { name: "sherpa-onnx-darwin-x64", sha256: "e95e4addd3d02919ae61f311effd6e5349e00b50985c4a8c9a3bcb03dc6d6325", bytes: 11_167_483 },
  "win32-x64": { name: "sherpa-onnx-win-x64", sha256: "217cec234c6026dbfd2b9c06523507180796fe4227c7cc9d11cfe218260a2519", bytes: 8_779_375 },
};

const ENCODER_FILE = "encoder.int8.onnx";
const DECODER_FILE = "decoder.int8.onnx";
const JOINER_FILE = "joiner.int8.onnx";
const TOKENS_FILE = "tokens.txt";
const VAD_FILE = "silero_vad.onnx";

/** Every piece `setup speech` installs on this platform: the binding, its native package, the model and the VAD. */
export function speechAssets(platformKey: string = ocrPlatformKey()): PinnedAsset[] {
  const native = SPEECH_PLATFORMS[platformKey];
  return [
    {
      label: "sherpa-onnx binding",
      kind: "npm",
      name: "sherpa-onnx-node",
      url: `${NPM}/sherpa-onnx-node/-/sherpa-onnx-node-${SHERPA_ONNX_VERSION}.tgz`,
      sha256: "06ef8dfb9ea0f3cc77c1866620cbe05bf11b7dd70a973a454b77ce4a66cbcee1",
      bytes: 12_709,
    },
    ...(native
      ? [{ label: "sherpa-onnx native library", kind: "npm" as const, name: native.name, url: `${NPM}/${native.name}/-/${native.name}-${SHERPA_ONNX_VERSION}.tgz`, sha256: native.sha256, bytes: native.bytes }]
      : []),
    { label: "speech encoder", kind: "file", name: ENCODER_FILE, url: `${PARAKEET}/${ENCODER_FILE}`, sha256: "1afbe69c1ffdabee94755f42e4daf1d93549131a3da11356bda84fcef0f2c479", bytes: 652_282_294 },
    { label: "speech decoder", kind: "file", name: DECODER_FILE, url: `${PARAKEET}/${DECODER_FILE}`, sha256: "0222a86147299d4dee90edf95b6d13827edb42ad8b7c9cf0b2582f030937c0b5", bytes: 11_845_274 },
    { label: "speech joiner", kind: "file", name: JOINER_FILE, url: `${PARAKEET}/${JOINER_FILE}`, sha256: "cbd02f3696e9944970111fb439d9c3fd365a80374565f13f2b9c7007d253fc98", bytes: 6_355_277 },
    { label: "speech tokens", kind: "file", name: TOKENS_FILE, url: `${PARAKEET}/${TOKENS_FILE}`, sha256: "d58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d", bytes: 93_939 },
    {
      label: "voice activity model",
      kind: "file",
      name: VAD_FILE,
      url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx",
      sha256: "9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6",
      bytes: 643_854,
    },
  ];
}

/** <dataDir>/speech, or IMSTUDIUM_SPEECH_DIR (read on every call). */
export function speechDir(): string {
  return process.env.IMSTUDIUM_SPEECH_DIR || join(paths.dataDir, "speech");
}
const modulesDir = () => pinnedModulesDir(speechDir());
const modelsDir = () => pinnedModelsDir(speechDir());
const speechMarker = () => join(speechDir(), "speech.json");

export function speechDisabledByEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return /^(0|off|false|no)$/i.test((env.IMSTUDIUM_SPEECH ?? "").trim());
}

/** Threads for the recognizer: IMSTUDIUM_SPEECH_THREADS, else half the cores, at most 8. */
export function speechThreads(env: NodeJS.ProcessEnv = process.env, cores: number = availableParallelism()): number {
  const asked = Number.parseInt((env.IMSTUDIUM_SPEECH_THREADS ?? "").trim(), 10);
  if (Number.isInteger(asked) && asked >= 1) return Math.min(asked, 256);
  return Math.max(1, Math.min(8, Math.floor(cores / 2)));
}

/** ffmpeg on PATH (ffmpeg.exe on Windows), or null. No process is started. */
export function findFfmpeg(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string | null {
  const dirs = (env.PATH ?? env.Path ?? "").split(platform === "win32" ? ";" : delimiter).filter(Boolean);
  const name = platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  for (const dir of dirs) {
    const candidate = join(dir, name);
    try {
      if (!statSync(candidate).isFile()) continue;
      if (platform !== "win32") accessSync(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // not here
    }
  }
  return null;
}

/** How to get ffmpeg, for hints and doctor. */
export const FFMPEG_HINT = "Install ffmpeg (macOS: brew install ffmpeg · Debian/Ubuntu: sudo apt install ffmpeg · Windows: winget install ffmpeg), then run the extraction again";

export interface SpeechRuntimeStatus {
  /** This platform has a pinned sherpa-onnx build (macOS arm64/x64, Linux x64/arm64, Windows x64). */
  supported: boolean;
  /** The pinned runtime is installed (`setup speech`); transcribing also needs ffmpeg. */
  ready: boolean;
  /** IMSTUDIUM_SPEECH=off. */
  disabled: boolean;
  platform: string;
  dir: string;
  model: string;
  vad: string;
  engine: string;
  /** Total download for `setup speech` on this platform. */
  downloadBytes: number;
  /** ffmpeg on PATH, which decodes the recordings; null when it is missing. */
  ffmpeg: string | null;
  /** Recognizer threads (IMSTUDIUM_SPEECH_THREADS, else half the cores, at most 8). */
  threads: number;
  /** Why recordings will not be transcribed, when they won't. */
  reason: string | null;
}

function readSpeechMarker(): { model?: string; engine?: string; sha256?: Record<string, string> } | null {
  try {
    return JSON.parse(readFileSync(speechMarker(), "utf-8")) as { model?: string; engine?: string; sha256?: Record<string, string> };
  } catch {
    return null;
  }
}

const underBun = () => typeof (process.versions as Record<string, string | undefined>).bun === "string";

/** Whether recordings can be transcribed here: no network, no native loading, no process started. */
export function speechRuntimeStatus(): SpeechRuntimeStatus {
  const key = ocrPlatformKey();
  const supported = !!SPEECH_PLATFORMS[key];
  const assets = speechAssets(key);
  const marker = readSpeechMarker();
  const complete = supported && pinnedAssetsPresent(speechDir(), assets);
  const current = marker?.model === SPEECH_MODEL && marker?.engine === SPEECH_ENGINE;
  const disabled = speechDisabledByEnv();
  const bun = underBun();
  const ffmpeg = findFfmpeg();
  const ready = supported && complete && current && !bun;
  const reason = !supported
    ? `no pinned speech runtime for ${key}`
    : !marker && !complete
      ? "not installed"
      : !current || !complete
        ? "incomplete or for older pins"
        : bun
          ? "runs under Node only"
          : disabled
            ? "switched off (IMSTUDIUM_SPEECH=off)"
            : !ffmpeg
              ? "ffmpeg not found on PATH"
              : null;
  return {
    supported,
    ready,
    disabled,
    platform: key,
    dir: speechDir(),
    model: SPEECH_MODEL,
    vad: SPEECH_VAD,
    engine: SPEECH_ENGINE,
    downloadBytes: assets.reduce((n, a) => n + a.bytes, 0),
    ffmpeg,
    threads: speechThreads(),
    reason,
  };
}

export interface SpeechInstallResult {
  status: SpeechRuntimeStatus;
  installed: string[];
  skipped: string[];
  downloadedBytes: number;
  diskBytes: number;
  durationMs: number;
}

/**
 * Download, verify and unpack the speech pieces for this platform, then prove
 * the recognizer and the VAD load and read a second of synthetic audio.
 * Idempotent and incremental like the math runtime; `force` refetches all.
 */
export async function installSpeechRuntime(options: { force?: boolean; onProgress?: (msg: string) => void; fetchImpl?: typeof fetch } = {}): Promise<SpeechInstallResult> {
  const started = Date.now();
  const key = ocrPlatformKey();
  if (!SPEECH_PLATFORMS[key]) {
    throw new ImstudiumError(`No on-device speech runtime for ${key}`, "SPEECH_UNSUPPORTED", undefined, undefined, { platform: key, supported: Object.keys(SPEECH_PLATFORMS) });
  }
  if (underBun()) {
    throw new ImstudiumError("On-device transcripts run under Node", "SPEECH_UNSUPPORTED", undefined, "Run imstudium with Node (npm i -g @imstudium/sdk), not Bun", { platform: key, runtime: "bun" });
  }
  const { installed, skipped, downloadedBytes } = await installPinnedAssets(speechDir(), speechAssets(key), {
    platformKey: key,
    errorCode: "SPEECH_INSTALL_FAILED",
    force: options.force,
    onProgress: options.onProgress,
    fetchImpl: options.fetchImpl,
    legacy: readSpeechMarker()?.sha256,
  });
  options.onProgress?.("checking that the recognizer starts on this machine");
  resetSpeechEngine();
  try {
    await probeSpeechRuntime();
  } catch (err) {
    throw new ImstudiumError(`The speech runtime did not start: ${err instanceof Error ? err.message : String(err)}`, "SPEECH_INSTALL_FAILED", undefined, "Run: imstudium setup speech --force");
  } finally {
    resetSpeechEngine();
  }
  await writeFile(
    speechMarker(),
    `${JSON.stringify({ model: SPEECH_MODEL, vad: SPEECH_VAD, engine: SPEECH_ENGINE, platform: key, installedAt: new Date().toISOString(), sha256: Object.fromEntries(speechAssets(key).map((a) => [a.name, a.sha256])) }, null, 2)}\n`,
  );
  return { status: speechRuntimeStatus(), installed, skipped, downloadedBytes, diskBytes: await dirBytes(speechDir()), durationMs: Date.now() - started };
}

/** Delete the speech runtime and its models. Returns the bytes freed. */
export async function removeSpeechRuntime(): Promise<{ removed: boolean; freedBytes: number; dir: string }> {
  const dir = speechDir();
  resetSpeechEngine();
  if (!existsSync(dir)) return { removed: false, freedBytes: 0, dir };
  const freedBytes = await dirBytes(dir);
  await rm(dir, { recursive: true, force: true });
  return { removed: true, freedBytes, dir };
}

// ── Engine ───────────────────────────────────────────────────────────────────

const SAMPLE_RATE = 16_000;
const VAD_WINDOW = 512;

interface SherpaStream {
  acceptWaveform(wave: { samples: Float32Array; sampleRate: number }): void;
}
interface SherpaRecognizer {
  createStream(): SherpaStream;
  decodeAsync(stream: SherpaStream): Promise<{ text: string }>;
}
interface SherpaVad {
  acceptWaveform(samples: Float32Array): void;
  isEmpty(): boolean;
  front(): { start: number; samples: Float32Array };
  pop(): void;
  flush(): void;
}
interface Sherpa {
  OfflineRecognizer: { createAsync(config: unknown): Promise<SherpaRecognizer> };
  Vad: new (config: unknown, bufferSizeInSeconds: number) => SherpaVad;
}

interface Engine {
  sherpa: Sherpa;
  recognizer: SherpaRecognizer;
  threads: number;
}

let engine: Promise<Engine> | null = null;

/** Drop the loaded recognizer (about 1 GB in memory); the next transcription loads it again. */
export function resetSpeechEngine(): void {
  engine = null;
}

function vadConfig() {
  return {
    sileroVad: { model: join(modelsDir(), VAD_FILE), threshold: 0.5, minSpeechDuration: 0.25, minSilenceDuration: 0.4, maxSpeechDuration: 20, windowSize: VAD_WINDOW },
    sampleRate: SAMPLE_RATE,
    debug: false,
    numThreads: 1,
  };
}

async function loadEngine(threads: number): Promise<Engine> {
  const req = createRequire(join(modulesDir(), "loader.cjs"));
  const sherpa = req("sherpa-onnx-node") as Sherpa;
  const m = modelsDir();
  const recognizer = await sherpa.OfflineRecognizer.createAsync({
    featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
    modelConfig: {
      transducer: { encoder: join(m, ENCODER_FILE), decoder: join(m, DECODER_FILE), joiner: join(m, JOINER_FILE) },
      tokens: join(m, TOKENS_FILE),
      numThreads: threads,
      provider: "cpu",
      debug: 0,
      modelType: "nemo_transducer",
    },
    decodingMethod: "greedy_search",
  });
  return { sherpa, recognizer, threads };
}

async function getEngine(threads: number): Promise<Engine> {
  if (engine) {
    const loaded = await engine.catch(() => null);
    if (loaded?.threads === threads) return loaded;
  }
  const loading = loadEngine(threads);
  engine = loading;
  loading.catch(() => {
    if (engine === loading) engine = null;
  });
  return loading;
}

/** One second of quiet noise through the VAD and the recognizer: both models load and run. */
async function probeSpeechRuntime(): Promise<void> {
  const { sherpa, recognizer } = await getEngine(1);
  const vad = new sherpa.Vad(vadConfig(), 60);
  const samples = new Float32Array(SAMPLE_RATE);
  for (let i = 0; i < samples.length; i++) samples[i] = 0.001 * Math.sin((2 * Math.PI * 220 * i) / SAMPLE_RATE);
  for (let i = 0; i + VAD_WINDOW <= samples.length; i += VAD_WINDOW) vad.acceptWaveform(samples.subarray(i, i + VAD_WINDOW));
  vad.flush();
  const stream = recognizer.createStream();
  stream.acceptWaveform({ samples, sampleRate: SAMPLE_RATE });
  const result = await recognizer.decodeAsync(stream);
  if (typeof result?.text !== "string") throw new Error("the recognizer returned no result");
}

export interface MediaTranscription {
  /** Seconds of audio decoded. */
  duration: number;
  segments: TranscriptSegment[];
  /** Wall time of the transcription. */
  ms: number;
}

/**
 * Transcribe one recording: ffmpeg decodes it to 16 kHz mono, the VAD cuts
 * speech segments, Parakeet reads each one. Segments are rounded to 1/100 s
 * and empty readings dropped, as in the batch runner. Throws FFMPEG_MISSING
 * when ffmpeg isn't on PATH.
 */
export async function transcribeMedia(
  src: string,
  options: { threads?: number; ffmpeg?: string | null; onProgress?: (msg: string) => void } = {},
): Promise<MediaTranscription> {
  const started = Date.now();
  const ffmpeg = options.ffmpeg === undefined ? findFfmpeg() : options.ffmpeg;
  if (!ffmpeg) throw new ImstudiumError("ffmpeg not found on PATH: it decodes audio and video for the transcript", "FFMPEG_MISSING", undefined, FFMPEG_HINT);
  const { sherpa, recognizer } = await getEngine(options.threads ?? speechThreads());
  const vad = new sherpa.Vad(vadConfig(), 60);
  const segments: TranscriptSegment[] = [];
  const name = basename(src);

  const { spawn } = await import("node:child_process");
  const ff = spawn(ffmpeg, ["-nostdin", "-v", "error", "-i", src, "-vn", "-ac", "1", "-ar", String(SAMPLE_RATE), "-f", "f32le", "pipe:1"], { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  ff.stderr.on("data", (d: Buffer) => {
    if (stderr.length < 4000) stderr += d.toString();
  });
  const exited = new Promise<number | null>((resolve, reject) => {
    ff.on("error", reject);
    ff.on("close", (code) => resolve(code));
  });
  // Awaited after the samples are read; until then a spawn error must not count as unhandled.
  exited.catch(() => {});

  const drain = async () => {
    while (!vad.isEmpty()) {
      const seg = vad.front();
      vad.pop();
      const stream = recognizer.createStream();
      stream.acceptWaveform({ samples: seg.samples, sampleRate: SAMPLE_RATE });
      const text = (await recognizer.decodeAsync(stream)).text.trim();
      if (text) segments.push({ start: +(seg.start / SAMPLE_RATE).toFixed(2), end: +((seg.start + seg.samples.length) / SAMPLE_RATE).toFixed(2), text });
    }
  };

  let pending = new Float32Array(0);
  let leftover = Buffer.alloc(0);
  let samples = 0;
  let reported = 0;
  try {
    for await (const chunk of ff.stdout as AsyncIterable<Buffer>) {
      const buf = leftover.length ? Buffer.concat([leftover, chunk]) : chunk;
      const n = Math.floor(buf.length / 4) * 4;
      leftover = Buffer.from(buf.subarray(n));
      const f = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + n));
      samples += f.length;
      const all = new Float32Array(pending.length + f.length);
      all.set(pending);
      all.set(f, pending.length);
      let i = 0;
      for (; i + VAD_WINDOW <= all.length; i += VAD_WINDOW) vad.acceptWaveform(all.subarray(i, i + VAD_WINDOW));
      pending = all.slice(i);
      await drain();
      const minutes = Math.floor(samples / SAMPLE_RATE / 600) * 10;
      if (minutes > reported) {
        reported = minutes;
        options.onProgress?.(`${name}: ${minutes} min transcribed`);
      }
    }
    const code = await exited;
    if (code !== 0) throw new Error(`ffmpeg exit ${code}: ${stderr.trim().slice(0, 300)}`);
  } catch (err) {
    ff.kill();
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      throw new ImstudiumError(`ffmpeg could not be started (${ffmpeg})`, "FFMPEG_MISSING", undefined, FFMPEG_HINT);
    }
    throw err;
  }
  vad.flush();
  await drain();
  return { duration: +(samples / SAMPLE_RATE).toFixed(2), segments, ms: Date.now() - started };
}
