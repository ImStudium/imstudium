import { ImstudiumError } from "@imstudium/sdk";

const UNIT_MS: Record<string, number> = {
  s: 1_000,
  min: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 7 * 86_400_000,
};

/** One duration grammar for every flag: `30s`, `30m`/`30min`, `24h`, `7d`, `2w` (and `3mo` where months make sense). */
const DURATION = /^(\d+(?:\.\d+)?)\s*(s|sec|m|min|h|d|w|mo)$/;

function unitOf(raw: string): string {
  if (raw === "m") return "min";
  if (raw === "sec") return "s";
  return raw;
}

/**
 * A length of time in milliseconds (`--interval`). Bad input is an error —
 * never a silent default.
 */
export function parseDuration(input: string, flag = "interval", options: { min?: number } = {}): number {
  const m = DURATION.exec(input.trim().toLowerCase());
  const unit = m ? unitOf(m[2]!) : undefined;
  if (!m || unit === "mo") {
    throw new ImstudiumError(`Cannot read --${flag} "${input}"`, "BAD_ARGS", undefined, "Use 30s, 15m, 1h, 1d or 1w");
  }
  const ms = Number(m[1]) * UNIT_MS[unit!]!;
  if (options.min !== undefined && ms < options.min) {
    throw new ImstudiumError(`--${flag} ${input} is too short`, "BAD_ARGS", undefined, `At least ${Math.ceil(options.min / 1000)} s`);
  }
  return ms;
}

/**
 * Parse a `--since` value into a Date.
 *
 *   30min · 24h · 7d · 2w · 3mo   relative to now (same grammar as --interval)
 *   today · yesterday             local midnight
 *   2026-10-01                    local midnight of that day
 *   2026-10-01T08:00[:00][Z|±hh:mm]  exact moment
 */
export function parseSince(input: string, now: Date = new Date()): Date {
  const raw = input.trim().toLowerCase();
  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

  if (raw === "today" || raw === "heute") return midnight(now);
  if (raw === "yesterday" || raw === "gestern") {
    const d = midnight(now);
    d.setDate(d.getDate() - 1);
    return d;
  }

  const rel = DURATION.exec(raw);
  if (rel) {
    const n = Number(rel[1]);
    const unit = unitOf(rel[2]!);
    if (unit === "mo") {
      const d = new Date(now);
      d.setMonth(d.getMonth() - Math.round(n));
      return d;
    }
    return new Date(now.getTime() - n * UNIT_MS[unit]!);
  }

  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (day) {
    const d = new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]));
    if (d.getMonth() === Number(day[2]) - 1) return d;
  } else if (/^\d{4}-\d{2}-\d{2}t\d{2}:\d{2}/.test(raw)) {
    const t = Date.parse(input.trim());
    if (Number.isFinite(t)) return new Date(t);
  }

  throw new ImstudiumError(
    `Cannot read --since "${input}"`,
    "BAD_ARGS",
    undefined,
    "Use 24h, 7d, 2w, 3mo, today, yesterday or a date like 2026-10-01",
  );
}

/** parseSince for optional flags: undefined stays undefined. */
export function optionalSince(input: string | undefined, now?: Date): Date | undefined {
  return input ? parseSince(input, now) : undefined;
}
