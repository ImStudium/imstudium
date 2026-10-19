import { describe, expect, it } from "vitest";
import type { CourseDate, TimetableDay } from "@imstudium/sdk";
import { formatEntry, parseDayArg, planningTextForTest } from "./planning.js";

const now = new Date("2026-10-19T08:30:00Z"); // Mo 19.10.2026 10:30 Berlin

function entry(partial: Partial<CourseDate>): CourseDate {
  return {
    id: "e",
    courseId: "c",
    courseTitle: "Beispielkurs",
    start: "2026-10-19T10:00:00+02:00",
    end: "2026-10-19T11:30:00+02:00",
    location: "Hörsaal A",
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

describe("parseDayArg", () => {
  it("understands ISO, German dates and words", () => {
    expect(parseDayArg(undefined, now)).toBe("2026-10-19");
    expect(parseDayArg("morgen", now)).toBe("2026-10-20");
    expect(parseDayArg("2026-11-02", now)).toBe("2026-11-02");
    expect(parseDayArg("3.11.", now)).toBe("2026-11-03");
    expect(parseDayArg("03.11.2027", now)).toBe("2027-11-03");
    expect(() => parseDayArg("next friday", now)).toThrow(/Unrecognised/);
  });
});

describe("formatEntry", () => {
  it("prints time · course (Art) · room and marks the running date", () => {
    expect(formatEntry(entry({}), now)).toBe("10:00–11:30 · Beispielkurs (Vorlesung) · Hörsaal A  ◀ jetzt");
    expect(formatEntry(entry({ start: "2026-10-19T14:00:00+02:00", end: "2026-10-19T15:30:00+02:00", location: null, category: null }), now)).toBe(
      "14:00–15:30 · Beispielkurs",
    );
  });

  it("marks cancelled dates", () => {
    expect(formatEntry(entry({ cancelled: true }), now)).toBe("✗ 10:00–11:30 · Beispielkurs (Vorlesung) · Hörsaal A — fällt aus");
  });
});

describe("week text", () => {
  it("prints day label once per day and holidays", () => {
    const days: TimetableDay[] = [
      { date: "2026-10-19", weekday: 1, label: "Mo 19.10.", holiday: null, entries: [entry({}), entry({ start: "2026-10-19T14:00:00+02:00", end: "2026-10-19T15:30:00+02:00" })] },
      { date: "2026-10-20", weekday: 2, label: "Di 20.10.", holiday: null, entries: [] },
      { date: "2026-10-21", weekday: 3, label: "Mi 21.10.", holiday: { date: "2026-10-21", name: "Testfeiertag", official: true }, entries: [] },
    ];
    expect(planningTextForTest.formatDays(days, new Date("2026-10-18T00:00:00Z"))).toEqual([
      "Mo 19.10.  10:00–11:30 · Beispielkurs (Vorlesung) · Hörsaal A",
      "           14:00–15:30 · Beispielkurs (Vorlesung) · Hörsaal A",
      "Mi 21.10.  Feiertag: Testfeiertag",
    ]);
    expect(planningTextForTest.isoWeekNumber("2026-10-19")).toBe(43);
    expect(planningTextForTest.isoWeekNumber("2027-01-01")).toBe(53);
  });
});
