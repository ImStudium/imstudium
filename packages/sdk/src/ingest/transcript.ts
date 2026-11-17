/**
 * Transcripts of lecture recordings: the transcript.json cache next to
 * content.md, and how content.md is rendered from it. Pure apart from the two
 * file helpers; the speech engine itself is in speech.ts.
 *
 * transcript.json is shared with runners outside ImStudium that transcribe a
 * student's recordings ahead of time into the same schema: the batch runner on
 * the student's machine (Parakeet, on-device), or one that used a cloud
 * service (onDevice: false). One whose source size and mtime match the
 * recording is read instead of transcribing it again, whatever its model;
 * content.md names that model and says whether it ran on this machine.
 * ImStudium itself never sends a recording anywhere.
 */
import { readFile, rename, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

export const TRANSCRIPT_FILE = "transcript.json";

/** Audio and video the extractor transcribes. */
export const MEDIA_EXT = new Set([".mp4", ".mkv", ".webm", ".mov", ".m4v", ".mp3", ".m4a", ".wav", ".ogg", ".oga", ".opus", ".flac", ".aac"]);
const VIDEO_EXT = new Set([".mp4", ".mkv", ".webm", ".mov", ".m4v"]);

/** "video" or "audio", for the content.md header. */
export function mediaLabel(filename: string): "video" | "audio" {
  return VIDEO_EXT.has(extname(filename).toLowerCase()) ? "video" : "audio";
}

export interface TranscriptSegment {
  /** Seconds from the start of the recording, to 1/100 s. */
  start: number;
  end: number;
  /** As the model wrote it. */
  text: string;
  /** The language the model heard, when it says (e.g. "de", "en"). */
  language?: string;
}

/** transcript.json (schema v1). */
export interface TranscriptDoc {
  schemaVersion: "1";
  /** What made it, e.g. SPEECH_MODEL, or a cloud model's name from another runner. */
  model: string;
  vad?: string;
  engine?: string;
  /** true: transcribed on the student's machine; false: by a service elsewhere. */
  onDevice: boolean;
  source: { file: string; size: number; mtimeMs: number };
  /** Seconds of audio. */
  duration: number;
  transcribedAt: string;
  segments: TranscriptSegment[];
}

/** Target length of a content.md section: about two minutes each, so a search hit can cite the minute. */
export const SECTION_SECONDS = 120;

/** A recording's content.md says this when it has no speech (also excluded from search). */
export const NO_SPEECH = "_(no speech recognised in this recording)_";

/** hh:mm:ss, rounded down to the second. */
export function formatTimestamp(seconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** "1 h 32 min", "45 min", "38 s". */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const minutes = Math.round(s / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

export interface TranscriptSection {
  /** 1-based: the unit search cites, the way pages are for PDFs. */
  index: number;
  /** Start of its first segment, in seconds. */
  start: number;
  /** End of its last segment. */
  end: number;
  /** `start` as hh:mm:ss, the section's heading. */
  at: string;
  /** The segments' text, joined with spaces. */
  text: string;
}

/**
 * Group segments into sections of about `seconds`: a new section begins with
 * the first segment that starts `seconds` or more after the section's own
 * start. Segments stay whole (the VAD cuts at most 20 s), so a section runs
 * from about two minutes to two minutes and twenty seconds.
 */
export function transcriptSections(segments: readonly TranscriptSegment[], seconds: number = SECTION_SECONDS): TranscriptSection[] {
  const out: TranscriptSection[] = [];
  let texts: string[] = [];
  for (const seg of segments) {
    const text = seg.text.trim();
    if (!text) continue;
    const cur = out[out.length - 1];
    if (!cur || seg.start - cur.start >= seconds) {
      if (cur) cur.text = texts.join(" ");
      texts = [text];
      out.push({ index: out.length + 1, start: seg.start, end: seg.end, at: formatTimestamp(seg.start), text: "" });
    } else {
      texts.push(text);
      cur.end = Math.max(cur.end, seg.end);
    }
  }
  const last = out[out.length - 1];
  if (last) last.text = texts.join(" ");
  return out;
}

/**
 * Whether a parsed transcript.json can stand for the recording: the source's
 * size and mtime are the ones it was transcribed from, and it is a transcript
 * (a model named, segments with times and text). Which model made it doesn't
 * matter. Anything else is transcribed again.
 */
export function transcriptMatches(doc: unknown, source: { size: number; mtimeMs: number }): doc is TranscriptDoc {
  if (!doc || typeof doc !== "object") return false;
  const d = doc as Partial<TranscriptDoc>;
  if (d.source?.size !== source.size || d.source?.mtimeMs !== source.mtimeMs) return false;
  if (typeof d.model !== "string" || !d.model.trim() || typeof d.duration !== "number" || !Array.isArray(d.segments)) return false;
  if (d.onDevice !== undefined && typeof d.onDevice !== "boolean") return false;
  return d.segments.every((s) => !!s && typeof s.start === "number" && typeof s.end === "number" && typeof s.text === "string" && (s.language === undefined || typeof s.language === "string"));
}

/** The languages the segments name, most spoken first (empty when none says). */
export function transcriptLanguages(segments: readonly TranscriptSegment[]): string[] {
  const seconds = new Map<string, number>();
  for (const s of segments) if (s.language) seconds.set(s.language, (seconds.get(s.language) ?? 0) + Math.max(0, s.end - s.start));
  return [...seconds].sort((a, b) => b[1] - a[1]).map(([lang]) => lang);
}

/** The cached transcript in `outDir` when it matches the recording, else null. */
export async function readTranscript(outDir: string, source: { size: number; mtimeMs: number }): Promise<TranscriptDoc | null> {
  try {
    const doc: unknown = JSON.parse(await readFile(join(outDir, TRANSCRIPT_FILE), "utf-8"));
    return transcriptMatches(doc, source) ? doc : null;
  } catch {
    return null;
  }
}

/** Write transcript.json atomically (a reader never sees half a file), one line as the batch runner writes it. */
export async function writeTranscript(outDir: string, doc: TranscriptDoc): Promise<void> {
  const path = join(outDir, TRANSCRIPT_FILE);
  await writeFile(`${path}.tmp`, `${JSON.stringify(doc)}\n`);
  await rename(`${path}.tmp`, path);
}

/** The header line's note: what made the text, whether on this machine, and that it is model output. */
export function transcriptNote(model: string, onDevice: boolean): string {
  const by = onDevice ? `on-device transcript by ${model}` : `transcript by ${model}, not made on this machine`;
  return `${by} · model output: check names, numbers and formulas against the recording`;
}

/**
 * content.md for a recording: the usual header (naming the model and whether
 * it ran on this machine, plus the languages when the lecture mixes them),
 * then one `## hh:mm:ss` section per about two minutes.
 */
export function renderTranscriptMd(filename: string, doc: Pick<TranscriptDoc, "model" | "duration" | "segments"> & { onDevice?: boolean }): string {
  const sections = transcriptSections(doc.segments);
  const languages = transcriptLanguages(doc.segments);
  const mixed = languages.length > 1 ? ` · speech in ${languages.join(", ")}` : "";
  const lines = [
    `# ${filename}`,
    "",
    `> ${mediaLabel(filename)} · ${formatDuration(doc.duration)} · ${sections.length} section(s)${mixed} · ${transcriptNote(doc.model, doc.onDevice === true)}`,
    "",
  ];
  if (!sections.length) lines.push(NO_SPEECH, "");
  for (const s of sections) lines.push(`## ${s.at}`, "", s.text, "");
  return lines.join("\n");
}

/** A content.md rendered from a transcript (its header line says so). */
export function isTranscriptMd(content: string): boolean {
  return /^> (?:video|audio) · [^\n]* · (?:on-device )?transcript by /m.test(content);
}
