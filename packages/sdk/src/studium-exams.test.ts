import { describe, expect, it } from "vitest";
import { extractExamDatesForTest } from "./studium.js";
import { COURSE_A, courseEvent } from "./test/planning-fixtures.js";

describe("exam dates from Stud.IP 6 course events", () => {
  it("uses the date type, start and skips cancelled exams", () => {
    const events = [
      courseEvent("lecture", COURSE_A, "2026-10-19T10:00:00+02:00", "2026-10-19T11:30:00+02:00"),
      courseEvent("exam", COURSE_A, "2027-02-10T09:00:00+01:00", "2027-02-10T11:00:00+01:00", { categories: "Klausur", location: "Hörsaal B" }),
      courseEvent("old", COURSE_A, "2027-02-03T09:00:00+01:00", "2027-02-03T11:00:00+01:00", { categories: "Klausur", "is-cancelled": true }),
    ];
    const exams = extractExamDatesForTest(COURSE_A, "Beispielkurs", events);
    expect(exams).toEqual([
      {
        courseId: COURSE_A,
        courseTitle: "Beispielkurs",
        date: "2027-02-10T09:00:00+01:00",
        title: "Klausur",
        location: "Hörsaal B",
        confirmed: true,
        source: "event",
      },
    ]);
  });

  it("does not flag every date of a course whose name contains an exam word", () => {
    const events = [
      courseEvent("s1", COURSE_A, "2026-10-19T10:00:00+02:00", "2026-10-19T11:30:00+02:00", { title: "Prüfungsvorbereitung Mathematik" }),
    ];
    expect(extractExamDatesForTest(COURSE_A, "Prüfungsvorbereitung Mathematik", events)).toEqual([]);
  });

  it("keeps reading legacy start-date/category events", () => {
    const legacy = [{ attributes: { title: "Klausur", "start-date": "2026-07-20T09:00:00+02:00", category: "" } }];
    expect(extractExamDatesForTest(COURSE_A, "Beispielkurs", legacy)[0]).toMatchObject({ date: "2026-07-20T09:00:00+02:00", title: "Klausur" });
  });
});
