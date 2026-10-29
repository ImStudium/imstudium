import { describe, expect, it } from "vitest";
import { courseArg, parseDuration, parseLimit, parseSince, workspaceDir } from "./args.js";
import { berlinDate, berlinDateTime, berlinDayMonth, berlinIsoMinute, berlinWeekday, cell, courseLabel, daysLeftLabel, table, truncate } from "./format.js";

describe("format kit: Europe/Berlin whatever the machine's zone", () => {
  // 2026-10-25 is the DST switch: 00:30 UTC is 02:30 CEST, 01:30 UTC is 02:30 CET.
  it("formats dates in Berlin wall-clock time", () => {
    expect(berlinDate("2026-10-19T23:30:00Z")).toBe("20.10.2026");
    expect(berlinDayMonth("2026-10-19T23:30:00Z")).toBe("20.10.");
    expect(berlinDateTime("2026-10-20T08:00:00Z")).toBe("20.10.2026 10:00");
    expect(berlinDateTime("2026-10-27T09:00:00Z")).toBe("27.10.2026 10:00");
    expect(berlinIsoMinute("2026-10-20T08:00:00Z")).toBe("2026-10-20 10:00");
    expect(berlinWeekday("2026-10-20T08:00:00Z")).toBe("Di 20.10.");
    expect(berlinWeekday("2026-10-20T08:00:00Z", { time: true })).toBe("Di 20.10. 10:00");
  });

  it("falls back for missing or invalid dates", () => {
    expect(berlinDate(undefined)).toBe("?");
    expect(berlinDate("not a date", "—")).toBe("—");
    expect(berlinIsoMinute(null)).toBe("");
  });

  it("truncates and pads columns", () => {
    expect(truncate("Datenbanksysteme", 8)).toBe("Datenba…");
    expect(cell("abc", 5)).toBe("abc  ");
    expect(courseLabel(null, 4)).toBe("    ");
    expect(table([["a", "bb", "x"], ["ccc", "d", "y"]], { indent: " " })).toEqual([" a    bb  x", " ccc  d   y"]);
  });

  it("labels days left in German", () => {
    expect([daysLeftLabel(-2), daysLeftLabel(0), daysLeftLabel(1), daysLeftLabel(5), daysLeftLabel(null)]).toEqual([
      "2 d überfällig",
      "heute",
      "morgen",
      "in 5 d",
      "",
    ]);
  });
});

describe("args kit", () => {
  it("one duration grammar; bad input fails instead of a silent default", () => {
    expect(parseDuration("30m")).toBe(30 * 60_000);
    expect(parseDuration("30min")).toBe(30 * 60_000);
    expect(parseDuration("1h")).toBe(3_600_000);
    expect(parseDuration("2d")).toBe(2 * 86_400_000);
    for (const bad of ["1x", "hourly", "", "3mo"]) expect(() => parseDuration(bad), bad).toThrow(/Cannot read --interval/);
    expect(() => parseDuration("10s", "interval", { min: 60_000 })).toThrow(/too short/);
  });

  it("--since uses the same units", () => {
    const now = new Date("2026-10-20T12:00:00Z");
    expect(parseSince("30m", now).toISOString()).toBe("2026-10-20T11:30:00.000Z");
    expect(parseSince("1w", now).toISOString()).toBe("2026-10-13T12:00:00.000Z");
  });

  it("--limit is strict", () => {
    expect(parseLimit(undefined, 10)).toBe(10);
    expect(parseLimit("5", 10)).toBe(5);
    for (const bad of ["0", "-1", "abc", "1.5", "5x"]) {
      expect(() => parseLimit(bad, 10), bad).toThrow(expect.objectContaining({ code: "BAD_ARGS" }));
    }
    expect(parseLimit("0", 1, "depth", 0)).toBe(0);
  });

  it("--course wins over the positional; -o wins over the config workspace", () => {
    expect(courseArg("stat", {})).toBe("stat");
    expect(courseArg("stat", { course: "db" })).toBe("db");
    expect(workspaceDir({ workspacePath: "/w" }, {})).toBe("/w");
    expect(workspaceDir({ workspacePath: "/w" }, { output: "/x" })).toBe("/x");
  });
});
