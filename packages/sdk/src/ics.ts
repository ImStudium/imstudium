/**
 * Small, dependency-free iCalendar reader for the Stud.IP export
 * (`/users/{id}/events.ics`). Enough of RFC 5545 for a timetable:
 * VEVENT with DTSTART/DTEND (TZID, UTC "Z", floating, VALUE=DATE),
 * RRULE (DAILY/WEEKLY/MONTHLY/YEARLY with INTERVAL, UNTIL, COUNT, BYDAY),
 * EXDATE, RECURRENCE-ID overrides, SUMMARY/LOCATION/DESCRIPTION/CATEGORIES.
 */
import { addDays, BERLIN, dateKey, isValidTimeZone, parseDateKey, weekdayOf, zonedParts, zonedTimeToDate } from "./berlin.js";

export type IcsFrequency = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

export interface IcsRRule {
  freq: IcsFrequency;
  interval: number;
  until?: Date;
  count?: number;
  /** ISO weekdays 1–7 from BYDAY (ordinals like "-1SU" are not expanded). */
  byDay?: number[];
}

export interface IcsEvent {
  uid?: string;
  summary: string;
  location?: string;
  description?: string;
  categories: string[];
  status?: string;
  start: Date;
  end: Date;
  allDay: boolean;
  /** Zone the event's wall clock lives in (recurrences keep this wall clock). */
  timeZone: string;
  rrule?: IcsRRule;
  exdates: Date[];
  recurrenceId?: Date;
  /** STATUS:CANCELLED or Stud.IP's "(fällt aus)" summary suffix. */
  cancelled: boolean;
}

export interface IcsOccurrence {
  event: IcsEvent;
  start: Date;
  end: Date;
}

interface IcsProperty {
  name: string;
  params: Record<string, string>;
  value: string;
}

/** Undo RFC 5545 line folding (CRLF or LF followed by space/tab). */
export function unfoldIcsLines(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n[ \t]/g, "")
    .split("\n")
    .filter((l) => l.length > 0);
}

export function parseIcsProperty(line: string): IcsProperty | null {
  // Find the first ':' that is not inside a quoted parameter value.
  let inQuotes = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ":" && !inQuotes) {
      colon = i;
      break;
    }
  }
  if (colon <= 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const [rawName, ...rawParams] = head.split(";");
  const params: Record<string, string> = {};
  for (const p of rawParams) {
    const eq = p.indexOf("=");
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name: (rawName ?? "").toUpperCase(), params, value };
}

export function unescapeIcsText(value: string): string {
  return value.replace(/\\([\\;,nN])/g, (_, ch: string) => (ch === "n" || ch === "N" ? "\n" : ch));
}

/** Split on unescaped commas (CATEGORIES, EXDATE lists). */
function splitList(value: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]!;
    if (ch === "\\" && i + 1 < value.length) {
      cur += ch + value[i + 1];
      i++;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

function zoneFromParams(params: Record<string, string>, fallback = BERLIN): string {
  const tzid = params.TZID?.replace(/^\//, "");
  return tzid && isValidTimeZone(tzid) ? tzid : fallback;
}

/** Parse one DATE or DATE-TIME value. Floating times are read as Berlin wall clock. */
export function parseIcsDate(
  value: string,
  params: Record<string, string> = {},
): { date: Date; allDay: boolean; timeZone: string } | null {
  const v = value.trim();
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (dateOnly || params.VALUE === "DATE") {
    const m = dateOnly ?? /^(\d{4})(\d{2})(\d{2})/.exec(v);
    if (!m) return null;
    const timeZone = zoneFromParams(params);
    return {
      date: zonedTimeToDate(Number(m[1]), Number(m[2]), Number(m[3]), 0, 0, 0, timeZone),
      allDay: true,
      timeZone,
    };
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(v);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? "0"].map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (m[7]) return { date: new Date(Date.UTC(y, mo - 1, d, h, mi, s)), allDay: false, timeZone: "UTC" };
  const timeZone = zoneFromParams(params);
  return { date: zonedTimeToDate(y, mo, d, h, mi, s, timeZone), allDay: false, timeZone };
}

const BYDAY: Record<string, number> = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 7 };

export function parseRRule(value: string): IcsRRule | undefined {
  const parts: Record<string, string> = {};
  for (const kv of value.split(";")) {
    const eq = kv.indexOf("=");
    if (eq > 0) parts[kv.slice(0, eq).toUpperCase()] = kv.slice(eq + 1);
  }
  const freq = parts.FREQ?.toUpperCase();
  if (freq !== "DAILY" && freq !== "WEEKLY" && freq !== "MONTHLY" && freq !== "YEARLY") return undefined;
  const rule: IcsRRule = { freq, interval: Math.max(1, Number(parts.INTERVAL) || 1) };
  if (parts.UNTIL) {
    const until = parseIcsDate(parts.UNTIL);
    // An all-day UNTIL includes that whole day.
    if (until) rule.until = until.allDay ? new Date(until.date.getTime() + 86_399_000) : until.date;
  }
  if (parts.COUNT && Number(parts.COUNT) > 0) rule.count = Number(parts.COUNT);
  if (parts.BYDAY) {
    const days = parts.BYDAY.split(",")
      .map((d) => /^([+-]?\d+)?(MO|TU|WE|TH|FR|SA|SU)$/i.exec(d.trim()))
      .filter((m): m is RegExpExecArray => !!m && !m[1])
      .map((m) => BYDAY[m[2]!.toUpperCase()]!);
    if (days.length) rule.byDay = [...new Set(days)].sort((a, b) => a - b);
  }
  return rule;
}

const CANCELLED_SUMMARY = /\s*\((fällt aus|faellt aus|entfällt|cancelled|canceled)\)\s*$/i;

/** Parse every VEVENT of an iCalendar document; nested components (VALARM, VTIMEZONE) are skipped. */
export function parseIcs(text: string): IcsEvent[] {
  const events: IcsEvent[] = [];
  const stack: string[] = [];
  let props: IcsProperty[] = [];

  for (const line of unfoldIcsLines(text)) {
    const prop = parseIcsProperty(line);
    if (!prop) continue;
    if (prop.name === "BEGIN") {
      stack.push(prop.value.toUpperCase());
      if (prop.value.toUpperCase() === "VEVENT") props = [];
      continue;
    }
    if (prop.name === "END") {
      const closed = stack.pop();
      if (closed === "VEVENT") {
        const ev = buildEvent(props);
        if (ev) events.push(ev);
      }
      continue;
    }
    if (stack[stack.length - 1] === "VEVENT") props.push(prop);
  }
  return events;
}

function buildEvent(props: IcsProperty[]): IcsEvent | null {
  let start: ReturnType<typeof parseIcsDate> = null;
  let end: ReturnType<typeof parseIcsDate> = null;
  let durationMs: number | undefined;
  const ev: Partial<IcsEvent> & { categories: string[]; exdates: Date[] } = { categories: [], exdates: [] };

  for (const p of props) {
    switch (p.name) {
      case "UID":
        ev.uid = p.value.trim();
        break;
      case "SUMMARY":
        ev.summary = unescapeIcsText(p.value).trim();
        break;
      case "LOCATION": {
        const loc = unescapeIcsText(p.value).trim();
        if (loc) ev.location = loc;
        break;
      }
      case "DESCRIPTION": {
        const desc = unescapeIcsText(p.value).trim();
        if (desc) ev.description = desc;
        break;
      }
      case "CATEGORIES":
        ev.categories.push(...splitList(p.value).map(unescapeIcsText));
        break;
      case "STATUS":
        ev.status = p.value.trim().toUpperCase();
        break;
      case "DTSTART":
        start = parseIcsDate(p.value, p.params);
        break;
      case "DTEND":
        end = parseIcsDate(p.value, p.params);
        break;
      case "DURATION":
        durationMs = parseDuration(p.value);
        break;
      case "RRULE":
        ev.rrule = parseRRule(p.value);
        break;
      case "EXDATE":
        for (const v of splitList(p.value)) {
          const d = parseIcsDate(v, p.params);
          if (d) ev.exdates.push(d.date);
        }
        break;
      case "RECURRENCE-ID": {
        const d = parseIcsDate(p.value, p.params);
        if (d) ev.recurrenceId = d.date;
        break;
      }
    }
  }
  if (!start) return null;
  const s = start as NonNullable<typeof start>;
  let endDate: Date;
  if (end) endDate = (end as NonNullable<typeof end>).date;
  else if (durationMs !== undefined) endDate = new Date(s.date.getTime() + durationMs);
  else endDate = s.allDay ? new Date(s.date.getTime() + 86_400_000) : s.date;

  const summary = ev.summary ?? "";
  const cancelled = ev.status === "CANCELLED" || CANCELLED_SUMMARY.test(summary);
  return {
    uid: ev.uid,
    summary: summary.replace(CANCELLED_SUMMARY, "").trim(),
    location: ev.location,
    description: ev.description,
    categories: ev.categories,
    status: ev.status,
    start: s.date,
    end: endDate,
    allDay: s.allDay,
    timeZone: s.timeZone,
    rrule: ev.rrule,
    exdates: ev.exdates,
    recurrenceId: ev.recurrenceId,
    cancelled,
  };
}

function parseDuration(value: string): number | undefined {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value.trim());
  if (!m) return undefined;
  const [, sign, w, d, h, mi, s] = m;
  const ms =
    ((Number(w) || 0) * 7 * 86_400 + (Number(d) || 0) * 86_400 + (Number(h) || 0) * 3600 + (Number(mi) || 0) * 60 + (Number(s) || 0)) *
    1000;
  return sign === "-" ? -ms : ms;
}

/** Wall-clock start of an occurrence on calendar day `key`, keeping the event's time of day. */
function onDay(ev: IcsEvent, key: string): Date {
  const { year, month, day } = parseDateKey(key);
  if (ev.allDay) return zonedTimeToDate(year, month, day, 0, 0, 0, ev.timeZone);
  const p = zonedParts(ev.start, ev.timeZone);
  return zonedTimeToDate(year, month, day, p.hour, p.minute, p.second, ev.timeZone);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Candidate days of a recurring event in series order (unbounded generator, caller stops). */
function* candidateDays(ev: IcsEvent, rule: IcsRRule): Generator<string> {
  const first = dateKey(ev.start, ev.timeZone);
  const { year: y0, month: m0, day: d0 } = parseDateKey(first);
  if (rule.freq === "DAILY") {
    for (let i = 0; ; i += rule.interval) yield addDays(first, i);
  }
  if (rule.freq === "WEEKLY") {
    const days = rule.byDay?.length ? rule.byDay : [weekdayOf(first)];
    const monday = addDays(first, 1 - weekdayOf(first));
    for (let week = 0; ; week += rule.interval) {
      for (const wd of days) {
        const key = addDays(monday, week * 7 + wd - 1);
        if (key >= first) yield key;
      }
    }
  }
  if (rule.freq === "MONTHLY") {
    for (let i = 0; ; i += rule.interval) {
      const total = m0 - 1 + i;
      const year = y0 + Math.floor(total / 12);
      const month = (total % 12) + 1;
      if (d0 <= daysInMonth(year, month)) {
        yield `${year}-${String(month).padStart(2, "0")}-${String(d0).padStart(2, "0")}`;
      }
    }
  }
  if (rule.freq === "YEARLY") {
    for (let i = 0; ; i += rule.interval) {
      const year = y0 + i;
      if (d0 <= daysInMonth(year, m0)) {
        yield `${year}-${String(m0).padStart(2, "0")}-${String(d0).padStart(2, "0")}`;
      }
    }
  }
}

/**
 * Occurrences overlapping [from, to), sorted by start. Recurring events are
 * expanded (EXDATE and RECURRENCE-ID overrides removed); `maxPerEvent`
 * guards against unbounded rules.
 */
export function expandIcs(events: IcsEvent[], from: Date, to: Date, maxPerEvent = 2000): IcsOccurrence[] {
  const out: IcsOccurrence[] = [];
  const overridden = new Map<string, Set<number>>();
  for (const ev of events) {
    if (ev.uid && ev.recurrenceId) {
      const set = overridden.get(ev.uid) ?? new Set<number>();
      set.add(ev.recurrenceId.getTime());
      overridden.set(ev.uid, set);
    }
  }
  const lo = from.getTime();
  const hi = to.getTime();

  for (const ev of events) {
    const duration = Math.max(0, ev.end.getTime() - ev.start.getTime());
    if (!ev.rrule || ev.recurrenceId) {
      if (ev.start.getTime() < hi && Math.max(ev.end.getTime(), ev.start.getTime() + 1) > lo) {
        out.push({ event: ev, start: ev.start, end: ev.end });
      }
      continue;
    }
    const rule = ev.rrule;
    const skip = new Set(ev.exdates.map((d) => d.getTime()));
    const skipDays = new Set(ev.allDay ? ev.exdates.map((d) => dateKey(d, ev.timeZone)) : []);
    const over = (ev.uid && overridden.get(ev.uid)) || new Set<number>();
    let produced = 0;
    let iterations = 0;
    for (const key of candidateDays(ev, rule)) {
      if (++iterations > maxPerEvent * 8) break;
      const start = onDay(ev, key);
      const t = start.getTime();
      if (t < ev.start.getTime()) continue;
      if (rule.until && t > rule.until.getTime()) break;
      if (rule.count !== undefined && produced >= rule.count) break;
      if (t >= hi) break;
      produced++; // COUNT counts excluded instances too (RFC 5545)
      if (produced > maxPerEvent) break;
      if (skip.has(t) || skipDays.has(key) || over.has(t)) continue;
      const end = new Date(t + duration);
      if (Math.max(end.getTime(), t + 1) > lo) out.push({ event: ev, start, end });
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}
