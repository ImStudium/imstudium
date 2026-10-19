import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ImstudiumError } from "./errors.js";
import { PlanningResource, type CourseDate, type WeeklySlot } from "./resources/planning.js";
import {
  buildCourseSchedule,
  buildTimetable,
  courseScheduleFromResources,
  deriveWeeklySlots,
  groupByDay,
  icsToCourseDates,
  matchCourseBySummary,
  offlinePlanningSnapshot,
  renderStundenplanMarkdown,
  syncPlanning,
  weekRange,
} from "./timetable.js";
import { parseIcs } from "./ics.js";
import { COURSE_A, COURSE_B, courseEvent, cycleDate, fakeClient, ME, personalEntry } from "./test/planning-fixtures.js";

function date(partial: Partial<CourseDate> & { start: string; end: string }): CourseDate {
  return {
    id: partial.start,
    courseId: COURSE_A,
    courseTitle: "Beispielkurs",
    location: null,
    cancelled: false,
    kind: "lecture",
    category: "Vorlesung",
    typeId: 1,
    description: null,
    recurrence: null,
    source: "live",
    ...partial,
  };
}

/** Weekly Monday 10:00–11:30 lecture from 12.10.2026, n weeks; week index `cancel` cancelled. */
function mondays(n: number, cancel?: number): CourseDate[] {
  const out: CourseDate[] = [];
  for (let i = 0; i < n; i++) {
    const day = new Date(Date.UTC(2026, 9, 12 + i * 7));
    const ymd = day.toISOString().slice(0, 10);
    const off = ymd < "2026-10-25" ? "+02:00" : "+01:00";
    out.push(
      date({
        id: `m${i}`,
        start: `${ymd}T10:00:00${off}`,
        end: `${ymd}T11:30:00${off}`,
        cancelled: i === cancel,
        location: "Hörsaal A",
        recurrence: "Montag: 10:00 - 11:30, wöchentlich",
      }),
    );
  }
  return out;
}

describe("groupByDay", () => {
  it("groups by Berlin day (late UTC dates move to the next day) and keeps empty days", () => {
    const days = groupByDay(
      [
        date({ start: "2026-10-20T08:00:00+02:00", end: "2026-10-20T09:30:00+02:00" }),
        date({ start: "2026-10-19T22:30:00Z", end: "2026-10-19T23:30:00Z", courseTitle: "Nachtkurs" }),
        date({ start: "2026-10-19T10:00:00+02:00", end: "2026-10-19T11:30:00+02:00" }),
      ],
      "2026-10-19",
      "2026-10-21",
      [{ date: "2026-10-21", name: "Testfeiertag", official: true }],
    );
    expect(days.map((d) => [d.label, d.entries.length])).toEqual([
      ["Mo 19.10.", 1],
      ["Di 20.10.", 2],
      ["Mi 21.10.", 0],
    ]);
    // 00:30 Berlin sorts before 08:00
    expect(days[1]!.entries.map((e) => e.courseTitle)).toEqual(["Nachtkurs", "Beispielkurs"]);
    expect(days[2]!.holiday?.name).toBe("Testfeiertag");
  });

  it("computes Monday–Sunday weeks", () => {
    expect(weekRange("2026-10-22")).toEqual({ from: "2026-10-19", to: "2026-10-25" });
    expect(weekRange("2026-10-22", 1)).toEqual({ from: "2026-10-26", to: "2026-11-01" });
  });
});

describe("deriveWeeklySlots", () => {
  it("keeps a weekly slot weekly despite a cancelled week, across DST", () => {
    const slots = deriveWeeklySlots(mondays(6, 2));
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({
      weekday: 1,
      startTime: "10:00",
      endTime: "11:30",
      intervalWeeks: 1,
      locations: ["Hörsaal A"],
      category: "Vorlesung",
      exdates: ["2026-10-26T10:00:00+01:00"],
      source: "derived",
    });
  });

  it("detects biweekly slots and ignores one-off dates", () => {
    const biweekly = mondays(8).filter((_, i) => i % 2 === 0);
    const once = date({ start: "2026-10-23T12:00:00+02:00", end: "2026-10-23T13:00:00+02:00", category: "Vorbesprechung" });
    const slots = deriveWeeklySlots([...biweekly.map((d) => ({ ...d, recurrence: null })), once]);
    expect(slots.map((s) => [s.weekday, s.intervalWeeks])).toEqual([[1, 2]]);
  });
});

describe("course schedule (studium.json)", () => {
  it("fixes the empty schedule: cycles come from the owner relationship of seminar-cycle-dates", () => {
    const schedule = [cycleDate("c1", COURSE_A), cycleDate("c2", COURSE_B, { weekday: 2 }), personalEntry("p")];
    const events = [
      courseEvent("e1", COURSE_A, "2026-10-12T10:00:00+02:00", "2026-10-12T11:30:00+02:00"),
      courseEvent("e2", COURSE_A, "2026-10-19T10:00:00+02:00", "2026-10-19T11:30:00+02:00"),
      courseEvent("e3", COURSE_A, "2026-10-23T12:00:00+02:00", "2026-10-23T13:00:00+02:00", {
        categories: "Vorbesprechung",
        recurrence: "",
        location: "Raum 3",
      }),
    ];
    const entries = courseScheduleFromResources({ id: COURSE_A, title: "Beispielkurs" }, schedule, events);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      type: "regular",
      title: "Vorlesung Mo 10:00–11:30",
      weekday: 1,
      startTime: "10:00",
      endTime: "11:30",
      start: "2026-10-12T10:00:00+02:00",
      until: "2027-02-01T10:00:00+01:00",
      location: "Hörsaal A",
      courseId: COURSE_A,
      courseTitle: "Beispielkurs",
    });
    expect(entries[1]).toMatchObject({
      type: "single",
      title: "Vorbesprechung",
      start: "2026-10-23T12:00:00+02:00",
      location: "Raum 3",
      kind: "preliminary",
    });
  });

  it("derives cycles from dates when /schedule has nothing for the course", () => {
    const entries = buildCourseSchedule({ id: COURSE_A, title: "Beispielkurs" }, [], mondays(4));
    expect(entries.map((e) => [e.type, e.weekday, e.startTime])).toEqual([["regular", 1, "10:00"]]);
  });
});

describe("ICS → dates", () => {
  const ics = [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "UID:Stud.IP-SEM-1@example.test",
    "SUMMARY:1001 Beispielkurs (fällt aus)",
    "DTSTART;TZID=Europe/Berlin:20261019T100000",
    "DTEND;TZID=Europe/Berlin:20261019T113000",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:Stud.IP-SEM-2@example.test",
    "SUMMARY:1001 Beispielkurs",
    "CATEGORIES:Vorlesung",
    "LOCATION:Hörsaal A",
    "DTSTART;TZID=Europe/Berlin:20261026T100000",
    "DTEND;TZID=Europe/Berlin:20261026T113000",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:own-1@example.test",
    "SUMMARY:Lerngruppe",
    "DTSTART;TZID=Europe/Berlin:20261020T180000",
    "DTEND;TZID=Europe/Berlin:20261020T190000",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  it("maps summaries to known courses and marks cancellations and personal entries", () => {
    const dates = icsToCourseDates(parseIcs(ics), new Date("2026-10-01T00:00:00Z"), new Date("2026-11-01T00:00:00Z"), [
      { id: COURSE_A, title: "Beispielkurs", number: "1001" },
    ]);
    expect(dates.map((d) => [d.courseId, d.courseTitle, d.cancelled, d.kind, d.start])).toEqual([
      [COURSE_A, "Beispielkurs", true, "other", "2026-10-19T10:00:00+02:00"],
      [null, "Lerngruppe", false, "personal", "2026-10-20T18:00:00+02:00"],
      [COURSE_A, "Beispielkurs", false, "lecture", "2026-10-26T10:00:00+01:00"],
    ]);
  });

  it("prefers the longest matching course title", () => {
    const courses = [
      { id: "x", title: "Statistik" },
      { id: "y", title: "Übung zu Statistik" },
    ];
    expect(matchCourseBySummary("2003 Übung zu Statistik", courses)?.id).toBe("y");
    expect(matchCourseBySummary("Unbekannt", courses)).toBeNull();
  });

  it("builds an offline Stundenplan snapshot from the file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "imstudium-ics-"));
    writeFileSync(join(dir, "calendar.ics"), ics);
    const snap = await offlinePlanningSnapshot(join(dir, "calendar.ics"), {
      knownCourses: [{ id: COURSE_A, title: "Beispielkurs" }],
      semester: { title: "WS 2026/27", start: "2026-10-01T00:00:00+02:00", end: "2027-03-31T23:59:59+02:00" },
      now: new Date("2026-10-01T00:00:00Z"),
    });
    expect(snap.icsUpdatedAt).toBeTruthy();
    // Two dates of one course on Mondays 10:00 carry no cycle text (ICS) → below the repeat threshold: singles.
    expect(snap.weekly).toHaveLength(0);
    expect(snap.upcomingSingles.map((d) => d.courseTitle)).toEqual(["Beispielkurs", "Lerngruppe", "Beispielkurs"]);
  });
});

describe("buildTimetable", () => {
  function sources(handler: Parameters<typeof fakeClient>[0]) {
    const { client } = fakeClient(handler);
    return {
      planning: new PlanningResource(client),
      courses: async () => [
        { id: COURSE_A, title: "Beispielkurs" },
        { id: COURSE_B, title: "Zweitkurs" },
      ],
      userId: async () => ME,
    };
  }

  it("merges all courses' dates live, clipped to the range, sorted, with holidays", async () => {
    const src = sources((path) => {
      if (path === `/courses/${COURSE_A}/events`) {
        return {
          body: {
            data: [
              courseEvent("a1", COURSE_A, "2026-10-12T10:00:00+02:00", "2026-10-12T11:30:00+02:00"),
              courseEvent("a2", COURSE_A, "2026-10-19T10:00:00+02:00", "2026-10-19T11:30:00+02:00", { "is-cancelled": true }),
            ],
          },
        };
      }
      if (path === `/courses/${COURSE_B}/events`) {
        return { body: { data: [courseEvent("b1", COURSE_B, "2026-10-19T08:15:00+02:00", "2026-10-19T09:45:00+02:00", { categories: "Sitzung" })] } };
      }
      if (path === `/users/${ME}/events`) {
        return {
          body: {
            data: [
              {
                type: "calendar-events",
                id: "k1",
                attributes: { title: "Lerngruppe", start: "2026-10-21T18:00:00+02:00", end: "2026-10-21T19:00:00+02:00" },
                relationships: { owner: { data: { type: "users", id: ME } } },
              },
            ],
          },
        };
      }
      if (path === "/holidays") return { contentType: "application/json", body: { "2026-10-25": { holiday: "Testtag", mandatory: true } } };
      return undefined;
    });
    const tt = await buildTimetable(src, { from: "2026-10-19", to: "2026-10-25" });
    expect(tt.source).toBe("live");
    expect(tt.entries.map((e) => [e.id, e.courseTitle, e.cancelled])).toEqual([
      ["b1", "Zweitkurs", false],
      ["a2", "Beispielkurs", true],
      ["k1", "Lerngruppe", false],
    ]);
    expect(tt.days).toHaveLength(7);
    expect(tt.days[6]!.holiday?.name).toBe("Testtag");
  });

  it("falls back to calendar.ics when logged out", async () => {
    const dir = mkdtempSync(join(tmpdir(), "imstudium-tt-"));
    writeFileSync(
      join(dir, "calendar.ics"),
      [
        "BEGIN:VCALENDAR",
        "BEGIN:VEVENT",
        "UID:Stud.IP-SEM-9@example.test",
        "SUMMARY:Beispielkurs",
        "DTSTART;TZID=Europe/Berlin:20261020T100000",
        "DTEND;TZID=Europe/Berlin:20261020T113000",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n"),
    );
    const { client } = fakeClient(() => ({ status: 401, body: { errors: [{ status: "401", title: "Unauthorized" }] } }));
    const src = {
      planning: new PlanningResource(client),
      courses: async (): Promise<Array<{ id: string; title: string }>> => {
        throw new ImstudiumError("HTTP 401", "HTTP_ERROR", 401);
      },
    };
    const tt = await buildTimetable(src, { from: "2026-10-19", to: "2026-10-25", icsPath: join(dir, "calendar.ics") });
    expect(tt.source).toBe("ics");
    expect(tt.stale).toBe(true);
    expect(tt.entries.map((e) => e.start)).toEqual(["2026-10-20T10:00:00+02:00"]);
    expect(tt.warnings.join(" ")).toMatch(/calendar\.ics/);
  });

  it("explains how to get an offline calendar when none exists", async () => {
    const { client } = fakeClient(() => undefined);
    await expect(
      buildTimetable(
        { planning: new PlanningResource(client), courses: async () => [] },
        { from: "2026-10-19", to: "2026-10-19", offline: true, icsPath: join(tmpdir(), "does-not-exist.ics"), holidays: false },
      ),
    ).rejects.toMatchObject({ code: "NO_ICS" });
  });
});

describe("syncPlanning", () => {
  it("writes stundenplan.md, keeps student notes and returns per-course entries", async () => {
    const dir = mkdtempSync(join(tmpdir(), "imstudium-plan-"));
    writeFileSync(join(dir, "stundenplan.md"), "# Stundenplan\n\n## Student notes\n\nMontags früher los.\n");
    const { client } = fakeClient((path) => {
      if (path === `/users/${ME}/schedule`) return { body: { data: [cycleDate("c1", COURSE_A), personalEntry("p1")] } };
      if (path === `/courses/${COURSE_A}/events`) {
        return {
          body: {
            data: [
              courseEvent("a1", COURSE_A, "2026-10-19T10:00:00+02:00", "2026-10-19T11:30:00+02:00"),
              courseEvent("a2", COURSE_A, "2026-10-26T10:00:00+01:00", "2026-10-26T11:30:00+01:00", { "is-cancelled": true }),
              courseEvent("a3", COURSE_A, "2027-02-10T09:00:00+01:00", "2027-02-10T11:00:00+01:00", { categories: "Klausur", recurrence: "" }),
            ],
          },
        };
      }
      return undefined;
    });
    const snap = await syncPlanning(
      {
        planning: new PlanningResource(client),
        userId: ME,
        courses: [{ id: COURSE_A, title: "Beispielkurs" }],
        semester: { title: "WS 2026/27", startOfLectures: "2026-10-12T00:00:00+02:00", endOfLectures: "2027-02-05T23:59:59+01:00" },
      },
      dir,
      { now: new Date("2026-10-20T12:00:00Z") },
    );
    expect(snap.weekly.map((s) => [s.weekday, s.courseTitle, s.category])).toEqual([
      [1, "Beispielkurs", "Vorlesung"],
      [3, "Lerngruppe", null],
    ]);
    expect(snap.byCourse[COURSE_A]!.map((e) => e.type)).toEqual(["regular", "single"]);
    expect(snap.upcomingSingles.map((d) => d.category)).toEqual(["Klausur"]);
    expect(snap.upcomingCancellations.map((d) => d.id)).toEqual(["a2"]);

    const md = readFileSync(join(dir, "stundenplan.md"), "utf-8");
    expect(md).toContain("# Stundenplan — WS 2026/27");
    expect(md).toContain("Vorlesungszeit 12.10.2026–05.02.2027");
    expect(md).toContain("| Mo | 10:00–11:30 | Beispielkurs | Vorlesung | Hörsaal A | wöchentlich |");
    expect(md).toContain("| Mi | 18:00–19:30 | Lerngruppe | eigener Eintrag | — | wöchentlich |");
    expect(md).toContain("Mi 10.02. 09:00–11:00 · Beispielkurs (Klausur)");
    expect(md).toContain("## Ausfälle");
    expect(md).toContain("## Student notes\n\nMontags früher los.");
  });

  it("renders an empty plan helpfully", () => {
    const md = renderStundenplanMarkdown({
      generatedAt: "2026-10-19T12:00:00+02:00",
      semester: null,
      weekly: [] as WeeklySlot[],
      byCourse: {},
      upcomingSingles: [],
      upcomingCancellations: [],
      warnings: [],
    });
    expect(md).toContain("_Keine regelmäßigen Termine gefunden._");
  });
});
