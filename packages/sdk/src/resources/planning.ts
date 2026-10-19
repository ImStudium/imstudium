/**
 * Course dates, the weekly schedule and holidays on Stud.IP 6.1 — READ-ONLY.
 *
 * Normalisers are tolerant: Stud.IP 6 renamed attributes (`start-date` →
 * `start`, `category` → `categories`), moved the course of a schedule cycle
 * to the `owner` relationship, and serves `/holidays` as plain JSON. We read
 * both spellings and never throw on a missing field.
 */
import type { StudIpClient } from "../client.js";
import { relId } from "../jsonapi.js";
import type { JsonApiResource } from "../types.js";
import { berlinIso, dateKey, isoWeekday } from "../berlin.js";
import { arrayish, first, listOf, num, originOf, str } from "./attrs.js";

export { isAuthError, isOfflineError } from "./attrs.js";

/** Coarse kind of a date, derived from Stud.IP's date type name. */
export type DateKind =
  | "lecture"
  | "exercise"
  | "session"
  | "exam"
  | "preliminary"
  | "extra"
  | "excursion"
  | "lab"
  | "personal"
  | "other";

/** One concrete date of a course (or of your personal Stud.IP calendar). */
export interface CourseDate {
  id: string;
  courseId: string | null;
  courseTitle: string;
  /** ISO 8601 with Berlin offset. */
  start: string;
  end: string;
  location: string | null;
  cancelled: boolean;
  kind: DateKind;
  /** Stud.IP's own label, e.g. "Vorlesung", "Sitzung", "Klausur". */
  category: string | null;
  typeId: number | null;
  description: string | null;
  /** Cycle text when the date belongs to a regular cycle; null for single dates. */
  recurrence: string | null;
  source: "live" | "ics";
}

/** A regular weekly slot (Stud.IP cycle date) or a personal schedule entry. */
export interface WeeklySlot {
  id: string;
  courseId: string | null;
  courseTitle: string;
  /** ISO weekday 1 = Monday … 7 = Sunday. */
  weekday: number;
  /** "HH:MM" Berlin wall clock. */
  startTime: string;
  endTime: string;
  locations: string[];
  /** 1 = weekly, 2 = every other week, … */
  intervalWeeks: number;
  firstDate: string | null;
  lastDate: string | null;
  exdates: string[];
  description: string | null;
  /** Dominant date type of this cycle when known (from the course's dates). */
  category: string | null;
  kind: "course" | "personal";
  source: "schedule" | "derived";
}

export interface Holiday {
  /** YYYY-MM-DD */
  date: string;
  name: string;
  /** Statutory public holiday (Stud.IP "mandatory") — no lectures. */
  official: boolean;
}

// ---------------------------------------------------------------------------
// Normalisers (pure)
// ---------------------------------------------------------------------------

const KIND_RULES: Array<[RegExp, DateKind]> = [
  [/klausur|prüfung|pruefung|exam|nachholtermin/i, "exam"],
  [/vorbesprechung|einführung|kick-?off/i, "preliminary"],
  [/sondersitzung|zusatz/i, "extra"],
  [/exkursion|excursion/i, "excursion"],
  [/praktikum|labor|lab\b/i, "lab"],
  [/übung|uebung|tutorium|tutorial|exercise|repetitorium/i, "exercise"],
  [/vorlesung|lecture/i, "lecture"],
  [/sitzung|session|seminar/i, "session"],
];

/** Map Stud.IP's date type name (or a title) to a coarse kind. */
export function classifyDateKind(category: string | null | undefined, title?: string | null): DateKind {
  for (const text of [category, title]) {
    if (!text) continue;
    for (const [re, kind] of KIND_RULES) if (re.test(text)) return kind;
  }
  return "other";
}

/**
 * `/courses/{id}/events` item (type `course-events`) → CourseDate.
 * Also reads the pre-6.0 spellings (`start-date`, `category`, `course` relationship).
 */
export function normalizeCourseEvent(
  resource: JsonApiResource,
  context: { courseId?: string; courseTitle?: string } = {},
): CourseDate | null {
  const start = berlinIso(first(resource, "start", "start-date", "begin"));
  if (!start) return null;
  const end = berlinIso(first(resource, "end", "end-date")) ?? start;
  const category = str(first(resource, "categories", "category"));
  const rawTitle = str(first(resource, "title")) ?? "";
  const courseId = context.courseId ?? relId(resource, "owner") ?? relId(resource, "course");
  const description = str(first(resource, "description"));
  return {
    id: resource.id,
    courseId: courseId ?? null,
    courseTitle: context.courseTitle ?? rawTitle,
    start,
    end,
    location: str(first(resource, "location", "room")),
    cancelled: Boolean(first(resource, "is-cancelled", "cancelled")),
    kind: classifyDateKind(category, description),
    category,
    typeId: num(first(resource, "type")),
    description,
    recurrence: str(first(resource, "recurrence")),
    source: "live",
  };
}

/** `/users/{id}/events` item (type `calendar-events`, personal calendar) → CourseDate. */
export function normalizeCalendarEvent(resource: JsonApiResource): CourseDate | null {
  const start = berlinIso(first(resource, "start", "start-date"));
  if (!start) return null;
  const owner = resource.relationships?.owner?.data;
  const ownerIsCourse = !!owner && !Array.isArray(owner) && owner.type === "courses";
  return {
    id: resource.id,
    courseId: ownerIsCourse ? relId(resource, "owner") : null,
    courseTitle: str(first(resource, "title")) ?? "Termin",
    start,
    end: berlinIso(first(resource, "end", "end-date")) ?? start,
    location: str(first(resource, "location")),
    cancelled: false,
    kind: ownerIsCourse ? classifyDateKind(str(first(resource, "categories"))) : "personal",
    category: str(first(resource, "categories", "category")),
    typeId: null,
    description: str(first(resource, "description")),
    recurrence: str(first(resource, "recurrence")),
    source: "live",
  };
}

function hhmmOf(value: unknown): string | null {
  const s = str(value);
  if (!s) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(s);
  if (m) return `${m[1]!.padStart(2, "0")}:${m[2]}`;
  const n = Number(s); // legacy "1015" style
  if (Number.isInteger(n) && n >= 0 && n < 2400) {
    return `${String(Math.floor(n / 100)).padStart(2, "0")}:${String(n % 100).padStart(2, "0")}`;
  }
  return null;
}

/**
 * `/users/{id}/schedule` item → WeeklySlot.
 *
 * The route mixes two types: `seminar-cycle-dates` (your courses' regular
 * dates; the course is the **`owner`** relationship) and `schedule-entries`
 * (entries you added yourself; `owner` is you). Times are "HH:MM" plus a
 * weekday — there is no `start-date`.
 */
export function normalizeScheduleItem(
  resource: JsonApiResource,
  courseTitles: Map<string, string> | Record<string, string> = {},
): WeeklySlot | null {
  const weekday = isoWeekday(first(resource, "weekday", "dow"));
  const startTime = hhmmOf(first(resource, "start", "start-time"));
  const endTime = hhmmOf(first(resource, "end", "end-time")) ?? startTime;
  if (!weekday || !startTime || !endTime) return null;

  const owner = resource.relationships?.owner?.data ?? resource.relationships?.course?.data;
  const ownerRef = owner && !Array.isArray(owner) ? owner : null;
  const isCourse = resource.type === "seminar-cycle-dates" || ownerRef?.type === "courses";
  const courseId = isCourse ? (ownerRef?.id ?? null) : null;
  const titles = courseTitles instanceof Map ? courseTitles : new Map(Object.entries(courseTitles));
  const rawTitle = str(first(resource, "title")) ?? (isCourse ? "Veranstaltung" : "Eigener Eintrag");

  const rec = (first(resource, "recurrence") ?? {}) as Record<string, unknown>;
  const interval = num(rec.INTERVAL ?? rec.interval);
  const locations = arrayish(first(resource, "locations", "location"))
    .map((l) => str(l))
    .filter((l): l is string => !!l);

  return {
    id: resource.id,
    courseId,
    courseTitle: (courseId && titles.get(courseId)) || rawTitle,
    weekday,
    startTime,
    endTime,
    locations: [...new Set(locations)],
    intervalWeeks: interval && interval > 0 ? interval : 1,
    firstDate: berlinIso(rec.DTSTART ?? rec.dtstart),
    lastDate: berlinIso(rec.UNTIL ?? rec.until),
    exdates: arrayish(rec.EXDATES ?? rec.EXDATE ?? rec.exdates)
      .map((d) => berlinIso(d))
      .filter((d): d is string => !!d),
    description: str(first(resource, "description")),
    category: null,
    kind: isCourse ? "course" : "personal",
    source: "schedule",
  };
}

/** `/holidays` (plain JSON `{ "YYYY-MM-DD": { holiday, mandatory } }`) → sorted Holiday[]. */
export function normalizeHolidays(raw: unknown): Holiday[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const out: Holiday[] = [];
  for (const [date, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const v = (value ?? {}) as Record<string, unknown>;
    const name = str(v.holiday) ?? str(v.name) ?? (typeof value === "string" ? value : null);
    if (!name) continue;
    out.push({ date, name, official: v.mandatory === true || v.mandatory === 1 || v.mandatory === "1" });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export function compareSlots(a: WeeklySlot, b: WeeklySlot): number {
  return a.weekday - b.weekday || a.startTime.localeCompare(b.startTime) || a.courseTitle.localeCompare(b.courseTitle, "de");
}

/** Today's calendar key in Berlin. */
export function todayKey(now = new Date()): string {
  return dateKey(now);
}

// ---------------------------------------------------------------------------
// Resource
// ---------------------------------------------------------------------------

export class PlanningResource {
  constructor(private client: StudIpClient) {}

  /** Instance origin, e.g. https://digicampus.uni-augsburg.de */
  get instanceOrigin(): string {
    return originOf(this.client.apiBase);
  }

  /** Every date of a course (regular + single + cancelled), oldest first. */
  async courseDates(courseId: string, courseTitle?: string): Promise<CourseDate[]> {
    const page = await this.client.paginate(`/courses/${courseId}/events`, { page: { limit: 100 } });
    return page.data
      .map((r) => normalizeCourseEvent(r, { courseId, courseTitle }))
      .filter((d): d is CourseDate => !!d)
      .sort((a, b) => a.start.localeCompare(b.start));
  }

  /** Personal Stud.IP calendar entries for the 14 days from `from` (route limit). */
  async personalEvents(userId: string, from: Date): Promise<CourseDate[]> {
    const page = await this.client.paginate(`/users/${userId}/events`, {
      filter: { timestamp: Math.floor(from.getTime() / 1000) },
      page: { limit: 100 },
    });
    return page.data.map(normalizeCalendarEvent).filter((d): d is CourseDate => !!d);
  }

  /**
   * Your regular weekly plan for the semester containing `at` (default: current):
   * cycles of every course you are in plus your own schedule entries.
   * Not paginated — the route rejects `page[...]` with 400.
   */
  async weeklySchedule(
    userId: string,
    options: { at?: Date; courseTitles?: Map<string, string> | Record<string, string> } = {},
  ): Promise<WeeklySlot[]> {
    const filter = options.at ? { timestamp: Math.floor(options.at.getTime() / 1000) } : undefined;
    const doc = await this.client.get(`/users/${userId}/schedule`, { filter });
    return listOf(doc)
      .map((r) => normalizeScheduleItem(r, options.courseTitles))
      .filter((s): s is WeeklySlot => !!s)
      .sort(compareSlots);
  }

  /** Holidays between two calendar days (inclusive). Public route, no login. */
  async holidays(fromKey: string, toKey: string): Promise<Holiday[]> {
    const years: number[] = [];
    for (let y = Number(fromKey.slice(0, 4)); y <= Number(toKey.slice(0, 4)); y++) years.push(y);
    const lists = await Promise.all(
      years.map(async (year) => normalizeHolidays(await this.client.get(`/holidays`, { filter: { year } }))),
    );
    return lists.flat().filter((h) => h.date >= fromKey && h.date <= toKey);
  }
}
