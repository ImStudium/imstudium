import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { envelopeV1, ExtractOutput, SearchOutput, SetupSpeechOutput, DoctorOutput } from "@imstudium/contract";
import { extractSlug, SPEECH_ENGINE, SPEECH_MODEL, SPEECH_VAD } from "@imstudium/sdk";
import { makeFixture, runCli, type Fixture } from "../test/harness.js";
import { mediaSummaryLine } from "../speech.js";

/**
 * Lecture recordings through the built CLI, on the synthetic workspace: a
 * transcript.json left by the batch runner is rendered and indexed without a
 * speech runtime, and a recording without one stays pending with a hint. The
 * recordings are a few synthetic bytes; the transcript is made up.
 */

let fx: Fixture;
let courseDir: string;
const VIDEO = "Vorlesungen/Woche 1.mp4";

beforeAll(async () => {
  fx = await makeFixture();
  courseDir = join(fx.workspace, "WS2026-27", "datenbanken");
  const video = join(courseDir, "files", VIDEO);
  await mkdir(join(video, ".."), { recursive: true });
  await writeFile(video, "synthetic stand-in for a lecture video");
  await writeFile(join(courseDir, "files", "Vorlesungen", "Woche 2.m4a"), "synthetic stand-in for a lecture recording");
  const st = await stat(video);
  const out = join(courseDir, "extracted", extractSlug(VIDEO));
  await mkdir(out, { recursive: true });
  const transcript = {
    schemaVersion: "1",
    model: SPEECH_MODEL,
    vad: SPEECH_VAD,
    engine: SPEECH_ENGINE,
    onDevice: true,
    source: { file: "Woche 1.mp4", size: st.size, mtimeMs: st.mtimeMs },
    duration: 262.4,
    transcribedAt: "2026-11-17T14:21:25.100Z",
    segments: [
      { start: 1.04, end: 7.5, text: "Willkommen zur Vorlesung Datenbanken." },
      { start: 130.2, end: 141.9, text: "Die dritte Normalform verbietet transitive Abhängigkeiten." },
    ],
  };
  await writeFile(join(out, "transcript.json"), `${JSON.stringify(transcript)}\n`);
});

describe("extract with recordings", () => {
  it("renders the batch runner's transcript without a runtime, leaves the other recording pending, and indexes the sections by time", async () => {
    const r = runCli(fx, ["--json", "extract", "--course", "datenbanken"]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).not.toContain("[no-network]");
    const parsed = envelopeV1(ExtractOutput).safeParse(r.json());
    expect(parsed.success ? null : parsed.error.issues).toBeNull();
    const out = ExtractOutput.parse(r.json());
    expect(out.media).toEqual({ transcripts: 1, transcribed: 0, cached: 1, seconds: 0, pending: 1 });
    const video = out.results.find((x) => x.source.endsWith("Woche 1.mp4"))!;
    expect(video).toMatchObject({ kind: "media", pages: 2, tool: "transcript.json", transcript: { model: SPEECH_MODEL, onDevice: true, duration: 262.4, segments: 2, sections: 2, cached: true } });
    expect(out.results.find((x) => x.source.endsWith("Woche 2.m4a"))).toMatchObject({ kind: "media", pages: 0, pending: true });
    expect(out.hints.join("\n")).toContain("imstudium setup speech");

    const md = await readFile(join(courseDir, "extracted", extractSlug(VIDEO), "content.md"), "utf-8");
    expect(md).toContain(`on-device transcript by ${SPEECH_MODEL}`);
    expect(md).toContain("## 00:02:10\n\nDie dritte Normalform verbietet transitive Abhängigkeiten.");
    const corpus = (await readFile(join(courseDir, "search", "corpus.jsonl"), "utf-8")).trim().split("\n").map((l) => JSON.parse(l) as { citation: string; at?: string; ref: string });
    expect(corpus.find((c) => c.at === "00:02:10")).toMatchObject({ citation: "Datenbanken · Woche 1.mp4 · 00:02:10", ref: "WS2026-27/datenbanken#Woche 1.mp4:2" });

    const search = runCli(fx, ["--json", "search", "Normalform", "--course", "datenbanken"]);
    expect(search.status, search.stderr).toBe(0);
    const hits = SearchOutput.parse(search.json()).hits;
    expect(hits[0]).toMatchObject({ at: "00:02:10", page: 2, citation: "Datenbanken · Woche 1.mp4 · 00:02:10" });
    expect(runCli(fx, ["search", "Normalform"]).stdout).toContain("(at 00:02:10)");
  });

  it("says in one line what was read and what is still missing", () => {
    const r = runCli(fx, ["extract", "--course", "datenbanken", "--force"]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("1 recording read from transcript.json · 1 recording without a transcript: imstudium setup speech transcribes them on this machine");
  });

  it("--no-transcribe still renders a transcript.json and says why the rest has none", () => {
    const r = runCli(fx, ["extract", "--course", "datenbanken", "--force", "--no-transcribe"]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("1 recording read from transcript.json · 1 recording without a transcript (--no-transcribe)");
  });
});

describe("setup speech and doctor without the runtime", () => {
  it("--remove on nothing is absent, and validates", () => {
    const r = runCli(fx, ["--json", "setup", "speech", "--remove"]);
    expect(r.status, r.stderr).toBe(0);
    expect(envelopeV1(SetupSpeechOutput).safeParse(r.json()).success).toBe(true);
    const out = SetupSpeechOutput.parse(r.json());
    expect(out.action).toBe("absent");
    expect(out.runtime.ready).toBe(false);
  });

  it("--force with --remove is a usage error", () => {
    expect(runCli(fx, ["--json", "setup", "speech", "--remove", "--force"]).status).toBe(2);
  });

  it("doctor reports transcripts as opt-in, not as a problem", () => {
    const report = DoctorOutput.parse(runCli(fx, ["--json", "doctor", "--offline"]).json());
    const speech = report.checks.find((c) => c.id === "speech")!;
    expect(speech.status === "ok" || speech.status === "skip").toBe(true);
    if (speech.status === "ok") expect(speech.detail).toMatch(/imstudium setup speech/);
  });
});

describe("mediaSummaryLine", () => {
  const none = { transcripts: 0, transcribed: 0, cached: 0, seconds: 0, pending: 0 };
  const notInstalled = { ready: false, supported: true, disabled: false };
  it("counts transcribed and cached recordings, and what is pending and why", () => {
    expect(mediaSummaryLine(none, notInstalled)).toBe("");
    expect(mediaSummaryLine({ ...none, transcripts: 3, transcribed: 2, cached: 1, seconds: 11_100 }, notInstalled)).toBe(
      "2 recordings transcribed on this machine (3 h 5 min of audio), 1 recording read from transcript.json",
    );
    expect(mediaSummaryLine({ ...none, pending: 4 }, { ready: true, supported: true, disabled: true })).toBe("4 recordings without a transcript (IMSTUDIUM_SPEECH=off)");
    expect(mediaSummaryLine({ ...none, pending: 1 }, { ready: false, supported: false, disabled: false })).toBe("1 recording without a transcript");
  });
});
