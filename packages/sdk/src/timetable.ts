/**
 * Timetable model: concrete dates per day (today / week views), the regular
 * weekly plan (Stundenplan), and per-course schedule entries for studium.json.
 *
 * Live data comes from `/courses/{id}/events` (every date incl. cancelled ones)
 * and `/users/{id}/schedule` (regular cycles). Offline, the Stud.IP ICS export
 * in the workspace is the fallback.
 */
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  addDays,
  dateKey,
  dayLabel,
  germanDate,
  hhmm,
  startOfDay,
  toZonedIso,
  WEEKDAYS_SHORT_DE,
  weekdayOf,
} from "./berlin.js";
import { ImstudiumError } from "./errors.js";
import { expandIcs, parseIcs, type IcsEvent } from "./ics.js";
import type { JsonApiResource } from "./types.js";
import {
  classifyDateKind,
  compareSlots,
  isOfflineError,
  normalizeCourseEvent,
  normalizeScheduleItem,
  type CourseDate,
  type DateKind,
  type Holiday,
  type PlanningResource,
  type WeeklySlot,
} from "./resources/planning.js";

export interface CourseRefLite {
  id: string;
  title: string;
  number?: string | null;
}

export interface TimetableDay {
  /** YYYY-MM-DD (Berlin) */
  date: string;
  weekday: number;
  /** "Mo 20.10." */
  label: string;
  holiday: Holiday | null;
  entries: CourseDate[];
}

export interface Timetable {
  /** First and last calendar day (inclusive), Berlin. */
  from: string;
  to: string;
  source: "live" | "ics";
  /** True when the ICS fallback was used instead of live data. */
  stale: boolean;
  icsUpdatedAt: string | null;
  warnings: string[];
  days: TimetableDay[];
  entries: CourseDate[];
}

/**
 * Per-course schedule entry for studium.json. Structurally a superset of
 * `StudiumScheduleEntry` (title/start/end/location/courseId/courseTitle), so
 * it can be assigned to `StudiumCourse.schedule` directly.
 */
export interface CourseScheduleEntry {
  title: string;
  start?: string;
  end?: string;
  location?: string;
  courseId?: string;
  courseTitle?: string;
  type: "regular" | "single";
  /** regular: ISO weekday 1–7 and "HH:MM" Berlin wall clock. */
  weekday?: number;
  startTime?: string;
  endTime?: string;
  intervalWeeks?: number;
  /** regular: last date of the cycle (ISO). */
  until?: string;
  category?: string | null;
  kind?: DateKind;
  cancelled?: boolean;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function rhythmLabel(intervalWeeks: number): string {
  if (intervalWeeks <= 1) return "wöchentlich";
  if (intervalWeeks === 2) return "14-täglich";
  return `alle ${intervalWeeks} Wochen`;
}

/** Dates overlapping [from, to). */
export function filterRange<T extends { start: string; end: string }>(dates: T[], from: Date, to: Date): T[] {
  const lo = from.getTime();
  const hi = to.getTime();
  return dates.filter((d) => {
    const s = Date.parse(d.start);
    const e = Math.max(Date.parse(d.end), s + 1);
    return s < hi && e > lo;
  });
}

export function sortDates<T extends { start: string; courseTitle?: string }>(dates: T[]): T[] {
  return [...dates].sort(
    (a, b) => Date.parse(a.start) - Date.parse(b.start) || (a.courseTitle ?? "").localeCompare(b.courseTitle ?? "", "de"),
  );
}

/** Every calendar day from `fromKey` to `toKey` (inclusive), with that day's entries in Berlin time. */
export function groupByDay(entries: CourseDate[], fromKey: string, toKey: string, holidays: Holiday[] = []): TimetableDay[] {
  const byDay = new Map<string, CourseDate[]>();
  for (const e of sortDates(entries)) {
    const key = dateKey(new Date(e.start));
    const list = byDay.get(key) ?? [];
    list.push(e);
    byDay.set(key, list);
  }
  const holidayByDay = new Map(holidays.map((h) => [h.date, h]));
  const days: TimetableDay[] = [];
  for (let key = fromKey; key <= toKey; key = addDays(key, 1)) {
    days.push({
      date: key,
      weekday: weekdayOf(key),
      label: dayLabel(key),
      holiday: holidayByDay.get(key) ?? null,
      entries: byDay.get(key) ?? [],
    });
  }
  return days;
}

/** Pick the known course whose title best matches an ICS summary ("5004 Data Engineering" → Data Engineering). */
export function matchCourseBySummary(summary: string, courses: CourseRefLite[]): CourseRefLite | null {
  const s = summary.toLowerCase();
  let best: CourseRefLite | null = null;
  for (const c of courses) {
    const t = c.title.trim().toLowerCase();
    if (!t) continue;
    const hit = s === t || s.endsWith(` ${t}`) || s.startsWith(`${t} `) || s.includes(t) ||
      (!!c.number && s.startsWith(`${c.number.toLowerCase()} `));
    if (hit && (!best || t.length > best.title.length)) best = c;
  }
  return best;
}

/** ICS events → CourseDate occurrences in [from, to). */
export function icsToCourseDates(events: IcsEvent[], from: Date, to: Date, courses: CourseRefLite[] = []): CourseDate[] {
  // Stud.IP exports course dates with UID "Stud.IP-SEM-<id>@host"; anything else is a personal calendar entry.
  const studip = events.some((e) => e.uid?.startsWith("Stud.IP-SEM-"));
  return expandIcs(events, from, to).map(({ event, start, end }) => {
    const course = matchCourseBySummary(event.summary, courses);
    const category = event.categories[0] ?? null;
    const personal = studip && !event.uid?.startsWith("Stud.IP-SEM-") && !course;
    return {
      id: `${event.uid ?? "ics"}@${start.toISOString()}`,
      courseId: course?.id ?? null,
      courseTitle: course?.title ?? event.summary,
      start: toZonedIso(start),
      end: toZonedIso(end),
      location: event.location ?? null,
      cancelled: event.cancelled,
      kind: personal ? ("personal" as const) : classifyDateKind(category, event.summary),
      category,
      typeId: null,
      description: event.description ?? null,
      recurrence: event.rrule ? `RRULE ${event.rrule.freq}` : null,
      source: "ics" as const,
    };
  });
}

function mostCommon<T>(values: T[]): T | null {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: T | null = null;
  let bestN = 0;
  for (const [v, n] of counts) if (n > bestN) [best, bestN] = [v, n];
  return best;
}

function slotKeyOf(d: CourseDate): string {
  const start = new Date(d.start);
  return `${d.courseId ?? d.courseTitle}|${weekdayOf(dateKey(start))}|${hhmm(start)}|${hhmm(new Date(d.end))}`;
}

/**
 * Derive regular weekly slots from concrete dates: dates of one course on the
 * same weekday and time form a slot when they repeat (≥ `minRepeats`) or carry
 * Stud.IP's cycle text. Used offline (ICS) and when /schedule is unavailable.
 */
export function deriveWeeklySlots(dates: CourseDate[], minRepeats = 3): WeeklySlot[] {
  const groups = new Map<string, CourseDate[]>();
  for (const d of dates) {
    if (d.kind === "personal") continue;
    const key = slotKeyOf(d);
    const list = groups.get(key) ?? [];
    list.push(d);
    groups.set(key, list);
  }
  const slots: WeeklySlot[] = [];
  for (const [key, list] of groups) {
    const sorted = sortDates(list);
    const cyclic = sorted.some((d) => d.recurrence && !d.recurrence.startsWith("RRULE"));
    if (!cyclic && sorted.length < minRepeats) continue;
    const first = sorted[0]!;
    const last = sorted[sorted.length - 1]!;
    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      const weeks = Math.round((Date.parse(sorted[i]!.start) - Date.parse(sorted[i - 1]!.start)) / (7 * 86_400_000));
      if (weeks > 0) gaps.push(weeks);
    }
    const [, wd, startTime, endTime] = key.split("|");
    const live = sorted.filter((d) => !d.cancelled);
    slots.push({
      id: `derived:${key}`,
      courseId: first.courseId,
      courseTitle: first.courseTitle,
      weekday: Number(wd),
      startTime: startTime!,
      endTime: endTime!,
      locations: [...new Set(live.map((d) => d.location).filter((l): l is string => !!l))],
      // Smallest gap: a skipped or cancelled week must not turn a weekly slot into a biweekly one.
      intervalWeeks: gaps.length ? Math.min(...gaps) : 1,
      firstDate: first.start,
      lastDate: last.start,
      exdates: sorted.filter((d) => d.cancelled).map((d) => d.start),
      description: null,
      category: mostCommon(live.map((d) => d.category).filter((c): c is string => !!c)),
      kind: "course",
      source: "derived",
    });
  }
  return slots.sort(compareSlots);
}

/** Does a concrete date fall on this weekly slot? */
export function dateMatchesSlot(d: CourseDate, slot: WeeklySlot): boolean {
  if (slot.courseId && d.courseId && slot.courseId !== d.courseId) return false;
  if (!slot.courseId && slot.courseTitle !== d.courseTitle) return false;
  const start = new Date(d.start);
  return weekdayOf(dateKey(start)) === slot.weekday && hhmm(start) === slot.startTime;
}

/** Fill category/locations/first/last of schedule slots from the course's real dates. */
export function enrichSlots(slots: WeeklySlot[], dates: CourseDate[]): WeeklySlot[] {
  return slots.map((slot) => {
    const matching = dates.filter((d) => dateMatchesSlot(d, slot));
    if (!matching.length) return slot;
    const live = matching.filter((d) => !d.cancelled);
    const sorted = sortDates(matching);
    return {
      ...slot,
      category: slot.category ?? mostCommon(live.map((d) => d.category).filter((c): c is string => !!c)),
      locations: slot.locations.length
        ? slot.locations
        : [...new Set(live.map((d) => d.location).filter((l): l is string => !!l))],
      firstDate: slot.firstDate ?? sorted[0]!.start,
      lastDate: slot.lastDate ?? sorted[sorted.length - 1]!.start,
    };
  });
}

function ownDates(course: CourseRefLite, dates: CourseDate[]): CourseDate[] {
  return dates.filter((d) => d.courseId === course.id || (!d.courseId && d.courseTitle === course.title));
}

/**
 * Regular slots of one course: the `/schedule` cycles when Stud.IP has them,
 * otherwise derived from the course's dates; enriched with category/rooms.
 */
export function slotsForCourse(course: CourseRefLite, slots: WeeklySlot[], dates: CourseDate[]): WeeklySlot[] {
  const own = ownDates(course, dates);
  let courseSlots = slots.filter((s) => s.courseId === course.id);
  if (!courseSlots.length) {
    const cyclic = own.filter((d) => d.recurrence && !d.recurrence.startsWith("RRULE"));
    courseSlots = deriveWeeklySlots(cyclic.length ? cyclic : own);
  }
  return enrichSlots(courseSlots, own);
}

/**
 * The schedule of one course: its regular cycles (from `/schedule` slots, or
 * derived from the dates) plus single dates that are not part of a cycle
 * (Vorbesprechung, Klausur, Sondersitzung …).
 */
export function buildCourseSchedule(
  course: CourseRefLite,
  slots: WeeklySlot[],
  dates: CourseDate[],
): CourseScheduleEntry[] {
  const own = ownDates(course, dates);
  const courseSlots = slotsForCourse(course, slots, own);

  const regular: CourseScheduleEntry[] = courseSlots.map((slot) => {
    const firstDate = sortDates(own.filter((d) => dateMatchesSlot(d, slot)))[0];
    const label = slot.category ?? "Termin";
    const rhythm = slot.intervalWeeks > 1 ? ` (${rhythmLabel(slot.intervalWeeks)})` : "";
    return {
      title: `${label} ${WEEKDAYS_SHORT_DE[slot.weekday - 1]} ${slot.startTime}–${slot.endTime}${rhythm}`,
      start: firstDate?.start ?? slot.firstDate ?? undefined,
      end: firstDate?.end ?? undefined,
      location: slot.locations.join(", ") || undefined,
      courseId: course.id,
      courseTitle: course.title,
      type: "regular",
      weekday: slot.weekday,
      startTime: slot.startTime,
      endTime: slot.endTime,
      intervalWeeks: slot.intervalWeeks,
      until: slot.lastDate ?? undefined,
      category: slot.category,
      kind: classifyDateKind(slot.category, slot.description),
    };
  });

  const single: CourseScheduleEntry[] = sortDates(own)
    .filter((d) => !courseSlots.some((s) => dateMatchesSlot(d, s)))
    .map((d) => ({
      title: d.category ?? "Termin",
      start: d.start,
      end: d.end,
      location: d.location ?? undefined,
      courseId: course.id,
      courseTitle: course.title,
      type: "single" as const,
      category: d.category,
      kind: d.kind,
      cancelled: d.cancelled || undefined,
    }));

  return [...regular, ...single];
}

/**
 * Drop-in for StudiumBuilder: raw `/users/{id}/schedule` + `/courses/{id}/events`
 * resources → this course's schedule entries. Pure, no network.
 */
export function courseScheduleFromResources(
  course: CourseRefLite,
  scheduleResources: JsonApiResource[],
  eventResources: JsonApiResource[],
): CourseScheduleEntry[] {
  const slots = scheduleResources
    .map((r) => normalizeScheduleItem(r, { [course.id]: course.title }))
    .filter((s): s is WeeklySlot => !!s && s.courseId === course.id);
  const dates = eventResources
    .map((r) => normalizeCourseEvent(r, { courseId: course.id, courseTitle: course.title }))
    .filter((d): d is CourseDate => !!d);
  return buildCourseSchedule(course, slots, dates);
}

// ---------------------------------------------------------------------------
// Live / offline timetable
// ---------------------------------------------------------------------------

export interface TimetableSources {
  planning: PlanningResource;
  /** Courses of the focus semester (workspace or live). */
  courses: () => Promise<CourseRefLite[]>;
  /** Your user id — enables personal Stud.IP calendar entries. */
  userId?: () => Promise<string>;
}

export interface TimetableOptions {
  /** First and last calendar day (inclusive), YYYY-MM-DD Berlin. */
  from: string;
  to: string;
  offline?: boolean;
  /** Stud.IP ICS export, e.g. <workspace>/calendar.ics */
  icsPath?: string;
  includePersonal?: boolean;
  holidays?: boolean;
  /** Courses for matching ICS summaries offline. */
  knownCourses?: CourseRefLite[];
}

async function loadIcs(path: string | undefined): Promise<{ events: IcsEvent[]; updatedAt: string | null }> {
  if (!path) {
    throw new ImstudiumError("No offline calendar configured", "NO_ICS", undefined, "Run imstudium export calendar");
  }
  let text: string;
  let updatedAt: string | null = null;
  try {
    text = await readFile(path, "utf-8");
    updatedAt = toZonedIso((await stat(path)).mtime);
  } catch {
    throw new ImstudiumError(
      `No offline calendar at ${path}`,
      "NO_ICS",
      undefined,
      "Run imstudium export calendar while online to cache your Stud.IP calendar.",
    );
  }
  return { events: parseIcs(text), updatedAt };
}

/** Timetable from the ICS file only. */
export async function icsTimetable(options: TimetableOptions, warnings: string[] = []): Promise<Timetable> {
  const from = startOfDay(options.from);
  const to = startOfDay(addDays(options.to, 1));
  const { events, updatedAt } = await loadIcs(options.icsPath);
  const entries = sortDates(icsToCourseDates(events, from, to, options.knownCourses));
  return {
    from: options.from,
    to: options.to,
    source: "ics",
    stale: true,
    icsUpdatedAt: updatedAt,
    warnings,
    days: groupByDay(entries, options.from, options.to),
    entries,
  };
}

/**
 * Merge all current courses' dates (live) for a day range, plus personal
 * calendar entries and holidays. Falls back to the ICS export when offline
 * or logged out.
 */
export async function buildTimetable(sources: TimetableSources, options: TimetableOptions): Promise<Timetable> {
  const warnings: string[] = [];
  const from = startOfDay(options.from);
  const to = startOfDay(addDays(options.to, 1));

  const holidaysP: Promise<Holiday[]> =
    options.holidays === false
      ? Promise.resolve([])
      : sources.planning.holidays(options.from, options.to, { offline: options.offline }).catch(() => {
          warnings.push("holidays unavailable");
          return [];
        });

  if (options.offline) {
    const tt = await icsTimetable(options, warnings);
    const holidays = await holidaysP;
    return { ...tt, days: groupByDay(tt.entries, options.from, options.to, holidays) };
  }

  let entries: CourseDate[] = [];
  try {
    const courses = await sources.courses();
    const perCourse = await Promise.all(
      courses.map(async (c) => {
        try {
          return await sources.planning.courseDates(c.id, c.title);
        } catch (err) {
          if (isOfflineError(err)) throw err;
          warnings.push(`${c.title}: ${err instanceof Error ? err.message : String(err)}`);
          return [];
        }
      }),
    );
    entries = filterRange(perCourse.flat(), from, to);

    if (options.includePersonal !== false && sources.userId) {
      try {
        const uid = await sources.userId();
        const personal: CourseDate[] = [];
        for (let key = options.from; key <= options.to; key = addDays(key, 14)) {
          personal.push(...(await sources.planning.personalEvents(uid, startOfDay(key))));
        }
        const seen = new Set(entries.map((e) => `${e.start}|${e.courseId ?? e.courseTitle}`));
        const seenIds = new Set<string>();
        for (const p of filterRange(personal, from, to)) {
          const key = `${p.start}|${p.courseId ?? p.courseTitle}`;
          if (seen.has(key) || seenIds.has(`${p.id}|${p.start}`)) continue;
          seenIds.add(`${p.id}|${p.start}`);
          entries.push(p);
        }
      } catch (err) {
        if (isOfflineError(err)) throw err;
        warnings.push("personal calendar unavailable");
      }
    }
  } catch (err) {
    if (!isOfflineError(err)) throw err;
    warnings.push(`live data unavailable (${err instanceof Error ? err.message : String(err)}) — using calendar.ics`);
    const tt = await icsTimetable(options, warnings);
    const holidays = await holidaysP;
    return { ...tt, days: groupByDay(tt.entries, options.from, options.to, holidays) };
  }

  const sorted = sortDates(entries);
  const holidays = await holidaysP;
  return {
    from: options.from,
    to: options.to,
    source: "live",
    stale: false,
    icsUpdatedAt: null,
    warnings,
    days: groupByDay(sorted, options.from, options.to, holidays),
    entries: sorted,
  };
}

/** Monday–Sunday of the week containing `key` (+ `offsetWeeks`). */
export function weekRange(key: string, offsetWeeks = 0): { from: string; to: string } {
  const monday = addDays(addDays(key, 1 - weekdayOf(key)), offsetWeeks * 7);
  return { from: monday, to: addDays(monday, 6) };
}

// ---------------------------------------------------------------------------
// Stundenplan snapshot for the workspace
// ---------------------------------------------------------------------------

export interface SemesterLite {
  id?: string;
  title?: string;
  start?: string;
  end?: string;
  startOfLectures?: string;
  endOfLectures?: string;
}

export interface PlanningSnapshot {
  generatedAt: string;
  semester: SemesterLite | null;
  weekly: WeeklySlot[];
  /** Per course id — assign to StudiumCourse.schedule. */
  byCourse: Record<string, CourseScheduleEntry[]>;
  /** Single (non-cycle) dates from today on: Vorbesprechung, Klausur, Sondersitzung … */
  upcomingSingles: CourseDate[];
  /** Cancelled regular dates from today on. */
  upcomingCancellations: CourseDate[];
  warnings: string[];
  /** Written file, when a workspace dir was given. */
  markdownPath?: string;
}

export interface SyncPlanningDeps {
  planning: PlanningResource;
  userId: string;
  courses: CourseRefLite[];
  semester?: SemesterLite | null;
}

/**
 * Fetch the weekly plan and every course's dates, compute per-course schedule
 * entries and write `<workspaceDir>/stundenplan.md` (student notes preserved).
 * One `/schedule` call plus one `/events` call per course.
 */
export async function syncPlanning(
  deps: SyncPlanningDeps,
  workspaceDir: string | null,
  options: { now?: Date; write?: boolean } = {},
): Promise<PlanningSnapshot> {
  const now = options.now ?? new Date();
  const warnings: string[] = [];
  const titles = Object.fromEntries(deps.courses.map((c) => [c.id, c.title]));
  const at = deps.semester?.start ? new Date(Date.parse(deps.semester.start) + 86_400_000) : undefined;

  let slots: WeeklySlot[] = [];
  try {
    slots = await deps.planning.weeklySchedule(deps.userId, { at, courseTitles: titles });
  } catch (err) {
    if (isOfflineError(err)) throw err;
    warnings.push(`schedule: ${err instanceof Error ? err.message : String(err)}`);
  }

  const datesByCourse = new Map<string, CourseDate[]>();
  await Promise.all(
    deps.courses.map(async (c) => {
      try {
        datesByCourse.set(c.id, await deps.planning.courseDates(c.id, c.title));
      } catch (err) {
        if (isOfflineError(err)) throw err;
        warnings.push(`${c.title}: ${err instanceof Error ? err.message : String(err)}`);
        datesByCourse.set(c.id, []);
      }
    }),
  );

  const byCourse: Record<string, CourseScheduleEntry[]> = {};
  const weekly: WeeklySlot[] = [];
  const singles: CourseDate[] = [];
  const cancellations: CourseDate[] = [];
  for (const c of deps.courses) {
    const dates = datesByCourse.get(c.id) ?? [];
    byCourse[c.id] = buildCourseSchedule(c, slots, dates);
    const courseSlots = slotsForCourse(c, slots, dates);
    weekly.push(...courseSlots);
    for (const d of dates) {
      if (Date.parse(d.end) < now.getTime()) continue;
      const regular = courseSlots.some((s) => dateMatchesSlot(d, s));
      if (!regular) singles.push(d);
      else if (d.cancelled) cancellations.push(d);
    }
  }
  // Personal schedule entries and cycles of courses not in the list (e.g. added to the plan only).
  const known = new Set(deps.courses.map((c) => c.id));
  weekly.push(...slots.filter((s) => !s.courseId || !known.has(s.courseId)));

  const snapshot: PlanningSnapshot = {
    generatedAt: toZonedIso(now),
    semester: deps.semester ?? null,
    weekly: weekly.sort(compareSlots),
    byCourse,
    upcomingSingles: sortDates(singles),
    upcomingCancellations: sortDates(cancellations),
    warnings,
  };

  if (workspaceDir && options.write !== false) {
    snapshot.markdownPath = await writeStundenplanMarkdown(workspaceDir, snapshot);
  }
  return snapshot;
}

/**
 * Stundenplan from the ICS export alone (offline): regular slots are derived
 * from repeating dates, everything else becomes a single date.
 */
export async function offlinePlanningSnapshot(
  icsPath: string,
  options: { knownCourses?: CourseRefLite[]; semester?: SemesterLite | null; now?: Date } = {},
): Promise<PlanningSnapshot & { icsUpdatedAt: string | null }> {
  const now = options.now ?? new Date();
  const today = dateKey(now);
  const sem = options.semester ?? null;
  const fromKey = sem?.start ? dateKey(new Date(sem.start)) : addDays(today, -14);
  const toKey = sem?.end ? dateKey(new Date(sem.end)) : addDays(today, 180);
  const { events, updatedAt } = await loadIcs(icsPath);
  const dates = icsToCourseDates(events, startOfDay(fromKey), startOfDay(addDays(toKey, 1)), options.knownCourses);
  const weekly = deriveWeeklySlots(dates);
  const upcoming = dates.filter((d) => Date.parse(d.end) >= now.getTime());
  return {
    generatedAt: toZonedIso(now),
    semester: sem,
    weekly,
    byCourse: Object.fromEntries(
      (options.knownCourses ?? []).map((c) => [c.id, buildCourseSchedule(c, weekly, dates)]),
    ),
    upcomingSingles: sortDates(upcoming.filter((d) => !weekly.some((s) => dateMatchesSlot(d, s)))),
    upcomingCancellations: sortDates(upcoming.filter((d) => d.cancelled && weekly.some((s) => dateMatchesSlot(d, s)))),
    warnings: [],
    icsUpdatedAt: updatedAt,
  };
}

/** Write a snapshot as `<dir>/stundenplan.md`, keeping the student's notes section. */
export async function writeStundenplanMarkdown(dir: string, snapshot: PlanningSnapshot): Promise<string> {
  const path = join(dir, "stundenplan.md");
  const notes = await readNotes(path);
  await writeFile(path, renderStundenplanMarkdown(snapshot, notes));
  return path;
}

async function readNotes(path: string): Promise<string | null> {
  try {
    const content = await readFile(path, "utf-8");
    const match = content.match(/## Student notes\n\n([\s\S]*?)(?:\n## |\s*$)/);
    return match?.[1]?.trim() || null;
  } catch {
    return null;
  }
}

function mdCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function dateTimeLine(d: CourseDate): string {
  const start = new Date(d.start);
  const key = dateKey(start);
  const allDay = hhmm(start) === "00:00" && hhmm(new Date(d.end)) === "00:00";
  const time = allDay ? "ganztägig" : `${hhmm(start)}–${hhmm(new Date(d.end))}`;
  return `${dayLabel(key)} ${time}`;
}

/** Markdown Stundenplan: weekly grid as a table, then single dates and cancellations. */
export function renderStundenplanMarkdown(snapshot: PlanningSnapshot, studentNotes?: string | null): string {
  const sem = snapshot.semester;
  const lines: string[] = [`# Stundenplan${sem?.title ? ` — ${sem.title}` : ""}`, ""];
  const lectures =
    sem?.startOfLectures && sem?.endOfLectures
      ? ` · Vorlesungszeit ${germanDate(dateKey(new Date(sem.startOfLectures)))}–${germanDate(dateKey(new Date(sem.endOfLectures)))}`
      : "";
  lines.push(`_Stand: ${germanDate(dateKey(new Date(snapshot.generatedAt)))}${lectures} · Quelle: Stud.IP_`, "");

  lines.push("## Woche", "");
  if (!snapshot.weekly.length) {
    lines.push("_Keine regelmäßigen Termine gefunden._", "");
  } else {
    lines.push("| Tag | Zeit | Veranstaltung | Art | Raum | Rhythmus |", "|---|---|---|---|---|---|");
    for (const s of snapshot.weekly) {
      lines.push(
        `| ${WEEKDAYS_SHORT_DE[s.weekday - 1]} | ${s.startTime}–${s.endTime} | ${mdCell(s.courseTitle)} | ${mdCell(
          s.category ?? (s.kind === "personal" ? "eigener Eintrag" : "—"),
        )} | ${mdCell(s.locations.join(", ") || "—")} | ${rhythmLabel(s.intervalWeeks)} |`,
      );
    }
    lines.push("");
  }

  if (snapshot.upcomingSingles.length) {
    lines.push("## Einzeltermine", "");
    for (const d of snapshot.upcomingSingles) {
      const cancelled = d.cancelled ? " — **fällt aus**" : "";
      lines.push(
        `- ${dateTimeLine(d)} · ${d.courseTitle}${d.category ? ` (${d.category})` : ""}${d.location ? ` · ${d.location}` : ""}${cancelled}`,
      );
    }
    lines.push("");
  }

  if (snapshot.upcomingCancellations.length) {
    lines.push("## Ausfälle", "");
    for (const d of snapshot.upcomingCancellations) {
      lines.push(`- ${dateTimeLine(d)} · ${d.courseTitle}${d.description ? ` — ${d.description}` : ""}`);
    }
    lines.push("");
  }

  lines.push("_Aktualisieren: `imstudium stundenplan --save` · Diese Woche: `imstudium week`_", "");
  if (studentNotes) lines.push("## Student notes", "", studentNotes, "");
  return lines.join("\n");
}
