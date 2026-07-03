import { describe, it, expect } from "vitest";
import { extractExamDatesForTest, computeDaysRemaining } from "./studium.js";

describe("extractExamDates", () => {
  it("detects Klausur from course events", () => {
    const exams = extractExamDatesForTest(
      "c1",
      "Analysis II",
      [{ attributes: { title: "Klausur Analysis", "start-date": "2026-08-15T10:00:00+02:00", location: "H101" } }],
      {},
    );
    expect(exams).toHaveLength(1);
    expect(exams[0].confirmed).toBe(true);
    expect(exams[0].source).toBe("event");
    expect(exams[0].title).toContain("Klausur");
  });

  it("flags achievement text as unconfirmed", () => {
    const exams = extractExamDatesForTest("c1", "Statistik", [], {
      achievement: "Klausur am Ende des Semesters",
    });
    expect(exams.some((e) => !e.confirmed && e.source === "achievement")).toBe(true);
  });

  it("ignores non-exam events", () => {
    const exams = extractExamDatesForTest(
      "c1",
      "Tutorium",
      [{ attributes: { title: "Übung 3", "start-date": "2026-07-10T10:00:00+02:00" } }],
      {},
    );
    expect(exams).toHaveLength(0);
  });

  it("detects exam from miscellaneous field", () => {
    const exams = extractExamDatesForTest("c1", "Physik", [], {
      miscellaneous: "Prüfung am 12.08.",
    });
    expect(exams).toHaveLength(1);
    expect(exams[0].source).toBe("miscellaneous");
    expect(exams[0].confirmed).toBe(false);
  });

  it("deduplicates event and achievement mentions", () => {
    const exams = extractExamDatesForTest(
      "c1",
      "LA",
      [{ attributes: { title: "Klausur LA", "start-date": "2026-09-01T10:00:00+02:00" } }],
      { achievement: "Klausur am Ende" },
    );
    expect(exams.length).toBeGreaterThanOrEqual(1);
    expect(exams.some((e) => e.confirmed)).toBe(true);
  });
});

describe("computeDaysRemaining", () => {
  it("computes days until exam", () => {
    const future = new Date();
    future.setDate(future.getDate() + 10);
    const days = computeDaysRemaining(future.toISOString());
    expect(days).toBeGreaterThanOrEqual(9);
    expect(days).toBeLessThanOrEqual(11);
  });
});
