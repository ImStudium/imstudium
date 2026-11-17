import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SPEECH_ENGINE, SPEECH_MODEL, SPEECH_VAD } from "./speech.js";
import {
  formatDuration,
  formatTimestamp,
  isTranscriptMd,
  mediaLabel,
  MEDIA_EXT,
  NO_SPEECH,
  readTranscript,
  renderTranscriptMd,
  transcriptLanguages,
  transcriptMatches,
  transcriptSections,
  writeTranscript,
  type TranscriptDoc,
  type TranscriptSegment,
} from "./transcript.js";

/** Synthetic segments only: made-up lecture sentences, no recording. */
const seg = (start: number, text: string, length = 8): TranscriptSegment => ({ start, end: start + length, text });

const doc = (over: Partial<TranscriptDoc> = {}): TranscriptDoc => ({
  schemaVersion: "1",
  model: SPEECH_MODEL,
  vad: SPEECH_VAD,
  engine: SPEECH_ENGINE,
  onDevice: true,
  source: { file: "Vorlesung-01.mp4", size: 1234, mtimeMs: 1767225600123.456 },
  duration: 300.5,
  transcribedAt: "2026-11-17T12:00:00.000Z",
  segments: [seg(1.2, "Willkommen zur ersten Vorlesung."), seg(65, "Heute geht es um lineare Regression."), seg(130.4, "Die Steigung schätzen wir mit kleinsten Quadraten.")],
  ...over,
});

describe("timestamps", () => {
  it("formats seconds as hh:mm:ss, rounded down", () => {
    expect(formatTimestamp(0)).toBe("00:00:00");
    expect(formatTimestamp(59.99)).toBe("00:00:59");
    expect(formatTimestamp(61)).toBe("00:01:01");
    expect(formatTimestamp(3600 + 2 * 60 + 3.7)).toBe("01:02:03");
    expect(formatTimestamp(100 * 3600)).toBe("100:00:00");
    expect(formatTimestamp(-4)).toBe("00:00:00");
    expect(formatTimestamp(Number.NaN)).toBe("00:00:00");
  });

  it("says how long a recording is", () => {
    expect(formatDuration(38.4)).toBe("38 s");
    expect(formatDuration(45 * 60 + 10)).toBe("45 min");
    expect(formatDuration(92 * 60)).toBe("1 h 32 min");
    expect(formatDuration(2 * 3600)).toBe("2 h 0 min");
  });
});

describe("transcriptSections", () => {
  it("groups segments into sections of about two minutes, each headed by its first segment's start", () => {
    const sections = transcriptSections([seg(0.5, "a"), seg(60, "b"), seg(119.9, "c"), seg(120.5, "d"), seg(200, "e"), seg(240.5, "f"), seg(250, "  ")]);
    expect(sections.map((s) => [s.index, s.at, s.text])).toEqual([
      [1, "00:00:00", "a b c"],
      [2, "00:02:00", "d e"],
      [3, "00:04:00", "f"],
    ]);
    expect(sections[1]).toMatchObject({ start: 120.5, end: 208 });
  });

  it("keeps the model's text as it is, joined with spaces", () => {
    const [only] = transcriptSections([seg(3, "  Die Varianz σ² ist   klein. "), seg(10, "Okay?")]);
    expect(only!.text).toBe("Die Varianz σ² ist   klein. Okay?");
  });

  it("a long stretch without speech starts a new section at the next words", () => {
    expect(transcriptSections([seg(0, "a"), seg(900, "b")]).map((s) => s.at)).toEqual(["00:00:00", "00:15:00"]);
  });

  it("no segments, no sections", () => {
    expect(transcriptSections([])).toEqual([]);
  });
});

describe("transcript.json as a cache", () => {
  const source = { size: 1234, mtimeMs: 1767225600123.456 };

  it("is valid when the source size and mtime match, whatever model wrote it", () => {
    expect(transcriptMatches(doc(), source)).toBe(true);
    expect(transcriptMatches(doc({ model: "parakeet-tdt-0.6b-v2 (older)" }), source)).toBe(true);
    expect(transcriptMatches(doc({ model: "Some cloud transcription (region x)", onDevice: false, vad: undefined, engine: undefined }), source)).toBe(true);
    expect(transcriptMatches(doc(), { ...source, size: 1235 })).toBe(false);
    expect(transcriptMatches(doc(), { ...source, mtimeMs: source.mtimeMs + 1 })).toBe(false);
  });

  it("refuses a file that isn't a transcript", () => {
    expect(transcriptMatches(null, source)).toBe(false);
    expect(transcriptMatches("text", source)).toBe(false);
    expect(transcriptMatches({ ...doc(), model: "" }, source)).toBe(false);
    expect(transcriptMatches({ ...doc(), model: undefined }, source)).toBe(false);
    expect(transcriptMatches({ ...doc(), onDevice: "yes" }, source)).toBe(false);
    expect(transcriptMatches({ ...doc(), segments: "none" }, source)).toBe(false);
    expect(transcriptMatches({ ...doc(), duration: "5" }, source)).toBe(false);
    expect(transcriptMatches({ ...doc(), segments: [{ start: 0, end: 1 }] }, source)).toBe(false);
    expect(transcriptMatches({ ...doc(), segments: [{ start: 0, end: 1, text: "x", language: 7 }] }, source)).toBe(false);
  });

  it("segments may name their language", () => {
    expect(transcriptMatches({ ...doc(), segments: [{ start: 0, end: 1, text: "Hallo.", language: "de" }] }, source)).toBe(true);
  });

  describe("on disk", () => {
    let dir: string;
    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), "imstudium-transcript-"));
    });
    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it("is written in one line, atomically, and read back when it matches", async () => {
      await writeTranscript(dir, doc());
      expect(await readdir(dir)).toEqual(["transcript.json"]);
      const raw = await readFile(join(dir, "transcript.json"), "utf-8");
      expect(raw.endsWith("}\n")).toBe(true);
      expect(raw.trim().split("\n")).toHaveLength(1);
      expect(await readTranscript(dir, source)).toEqual(doc());
      expect(await readTranscript(dir, { ...source, size: 1 })).toBeNull();
    });

    it("reads the batch runner's schema: the same keys, the mtime as a float", async () => {
      const runner = { schemaVersion: "1", model: SPEECH_MODEL, vad: SPEECH_VAD, engine: SPEECH_ENGINE, onDevice: true, source: { file: "a.mp4", ...source }, duration: 12.5, transcribedAt: "2026-11-17T14:00:00.000Z", segments: [{ start: 0.42, end: 3.1, text: "Hallo." }] };
      await writeFile(join(dir, "transcript.json"), `${JSON.stringify(runner)}\n`);
      expect(await readTranscript(dir, source)).toEqual(runner);
    });

    it("a missing or broken file is no cache", async () => {
      expect(await readTranscript(dir, source)).toBeNull();
      await writeFile(join(dir, "transcript.json"), "{ half");
      expect(await readTranscript(dir, source)).toBeNull();
    });
  });
});

describe("content.md for a recording", () => {
  it("has the usual header, names the model, says it is model output, and heads each section with its start time", () => {
    const md = renderTranscriptMd("Vorlesung-01.mp4", doc());
    expect(md.split("\n").slice(0, 3)).toEqual([
      "# Vorlesung-01.mp4",
      "",
      `> video · 5 min · 2 section(s) · on-device transcript by ${SPEECH_MODEL} · model output: check names, numbers and formulas against the recording`,
    ]);
    expect(md).toContain("## 00:00:01\n\nWillkommen zur ersten Vorlesung. Heute geht es um lineare Regression.\n");
    expect(md).toContain("## 00:02:10\n\nDie Steigung schätzen wir mit kleinsten Quadraten.\n");
    expect(isTranscriptMd(md)).toBe(true);
  });

  it("names the model the transcript came from, and says when it wasn't made on this machine", () => {
    expect(renderTranscriptMd("x.mp3", doc({ model: "some-other-model" }))).toContain("> audio · 5 min · 2 section(s) · on-device transcript by some-other-model ·");
    const elsewhere = renderTranscriptMd("x.mp4", doc({ model: "Some cloud transcription (region x)", onDevice: false }));
    expect(elsewhere).toContain(
      "> video · 5 min · 2 section(s) · transcript by Some cloud transcription (region x), not made on this machine · model output: check names, numbers and formulas against the recording",
    );
    expect(isTranscriptMd(elsewhere)).toBe(true);
  });

  it("notes the languages when a lecture mixes them, most spoken first, and otherwise ignores them", () => {
    const mixed = [
      { start: 0, end: 5, text: "Guten Morgen.", language: "de" },
      { start: 6, end: 40, text: "Today the slides are in English.", language: "en" },
      { start: 41, end: 50, text: "Fragen?", language: "de" },
    ];
    expect(transcriptLanguages(mixed)).toEqual(["en", "de"]);
    expect(renderTranscriptMd("x.mp4", doc({ segments: mixed }))).toContain("> video · 5 min · 1 section(s) · speech in en, de · on-device transcript by");
    expect(renderTranscriptMd("x.mp4", doc({ segments: mixed.map((s) => ({ ...s, language: "de" })) }))).not.toContain("speech in");
    expect(renderTranscriptMd("x.mp4", doc({ segments: mixed }))).toContain("## 00:00:00\n\nGuten Morgen. Today the slides are in English. Fragen?\n");
  });

  it("a recording without speech says so", () => {
    const md = renderTranscriptMd("leer.wav", doc({ segments: [], duration: 30 }));
    expect(md).toContain("> audio · 30 s · 0 section(s)");
    expect(md).toContain(NO_SPEECH);
    expect(md).not.toMatch(/^## /m);
  });

  it("only a transcript's header counts as one", () => {
    expect(isTranscriptMd("# Blatt.pdf\n\n> pdf · 2 page(s) · local AnyDoc / pdf-inspector\n")).toBe(false);
  });
});

describe("media kinds", () => {
  it("knows the audio and video extensions and labels them", () => {
    expect([...MEDIA_EXT].sort()).toEqual([".aac", ".flac", ".m4a", ".m4v", ".mkv", ".mov", ".mp3", ".mp4", ".oga", ".ogg", ".opus", ".wav", ".webm"]);
    expect(mediaLabel("a.MP4")).toBe("video");
    expect(mediaLabel("a.webm")).toBe("video");
    expect(mediaLabel("a.m4a")).toBe("audio");
    expect(mediaLabel("a.opus")).toBe("audio");
  });
});
