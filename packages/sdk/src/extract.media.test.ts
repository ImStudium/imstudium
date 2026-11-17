import { mkdir, mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaTranscription, SpeechRuntimeStatus } from "./ingest/speech.js";

/**
 * Recordings in the extractor, with the speech engine mocked: no model, no
 * ffmpeg. The recording is a few synthetic bytes; transcripts are made up.
 */

const speech = vi.hoisted(() => ({ ready: false, disabled: false, ffmpeg: "/usr/bin/ffmpeg" as string | null }));
const transcribe = vi.hoisted(() => vi.fn<(src: string, opts?: unknown) => Promise<MediaTranscription>>());

vi.mock("./ingest/speech.js", async (orig) => ({
  ...(await orig<typeof import("./ingest/speech.js")>()),
  speechRuntimeStatus: (): Partial<SpeechRuntimeStatus> => ({ ...speech, supported: true, threads: 4, reason: speech.ready ? null : "not installed" }),
  transcribeMedia: transcribe,
}));

const { Extractor, detectKind, summarizeMedia } = await import("./extract.js");
const { SPEECH_MODEL, SPEECH_VAD, SPEECH_ENGINE } = await import("./ingest/speech.js");
const { parseExtractionChunks } = await import("./search-corpus.js");

let dir: string;
let src: string;
let out: string;

const segments = [
  { start: 0.8, end: 6.2, text: "Guten Morgen, heute geht es um Entscheidungsbäume." },
  { start: 125.3, end: 131, text: "Ein Blatt steht für eine Klasse." },
];

async function runnerTranscript(over: Record<string, unknown> = {}): Promise<void> {
  const st = await stat(src);
  const doc = { schemaVersion: "1", model: SPEECH_MODEL, vad: SPEECH_VAD, engine: SPEECH_ENGINE, onDevice: true, source: { file: "Vorlesung-02.mp4", size: st.size, mtimeMs: st.mtimeMs }, duration: 140.25, transcribedAt: "2026-11-17T14:21:25.100Z", segments, ...over };
  await mkdir(out, { recursive: true });
  await writeFile(join(out, "transcript.json"), `${JSON.stringify(doc)}\n`);
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "imstudium-media-"));
  src = join(dir, "Vorlesung-02.mp4");
  out = join(dir, "extracted", "Vorlesung-02-mp4");
  await writeFile(src, "synthetic stand-in for a lecture video");
  speech.ready = false;
  speech.disabled = false;
  speech.ffmpeg = "/usr/bin/ffmpeg";
  transcribe.mockReset();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const read = (name: string) => readFile(join(out, name), "utf-8");

describe("detectKind", () => {
  it("audio and video are media, whatever the case of the extension", () => {
    for (const f of ["a.mp4", "a.MKV", "a.webm", "a.mov", "a.m4v", "a.mp3", "a.m4a", "a.wav", "a.ogg", "a.oga", "a.opus", "a.flac", "a.aac"]) expect(detectKind(f), f).toBe("media");
    expect(detectKind("a.avi")).toBe("unsupported");
    expect(detectKind("a.pdf")).toBe("pdf");
  });
});

describe("Extractor: recordings", () => {
  it("renders a matching transcript.json without transcribing, and indexes its sections with their start times", async () => {
    await runnerTranscript();
    speech.ready = true;
    const ex = new Extractor({ anydoc: true, pdfInspector: true });
    const r = await ex.extractFile(src, out);
    expect(transcribe).not.toHaveBeenCalled();
    expect(r).toMatchObject({ kind: "media", pages: 2, tool: "transcript.json", transcript: { model: SPEECH_MODEL, onDevice: true, duration: 140.25, segments: 2, sections: 2, cached: true } });
    const md = await read("content.md");
    expect(md).toContain("> video · 2 min · 2 section(s) · on-device transcript by parakeet-tdt-0.6b-v3-int8");
    expect(md).toContain("## 00:00:00\n\nGuten Morgen, heute geht es um Entscheidungsbäume.");
    expect(md).toContain("## 00:02:05\n\nEin Blatt steht für eine Klasse.");
    expect(JSON.parse(await read("manifest.json"))).toMatchObject({ kind: "media", pages: 2, transcript: { cached: true, sections: 2 } });

    const chunks = await parseExtractionChunks(out, { workspaceRoot: dir, courseTitle: "Data Mining", coursePath: "SS2026/Data-Mining" });
    expect(chunks.map((c) => [c.ref, c.citation, c.at, c.page, c.kind])).toEqual([
      ["SS2026/Data-Mining#Vorlesung-02.mp4:1", "Data Mining · Vorlesung-02.mp4 · 00:00:00", "00:00:00", 1, "media"],
      ["SS2026/Data-Mining#Vorlesung-02.mp4:2", "Data Mining · Vorlesung-02.mp4 · 00:02:05", "00:02:05", 2, "media"],
    ]);

    // Unchanged: skipped, still reporting the transcript.
    expect(await ex.extractFile(src, out)).toMatchObject({ skipped: true, transcript: { sections: 2 } });
  });

  it("without the runtime a recording stays pending: nothing is written, and the hint names setup speech", async () => {
    const r = await new Extractor({ anydoc: true, pdfInspector: true }).extractFile(src, out);
    expect(r).toMatchObject({ kind: "media", pages: 0, pending: true });
    expect(r.hint).toMatch(/imstudium setup speech/);
    expect(r.error).toBeUndefined();
    await expect(readdir(out)).rejects.toThrow();
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("transcribes on this machine when the runtime and ffmpeg are here, and writes transcript.json in the runner's schema", async () => {
    speech.ready = true;
    transcribe.mockResolvedValueOnce({ duration: 140.25, segments, ms: 900 });
    const r = await new Extractor({ anydoc: true, pdfInspector: true }).extractFile(src, out);
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(transcribe.mock.calls[0]![1]).toMatchObject({ threads: 4, ffmpeg: "/usr/bin/ffmpeg" });
    expect(r).toMatchObject({ tool: "sherpa-onnx", transcript: { cached: false, onDevice: true, segments: 2, sections: 2 } });
    const st = await stat(src);
    const doc = JSON.parse(await read("transcript.json"));
    expect(Object.keys(doc)).toEqual(["schemaVersion", "model", "vad", "engine", "onDevice", "source", "duration", "transcribedAt", "segments"]);
    expect(doc).toMatchObject({ schemaVersion: "1", model: SPEECH_MODEL, onDevice: true, source: { file: "Vorlesung-02.mp4", size: st.size, mtimeMs: st.mtimeMs }, duration: 140.25, segments });
    expect(await read("content.md")).toContain("## 00:02:05");
    expect(summarizeMedia([r])).toEqual({ transcripts: 1, transcribed: 1, cached: 0, seconds: 140, pending: 0 });
  });

  it("with the runtime but no ffmpeg it is an error with the install hint, and nothing is written", async () => {
    speech.ready = true;
    speech.ffmpeg = null;
    const r = await new Extractor({ anydoc: true, pdfInspector: true }).extractFile(src, out);
    expect(r.error).toMatch(/ffmpeg not found on PATH/);
    expect(r.hint).toMatch(/brew install ffmpeg/);
    await expect(readdir(out)).rejects.toThrow();
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("--no-transcribe and IMSTUDIUM_SPEECH=off never run the model, but a matching transcript.json is still rendered", async () => {
    speech.ready = true;
    const ex = new Extractor({ anydoc: true, pdfInspector: true });
    expect(await ex.extractFile(src, out, { transcribe: false })).toMatchObject({ pending: true, hint: "Not transcribed (--no-transcribe)" });
    speech.disabled = true;
    expect((await ex.extractFile(src, out)).hint).toMatch(/IMSTUDIUM_SPEECH=off/);
    await runnerTranscript();
    expect(await ex.extractFile(src, out, { transcribe: false })).toMatchObject({ transcript: { cached: true } });
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("a transcript.json from any model is used when it matches the file, and the header says where it was made", async () => {
    speech.ready = true;
    const cloud = "Some cloud transcription (region x)";
    await runnerTranscript({ model: cloud, onDevice: false, vad: undefined, engine: undefined, segments: segments.map((s) => ({ ...s, language: "de" })) });
    const r = await new Extractor({ anydoc: true, pdfInspector: true }).extractFile(src, out);
    expect(transcribe).not.toHaveBeenCalled();
    expect(r).toMatchObject({ tool: "transcript.json", transcript: { model: cloud, onDevice: false, cached: true } });
    expect(await read("content.md")).toContain(`> video · 2 min · 2 section(s) · transcript by ${cloud}, not made on this machine ·`);
  });

  it("a transcript.json for another version of the file is not used", async () => {
    speech.ready = true;
    await runnerTranscript();
    const later = new Date(Date.now() + 60_000);
    await utimes(src, later, later);
    transcribe.mockResolvedValue({ duration: 140.25, segments, ms: 900 });
    expect((await new Extractor({ anydoc: true, pdfInspector: true }).extractFile(src, out)).transcript?.cached).toBe(false);
    expect(transcribe).toHaveBeenCalledTimes(1);
  });

  it("--force transcribes again over a matching transcript.json when it can, and renders it when it can't", async () => {
    await runnerTranscript({ model: "Some cloud transcription (region x)", onDevice: false });
    const ex = new Extractor({ anydoc: true, pdfInspector: true });
    expect(await ex.extractFile(src, out, { force: true })).toMatchObject({ transcript: { cached: true, onDevice: false } });
    speech.ready = true;
    speech.ffmpeg = null;
    expect(await ex.extractFile(src, out, { force: true })).toMatchObject({ transcript: { cached: true } });
    expect(await ex.extractFile(src, out, { force: true, transcribe: false })).toMatchObject({ transcript: { cached: true } });
    expect(transcribe).not.toHaveBeenCalled();
    speech.ffmpeg = "/usr/bin/ffmpeg";
    transcribe.mockResolvedValueOnce({ duration: 140.25, segments, ms: 900 });
    expect(await ex.extractFile(src, out, { force: true })).toMatchObject({ tool: "sherpa-onnx", transcript: { cached: false, onDevice: true, model: SPEECH_MODEL } });
    expect(JSON.parse(await read("transcript.json"))).toMatchObject({ model: SPEECH_MODEL, onDevice: true });
  });

  it("an unchanged recording is redone when a transcript appears or the runtime arrives, and not after a failed transcription", async () => {
    const ex = new Extractor({ anydoc: true, pdfInspector: true });
    expect((await ex.extractFile(src, out)).pending).toBe(true);
    // The batch runner wrote one meanwhile.
    await runnerTranscript();
    expect((await ex.extractFile(src, out)).transcript?.cached).toBe(true);
    // The runner wrote a newer one (same model, same source): rendered again.
    await runnerTranscript({ transcribedAt: "2026-11-18T09:00:00.000Z", segments: segments.slice(0, 1) });
    const rerendered = await ex.extractFile(src, out);
    expect(rerendered.skipped).toBeUndefined();
    expect(rerendered.pages).toBe(1);
    expect((await ex.extractFile(src, out)).skipped).toBe(true);

    // A failed transcription is recorded and not retried until --force.
    await rm(out, { recursive: true, force: true });
    speech.ready = true;
    transcribe.mockRejectedValueOnce(new Error("ffmpeg exit 1: Invalid data found when processing input"));
    expect((await ex.extractFile(src, out)).error).toMatch(/^Transcription failed: ffmpeg exit 1/);
    expect((await ex.extractFile(src, out)).skipped).toBe(true);
    transcribe.mockResolvedValueOnce({ duration: 140.25, segments, ms: 900 });
    expect((await ex.extractFile(src, out, { force: true })).transcript?.cached).toBe(false);
  });

  it("extractDir handles recordings with the rest, pending ones included", async () => {
    const files = join(dir, "files");
    await mkdir(join(files, "Videos"), { recursive: true });
    await writeFile(join(files, "Videos", "Teil 1.mp4"), "synthetic");
    await writeFile(join(files, "notiz.txt"), "Eine kurze Notiz zur Vorlesung, lang genug für den Index.");
    await writeFile(join(files, "clip.avi"), "synthetic");
    const results = await new Extractor({ anydoc: true, pdfInspector: true }).extractDir(files, join(dir, "extracted"));
    expect(results.map((r) => [r.kind, !!r.pending]).sort()).toEqual([
      ["media", true],
      ["text", false],
    ]);
    expect(summarizeMedia(results)).toEqual({ transcripts: 0, transcribed: 0, cached: 0, seconds: 0, pending: 1 });
  });
});
