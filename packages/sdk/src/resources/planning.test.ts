import { describe, expect, it } from "vitest";
import type { JsonApiResource } from "../types.js";
import {
  classifyDateKind,
  normalizeCalendarEvent,
  normalizeCourseEvent,
  normalizeHolidays,
  normalizeScheduleItem,
  PlanningResource,
} from "./planning.js";
import { COURSE_A, courseEvent, cycleDate, fakeClient, ME, personalEntry } from "../test/planning-fixtures.js";

describe("classifyDateKind", () => {
  it("maps Stud.IP date type names", () => {
    expect(classifyDateKind("Vorlesung")).toBe("lecture");
    expect(classifyDateKind("Klausur")).toBe("exam");
    expect(classifyDateKind("Vorbesprechung")).toBe("preliminary");
    expect(classifyDateKind("Sondersitzung")).toBe("extra");
    expect(classifyDateKind("Sitzung")).toBe("session");
    expect(classifyDateKind(null, "Übung zu Analysis")).toBe("exercise");
    expect(classifyDateKind("anderer Termin")).toBe("other");
  });
});

describe("normalizeCourseEvent", () => {
  it("reads Stud.IP 6.1 course-events (start/end/categories/is-cancelled/owner)", () => {
    const d = normalizeCourseEvent(
      courseEvent("e1", COURSE_A, "2026-10-26T10:00:00+01:00", "2026-10-26T11:30:00+01:00", { "is-cancelled": true }),
    )!;
    expect(d).toMatchObject({
      id: "e1",
      courseId: COURSE_A,
      start: "2026-10-26T10:00:00+01:00",
      end: "2026-10-26T11:30:00+01:00",
      location: "Hörsaal A",
      cancelled: true,
      kind: "lecture",
      category: "Vorlesung",
      typeId: 1,
      source: "live",
    });
  });

  it("still reads the pre-6.0 spellings and normalises to Berlin", () => {
    const legacy: JsonApiResource = {
      type: "events",
      id: "old",
      attributes: { title: "Alt", "start-date": "2026-10-20T08:00:00Z", "end-date": "2026-10-20T09:30:00Z", category: "Klausur" },
      relationships: { course: { data: { type: "courses", id: COURSE_A } } },
    };
    expect(normalizeCourseEvent(legacy, { courseTitle: "Beispielkurs" })).toMatchObject({
      courseId: COURSE_A,
      courseTitle: "Beispielkurs",
      start: "2026-10-20T10:00:00+02:00",
      kind: "exam",
      cancelled: false,
    });
  });

  it("returns null without a start", () => {
    expect(normalizeCourseEvent({ type: "course-events", id: "x", attributes: {} })).toBeNull();
  });
});

describe("normalizeScheduleItem", () => {
  it("reads seminar-cycle-dates: owner course, HH:MM + weekday, EXDATES object", () => {
    const slot = normalizeScheduleItem(cycleDate("c1", COURSE_A), { [COURSE_A]: "Beispielkurs" })!;
    expect(slot).toMatchObject({
      courseId: COURSE_A,
      courseTitle: "Beispielkurs",
      weekday: 1,
      startTime: "10:00",
      endTime: "11:30",
      intervalWeeks: 1,
      locations: ["Hörsaal A"],
      firstDate: "2026-10-12T10:00:00+02:00",
      lastDate: "2027-02-01T10:00:00+01:00",
      exdates: ["2026-10-26T10:00:00+01:00"],
      kind: "course",
      source: "schedule",
    });
  });

  it("reads biweekly cycles and Sunday as 0", () => {
    const slot = normalizeScheduleItem(
      cycleDate("c2", COURSE_A, { weekday: 0, recurrence: { FREQ: "WEEKLY", INTERVAL: 2 } }),
    )!;
    expect(slot.weekday).toBe(7);
    expect(slot.intervalWeeks).toBe(2);
    expect(slot.courseTitle).toBe("1001 Beispielkurs");
  });

  it("reads personal schedule-entries (owner is the user)", () => {
    expect(normalizeScheduleItem(personalEntry("p1"))).toMatchObject({
      courseId: null,
      courseTitle: "Lerngruppe",
      weekday: 3,
      startTime: "18:00",
      kind: "personal",
      description: "Bibliothek",
    });
  });
});

describe("normalizeCalendarEvent", () => {
  it("marks user-owned calendar entries as personal", () => {
    const d = normalizeCalendarEvent({
      type: "calendar-events",
      id: "k1",
      attributes: { title: "Zahnarzt", start: "2026-10-21T09:00:00+02:00", end: "2026-10-21T10:00:00+02:00", categories: "Sonstiges" },
      relationships: { owner: { data: { type: "users", id: ME } } },
    })!;
    expect(d.kind).toBe("personal");
    expect(d.courseId).toBeNull();
  });
});

describe("normalizeHolidays", () => {
  it("reads the plain-JSON /holidays map, sorted", () => {
    expect(
      normalizeHolidays({
        "2026-12-26": { holiday: "2. Weihnachtstag", mandatory: true },
        "2026-10-03": { holiday: "Tag der Einheit", mandatory: true },
        "2026-11-11": { holiday: "Martinstag", mandatory: false },
        broken: { holiday: "x" },
      }),
    ).toEqual([
      { date: "2026-10-03", name: "Tag der Einheit", official: true },
      { date: "2026-11-11", name: "Martinstag", official: false },
      { date: "2026-12-26", name: "2. Weihnachtstag", official: true },
    ]);
    expect(normalizeHolidays(null)).toEqual([]);
  });
});

describe("PlanningResource (fake client)", () => {
  it("fetches /schedule without page params (the route rejects them with 400)", async () => {
    const { client, calls } = fakeClient((path, q) => {
      if (path === `/users/${ME}/schedule`) {
        if (q.has("page[limit]")) return { status: 400, body: { errors: [{ status: "400", title: "Page parameter limit is not allowed." }] } };
        return { body: { data: [cycleDate("c1", COURSE_A), personalEntry("p1")] } };
      }
      return undefined;
    });
    const slots = await new PlanningResource(client).weeklySchedule(ME, { courseTitles: { [COURSE_A]: "Beispielkurs" } });
    expect(slots.map((s) => [s.weekday, s.courseTitle])).toEqual([
      [1, "Beispielkurs"],
      [3, "Lerngruppe"],
    ]);
    expect(calls[0]).toBe(`/users/${ME}/schedule`);
  });

  it("loads holidays per year and clips to the range", async () => {
    const { client } = fakeClient((path, q) =>
      path === "/holidays"
        ? {
            contentType: "application/json",
            body:
              q.get("filter[year]") === "2026"
                ? { "2026-10-03": { holiday: "Einheit", mandatory: true }, "2026-12-25": { holiday: "Weihnachten", mandatory: true } }
                : { "2027-01-01": { holiday: "Neujahr", mandatory: true }, "2027-05-01": { holiday: "Mai", mandatory: true } },
          }
        : undefined,
    );
    const h = await new PlanningResource(client).holidays("2026-10-19", "2027-03-31");
    expect(h.map((x) => x.date)).toEqual(["2026-12-25", "2027-01-01"]);
  });
});

