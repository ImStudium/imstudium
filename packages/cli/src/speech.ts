import { speechRuntimeStatus, type MediaSummary, type SpeechRuntimeStatus } from "@imstudium/sdk";
import type { SpeechRuntime } from "@imstudium/contract";

/** The speech runtime as the contract shows it (`setup speech`, `setup status`). */
export function speechRuntimeView(status: SpeechRuntimeStatus = speechRuntimeStatus()): SpeechRuntime {
  return {
    supported: status.supported,
    ready: status.ready,
    disabled: status.disabled,
    platform: status.platform,
    dir: status.dir,
    model: status.model,
    vad: status.vad,
    engine: status.engine,
    downloadBytes: status.downloadBytes,
    ffmpeg: status.ffmpeg,
    threads: status.threads,
    reason: status.reason,
  };
}

/** "1 h 32 min of audio" from seconds. */
function audioLength(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

const recordings = (n: number) => `${n} recording${n === 1 ? "" : "s"}`;

/**
 * "2 recordings transcribed on this machine (3 h 5 min of audio), 5 read from transcript.json ·
 * 12 recordings without a transcript: imstudium setup speech" — empty when no recording was touched.
 */
export function mediaSummaryLine(
  media: MediaSummary,
  status: Pick<SpeechRuntimeStatus, "ready" | "supported" | "disabled"> = speechRuntimeStatus(),
  opts: { transcribe?: boolean } = {},
): string {
  const parts: string[] = [];
  const done = [
    media.transcribed ? `${recordings(media.transcribed)} transcribed on this machine (${audioLength(media.seconds)} of audio)` : "",
    media.cached ? `${recordings(media.cached)} read from transcript.json` : "",
  ].filter(Boolean);
  if (done.length) parts.push(done.join(", "));
  if (media.pending) {
    const why =
      opts.transcribe === false
        ? " (--no-transcribe)"
        : status.ready && status.disabled
          ? " (IMSTUDIUM_SPEECH=off)"
          : !status.ready && status.supported
            ? ": imstudium setup speech transcribes them on this machine"
            : "";
    parts.push(`${recordings(media.pending)} without a transcript${why}`);
  }
  return parts.join(" · ");
}
