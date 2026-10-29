/**
 * Europe/Berlin wall-clock helpers. Stud.IP thinks in German local time;
 * every date we show or group by day goes through here so a 08:00 lecture
 * stays 08:00 across DST and on a laptop set to any time zone.
 */

export const BERLIN = "Europe/Berlin";

export const WEEKDAYS_SHORT_DE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"] as const;
export const WEEKDAYS_LONG_DE = [
  "Montag",
  "Dienstag",
  "Mittwoch",
  "Donnerstag",
  "Freitag",
  "Samstag",
  "Sonntag",
] as const;

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** ISO weekday: 1 = Monday … 7 = Sunday. */
  weekday: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
      hourCycle: "h23",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

const WEEKDAY_INDEX: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** True when the runtime knows this IANA zone. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

export function zonedParts(date: Date, timeZone = BERLIN): ZonedParts {
  const parts: Record<string, string> = {};
  for (const p of formatter(timeZone).formatToParts(date)) parts[p.type] = p.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAY_INDEX[parts.weekday ?? "Mon"] ?? 1,
  };
}

/** UTC offset of `timeZone` at `date`, in minutes (Berlin: +60 or +120). */
export function tzOffsetMinutes(date: Date, timeZone = BERLIN): number {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const whole = Math.floor(date.getTime() / 1000) * 1000;
  return Math.round((asUtc - whole) / 60_000);
}

/** Wall-clock time in `timeZone` → the instant. DST gaps resolve forward, overlaps to the first. */
export function zonedTimeToDate(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  timeZone = BERLIN,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const first = tzOffsetMinutes(new Date(guess), timeZone);
  let t = guess - first * 60_000;
  const second_ = tzOffsetMinutes(new Date(t), timeZone);
  if (second_ !== first) t = guess - second_ * 60_000;
  return new Date(t);
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

/** ISO 8601 with the zone's offset, e.g. 2026-10-20T10:00:00+02:00. */
export function toZonedIso(date: Date, timeZone = BERLIN): string {
  const p = zonedParts(date, timeZone);
  const off = tzOffsetMinutes(date, timeZone);
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** Normalise any ISO-ish timestamp to Berlin ISO; null when unparsable. */
export function berlinIso(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : toZonedIso(value);
  if (typeof value === "number") return toZonedIso(new Date(value < 1e12 ? value * 1000 : value));
  if (typeof value !== "string" || !value.trim()) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : toZonedIso(new Date(t));
}

/** Calendar day in Berlin, e.g. "2026-10-20". */
export function dateKey(date: Date, timeZone = BERLIN): string {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function parseDateKey(key: string): { year: number; month: number; day: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key.trim());
  if (!m) throw new Error(`Expected YYYY-MM-DD, got "${key}"`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

export function isDateKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

export function addDays(key: string, days: number): string {
  const { year, month, day } = parseDateKey(key);
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** ISO weekday (1 = Monday) of a calendar day. */
export function weekdayOf(key: string): number {
  const { year, month, day } = parseDateKey(key);
  const w = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return w === 0 ? 7 : w;
}

/** Monday of the week containing `key`. */
export function mondayOf(key: string): string {
  return addDays(key, 1 - weekdayOf(key));
}

/** Midnight of a Berlin calendar day as an instant. */
export function startOfDay(key: string, timeZone = BERLIN): Date {
  const { year, month, day } = parseDateKey(key);
  return zonedTimeToDate(year, month, day, 0, 0, 0, timeZone);
}

/** "10:00" in Berlin. */
export function hhmm(date: Date, timeZone = BERLIN): string {
  const p = zonedParts(date, timeZone);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** "Mo 20.10." */
export function dayLabel(key: string): string {
  const { month, day } = parseDateKey(key);
  return `${WEEKDAYS_SHORT_DE[weekdayOf(key) - 1]} ${pad(day)}.${pad(month)}.`;
}

/** "20.10.2026" */
export function germanDate(key: string): string {
  const { year, month, day } = parseDateKey(key);
  return `${pad(day)}.${pad(month)}.${year}`;
}

/** Stud.IP weekday numbers: cycles use 0/7 = Sunday, 1 = Monday. Returns ISO 1–7 or null. */
export function isoWeekday(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > 7) return null;
  return n === 0 ? 7 : n;
}
