import { dateKey, dayLabel, germanDate, hhmm } from "@imstudium/sdk";

/**
 * The one formatting kit for human output. Every date shown to a student is
 * Europe/Berlin wall-clock time, whatever the laptop's time zone; widths and
 * truncation go through `cell`/`table` so columns line up the same way in
 * every command. JSON output never goes through here (it stays ISO).
 */

export { dayLabel, germanDate, hhmm };

type DateInput = string | number | Date | null | undefined;

function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "20.10.2026" — or `fallback` for a missing/invalid date. */
export function berlinDate(value: DateInput, fallback = "?"): string {
  const d = toDate(value);
  return d ? germanDate(dateKey(d)) : fallback;
}

/** "20.10." */
export function berlinDayMonth(value: DateInput, fallback = "?"): string {
  const d = toDate(value);
  return d ? germanDate(dateKey(d)).slice(0, 6) : fallback;
}

/** "20.10.2026 10:00" */
export function berlinDateTime(value: DateInput, fallback = "?"): string {
  const d = toDate(value);
  return d ? `${germanDate(dateKey(d))} ${hhmm(d)}` : fallback;
}

/** "Di 20.10." or, with `time`, "Di 20.10. 10:00". */
export function berlinWeekday(value: DateInput, options: { time?: boolean } = {}, fallback = "?"): string {
  const d = toDate(value);
  if (!d) return fallback;
  return options.time ? `${dayLabel(dateKey(d))} ${hhmm(d)}` : dayLabel(dateKey(d));
}

/** "2026-10-20 10:00" (sortable, Berlin) — or "" for a missing date. */
export function berlinIsoMinute(value: DateInput): string {
  const d = toDate(value);
  return d ? `${dateKey(d)} ${hhmm(d)}` : "";
}

/** "2026-10-20" (Berlin) — or "" for a missing date. */
export function berlinIsoDay(value: DateInput): string {
  const d = toDate(value);
  return d ? dateKey(d) : "";
}

/** Now, for "updated …" footers: "20.10.2026 10:00". */
export function nowStamp(now = new Date()): string {
  return berlinDateTime(now);
}

/** Cut to `width` characters with an ellipsis. */
export function truncate(text: string, width: number): string {
  if (width <= 0) return "";
  return text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text;
}

/** Truncate and pad to exactly `width` characters. */
export function cell(text: string | null | undefined, width: number): string {
  return truncate(text ?? "", width).padEnd(width);
}

/** A course title as a fixed-width column label. */
export function courseLabel(title: string | null | undefined, width = 30): string {
  return cell(title, width);
}

/**
 * Align rows into columns. Every column but the last is padded to its
 * widest cell (capped by `maxWidths`); the last column runs free.
 */
export function table(rows: Array<Array<string | null | undefined>>, options: { indent?: string; gap?: string; maxWidths?: number[] } = {}): string[] {
  const { indent = "", gap = "  ", maxWidths = [] } = options;
  const cols = Math.max(0, ...rows.map((r) => r.length));
  const widths = Array.from({ length: cols }, (_, i) =>
    Math.min(maxWidths[i] ?? Infinity, Math.max(0, ...rows.map((r) => (r[i] ?? "").length))),
  );
  return rows.map((r) =>
    `${indent}${r.map((c, i) => (i === r.length - 1 ? truncate(c ?? "", maxWidths[i] ?? Infinity) : cell(c, widths[i]!))).join(gap)}`.trimEnd(),
  );
}

/** "heute", "morgen", "in 3 d", "2 d überfällig", "" (no date). */
export function daysLeftLabel(days: number | null | undefined): string {
  if (days === null || days === undefined) return "";
  if (days < 0) return `${-days} d überfällig`;
  if (days === 0) return "heute";
  if (days === 1) return "morgen";
  return `in ${days} d`;
}
