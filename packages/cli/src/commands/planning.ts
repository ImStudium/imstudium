import { join, resolve } from "node:path";
import type { Command } from "commander";
import {
  addDays,
  buildTimetable,
  dateKey,
  dayLabel,
  findCurrentSemester,
  germanDate,
  hhmm,
  ImstudiumError,
  isDateKey,
  isOfflineError,
  offlinePlanningSnapshot,
  resolveSemesterByLabel,
  rhythmLabel,
  syncPlanning,
  weekRange,
  writeStundenplanMarkdown,
  WEEKDAYS_SHORT_DE,
  type CourseDate,
  type CourseRefLite,
  type PlanningSnapshot,
  type SemesterLite,
  type Timetable,
  type TimetableDay,
  type TimetableOptions,
  type TimetableSources,
} from "@imstudium/sdk";
import { act, getSdk, note, output, type Sdk } from "../runtime.js";
import { meId } from "../me.js";
import { currentCourses } from "../course-arg.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export function icsPath(sdk: Sdk, override?: string): string {
  return override ? resolve(override) : join(sdk.workspacePath, "calendar.ics");
}

/** "2026-10-20", "20.10.", "20.10.2026", "heute", "morgen" → YYYY-MM-DD (Berlin). */
export function parseDayArg(input: string | undefined, now = new Date()): string {
  const today = dateKey(now);
  if (!input) return today;
  const s = input.trim().toLowerCase();
  if (s === "heute" || s === "today") return today;
  if (s === "morgen" || s === "tomorrow") return addDays(today, 1);
  if (s === "gestern" || s === "yesterday") return addDays(today, -1);
  if (isDateKey(s)) return s;
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})?$/.exec(s);
  if (m) {
    const year = m[3] ?? today.slice(0, 4);
    return `${year}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  }
  throw new ImstudiumError(`Unrecognised date "${input}"`, "BAD_ARGS", undefined, "Use YYYY-MM-DD, DD.MM. or heute/morgen");
}

function semesterLite(s: { id: string; attributes?: Record<string, unknown> } | null): SemesterLite | null {
  if (!s) return null;
  const a = (s.attributes ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  return {
    id: s.id,
    title: str(a.title),
    start: str(a.start),
    end: str(a.end),
    startOfLectures: str(a["start-of-lectures"]),
    endOfLectures: str(a["end-of-lectures"]),
  };
}

/** Semester by label ("WS 2026/27", "all") or the calendar-current one. `/semesters` is public. */
export async function resolveSemester(sdk: Sdk, label?: string): Promise<SemesterLite | null> {
  if (label && label.toLowerCase() === "all") return null;
  try {
    const all = await sdk.courses.semesters.listAll();
    const hit = label ? resolveSemesterByLabel(all, label) : findCurrentSemester(all);
    if (label && !hit) {
      throw new ImstudiumError(`No semester matches "${label}"`, "SEMESTER_NOT_FOUND", 404, "imstudium semesters lists them");
    }
    return semesterLite(hit);
  } catch (err) {
    if (err instanceof ImstudiumError && err.code === "SEMESTER_NOT_FOUND") throw err;
    return null;
  }
}

export async function workspaceCourses(sdk: Sdk): Promise<CourseRefLite[]> {
  const ws = await sdk.studium.loadWorkspace(sdk.workspacePath).catch(() => null);
  return (ws?.courses ?? []).map((c) => ({ id: c.id, title: c.title, number: c.courseNumber ?? null }));
}

export function timetableSources(sdk: Sdk): TimetableSources {
  return {
    planning: sdk.planning,
    courses: async () => (await currentCourses(sdk)).map((c) => ({ id: c.id, title: c.title })),
    userId: () => meId(sdk),
  };
}

function isAllDay(e: CourseDate): boolean {
  return hhmm(new Date(e.start)) === "00:00" && hhmm(new Date(e.end)) === "00:00";
}

/** "10:00–11:30 · Data Engineering (Vorlesung) · HS I" (+ cancelled / running markers). */
export function formatEntry(e: CourseDate, now = new Date()): string {
  const start = new Date(e.start);
  const end = new Date(e.end);
  const time = isAllDay(e) ? "ganztägig" : `${hhmm(start)}–${hhmm(end)}`;
  const title = `${e.courseTitle}${e.category ? ` (${e.category})` : ""}`;
  const loc = e.location ? ` · ${e.location}` : "";
  if (e.cancelled) return `✗ ${time} · ${title}${loc} — fällt aus`;
  const running = start.getTime() <= now.getTime() && now.getTime() < end.getTime() ? "  ◀ jetzt" : "";
  return `${time} · ${title}${loc}${running}`;
}

function formatDays(days: TimetableDay[], now: Date, options: { showEmpty?: boolean } = {}): string[] {
  const lines: string[] = [];
  for (const day of days) {
    const head = day.label.padEnd(10);
    const pad = " ".repeat(head.length);
    const holiday = day.holiday?.official ? `Feiertag: ${day.holiday.name}` : null;
    if (!day.entries.length) {
      if (holiday) lines.push(`${head} ${holiday}`);
      else if (options.showEmpty) lines.push(`${head} —`);
      continue;
    }
    let firstLine = true;
    if (holiday) {
      lines.push(`${head} ${holiday}`);
      firstLine = false;
    }
    for (const e of day.entries) {
      lines.push(`${firstLine ? head : pad} ${formatEntry(e, now)}`);
      firstLine = false;
    }
  }
  return lines;
}

function isoWeekNumber(key: string): number {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

function sourceNote(tt: { source: string; stale: boolean; icsUpdatedAt: string | null; warnings: string[] }) {
  if (tt.stale) {
    const when = tt.icsUpdatedAt ? ` (Stand ${germanDate(dateKey(new Date(tt.icsUpdatedAt)))})` : "";
    note(`Offline: Termine aus calendar.ics${when} — Ausfälle seit dem Export fehlen evtl.`);
  }
  for (const w of tt.warnings) note(`Hinweis: ${w}`);
}

function timetableJson(tt: Timetable) {
  return {
    from: tt.from,
    to: tt.to,
    source: tt.source,
    stale: tt.stale,
    icsUpdatedAt: tt.icsUpdatedAt,
    warnings: tt.warnings,
    days: tt.days,
  };
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export function registerPlanning(program: Command): void {
  program
    .command("today")
    .description("Today's dates across all current courses (cancelled ones marked)")
    .option("--date <day>", "Another day: YYYY-MM-DD, DD.MM. or morgen")
    .option("--offline", "Use the cached calendar.ics instead of Stud.IP")
    .option("--ics <file>", "Calendar file for --offline (default: <workspace>/calendar.ics)")
    .action(
      act(async (opts: { date?: string; offline?: boolean; ics?: string }) => {
        const sdk = await getSdk();
        const now = new Date();
        const day = parseDayArg(opts.date, now);
        // Look ahead two weeks so an empty day can point to the next date.
        const ttOpts: TimetableOptions = {
          from: day,
          to: addDays(day, 13),
          offline: opts.offline,
          icsPath: icsPath(sdk, opts.ics),
          knownCourses: await workspaceCourses(sdk),
        };
        const tt = await buildTimetable(timetableSources(sdk), ttOpts);
        const today = tt.days[0]!;
        const next = tt.entries.find((e) => !e.cancelled && Date.parse(e.start) > now.getTime() && dateKey(new Date(e.start)) > day) ?? null;
        sourceNote(tt);

        const lines = [`${day === dateKey(now) ? "Heute" : "Tag"} · ${dayLabel(day)}${day.slice(0, 4)}`];
        if (today.holiday?.official) lines.push(`Feiertag: ${today.holiday.name}`);
        if (!today.entries.length) lines.push("Keine Termine.");
        for (const e of today.entries) lines.push(`  ${formatEntry(e, now)}`);
        if (next && (!today.entries.length || today.entries.every((e) => Date.parse(e.end) <= now.getTime()))) {
          lines.push("", `Als Nächstes: ${dayLabel(dateKey(new Date(next.start)))} ${formatEntry(next, now)}`);
        }
        output({ ...timetableJson({ ...tt, to: day, days: [today] }), date: day, entries: today.entries, next }, lines.join("\n"));
      }),
    );

  program
    .command("week")
    .description("This week's dates, grouped by day (Mo–So)")
    .option("--next", "Next week")
    .option("--from <day>", "Week containing this day (YYYY-MM-DD or DD.MM.)")
    .option("--offline", "Use the cached calendar.ics instead of Stud.IP")
    .option("--ics <file>", "Calendar file for --offline (default: <workspace>/calendar.ics)")
    .action(
      act(async (opts: { next?: boolean; from?: string; offline?: boolean; ics?: string }) => {
        const sdk = await getSdk();
        const now = new Date();
        const range = weekRange(parseDayArg(opts.from, now), opts.next ? 1 : 0);
        const tt = await buildTimetable(timetableSources(sdk), {
          ...range,
          offline: opts.offline,
          icsPath: icsPath(sdk, opts.ics),
          knownCourses: await workspaceCourses(sdk),
        });
        sourceNote(tt);
        const count = tt.entries.filter((e) => !e.cancelled).length;
        const cancelled = tt.entries.length - count;
        const lines = [
          `KW ${isoWeekNumber(range.from)} · ${dayLabel(range.from)}–${germanDate(range.to)} · ${count} ${count === 1 ? "Termin" : "Termine"}${cancelled ? `, ${cancelled} ${cancelled === 1 ? "fällt" : "fallen"} aus` : ""}`,
          "",
          ...formatDays(tt.days, now),
        ];
        if (!tt.entries.length) lines.push("Keine Termine in dieser Woche.");
        output(timetableJson(tt), lines.join("\n"));
      }),
    );

  program
    .command("stundenplan")
    .description("Your regular weekly plan (cycles), single dates and cancellations")
    .option("--save", "Write <workspace>/stundenplan.md")
    .option("--semester <name>", "Semester title, e.g. \"WS 2026/27\" (default: current)")
    .option("--offline", "Derive the plan from the cached calendar.ics")
    .option("--ics <file>", "Calendar file for --offline (default: <workspace>/calendar.ics)")
    .action(
      act(async (opts: { save?: boolean; semester?: string; offline?: boolean; ics?: string }) => {
        const sdk = await getSdk();
        const semester = await resolveSemester(sdk, opts.semester);
        let snapshot: PlanningSnapshot;
        let offlineFrom: string | null = null;
        const offline = async (reason?: string) => {
          if (reason) note(`Hinweis: ${reason} — Stundenplan aus calendar.ics abgeleitet`);
          const snap = await offlinePlanningSnapshot(icsPath(sdk, opts.ics), {
            knownCourses: await workspaceCourses(sdk),
            semester,
          });
          offlineFrom = snap.icsUpdatedAt;
          return snap;
        };
        if (opts.offline) {
          snapshot = await offline();
        } else {
          try {
            const courses = await currentCourses(sdk);
            snapshot = await syncPlanning(
              {
                planning: sdk.planning,
                userId: await meId(sdk),
                courses: courses.map((c) => ({ id: c.id, title: c.title })),
                semester,
              },
              null,
              { write: false },
            );
          } catch (err) {
            if (!isOfflineError(err)) throw err;
            snapshot = await offline(err instanceof Error ? err.message : String(err));
          }
        }
        if (opts.save) snapshot.markdownPath = await writeStundenplanMarkdown(sdk.workspacePath, snapshot);
        for (const w of snapshot.warnings) note(`Hinweis: ${w}`);

        const lines: string[] = [];
        const lectures =
          semester?.startOfLectures && semester.endOfLectures
            ? ` · Vorlesungszeit ${germanDate(dateKey(new Date(semester.startOfLectures)))}–${germanDate(dateKey(new Date(semester.endOfLectures)))}`
            : "";
        lines.push(`Stundenplan${semester?.title ? ` · ${semester.title}` : ""}${lectures}`, "");
        if (!snapshot.weekly.length) lines.push("Keine regelmäßigen Termine gefunden.");
        let lastDay = 0;
        for (const s of snapshot.weekly) {
          const dayCol = s.weekday !== lastDay ? WEEKDAYS_SHORT_DE[s.weekday - 1]! : "";
          lastDay = s.weekday;
          const parts = [s.courseTitle, s.category ?? (s.kind === "personal" ? "eigener Eintrag" : null), s.locations.join(", ") || null];
          if (s.intervalWeeks > 1) parts.push(rhythmLabel(s.intervalWeeks));
          lines.push(`${dayCol.padEnd(3)} ${s.startTime}–${s.endTime}  ${parts.filter(Boolean).join(" · ")}`);
        }
        const singles = snapshot.upcomingSingles.slice(0, 12);
        if (singles.length) {
          lines.push("", "Einzeltermine");
          for (const d of singles) lines.push(`  ${dayLabel(dateKey(new Date(d.start)))} ${formatEntry(d)}`);
          if (snapshot.upcomingSingles.length > singles.length) {
            lines.push(`  … ${snapshot.upcomingSingles.length - singles.length} weitere (--json)`);
          }
        }
        const cancels = snapshot.upcomingCancellations.slice(0, 8);
        if (cancels.length) {
          lines.push("", "Ausfälle");
          for (const d of cancels) lines.push(`  ${dayLabel(dateKey(new Date(d.start)))} ${formatEntry(d)}`);
        }
        if (offlineFrom) lines.push("", `(offline aus calendar.ics, Stand ${germanDate(dateKey(new Date(offlineFrom)))})`);
        if (snapshot.markdownPath) lines.push("", `Gespeichert: ${snapshot.markdownPath}`);
        output({ ...snapshot, source: offlineFrom ? "ics" : "live" }, lines.join("\n"));
      }),
    );

  program
    .command("holidays")
    .description("Public holidays and the lecture period (no lectures on Feiertage)")
    .option("--year <year>", "A whole calendar year")
    .option("--all", "Include commemorative days (Muttertag, Advent …)")
    .action(
      act(async (opts: { year?: string; all?: boolean }) => {
        const sdk = await getSdk();
        const today = dateKey(new Date());
        const semester = await resolveSemester(sdk);
        let from: string;
        let to: string;
        if (opts.year) {
          from = `${opts.year}-01-01`;
          to = `${opts.year}-12-31`;
        } else {
          from = today;
          to = semester?.end ? dateKey(new Date(semester.end)) : addDays(today, 180);
        }
        const all = await sdk.planning.holidays(from, to);
        const holidays = opts.all ? all : all.filter((h) => h.official);
        const lectures =
          semester?.startOfLectures && semester.endOfLectures
            ? `Vorlesungszeit ${germanDate(dateKey(new Date(semester.startOfLectures)))}–${germanDate(dateKey(new Date(semester.endOfLectures)))}`
            : null;
        const lines = [
          `Feiertage ${germanDate(from)}–${germanDate(to)}${semester?.title && !opts.year ? ` · ${semester.title}` : ""}`,
          ...(lectures && !opts.year ? [lectures] : []),
          "",
          ...holidays.map((h) => `${dayLabel(h.date)}${h.date.slice(0, 4)}  ${h.name}${h.official ? "" : " (kein Feiertag)"}`),
        ];
        if (!holidays.length) lines.push("Keine Feiertage im Zeitraum.");
        output({ from, to, semester, holidays }, lines.join("\n"));
      }),
    );
}

/** @internal — tests */
export const planningTextForTest = { formatDays, isoWeekNumber };
