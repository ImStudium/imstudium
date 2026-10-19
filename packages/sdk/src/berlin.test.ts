import { describe, expect, it } from "vitest";
import {
  addDays,
  berlinIso,
  dateKey,
  dayLabel,
  hhmm,
  isoWeekday,
  mondayOf,
  startOfDay,
  toZonedIso,
  weekdayOf,
  zonedTimeToDate,
} from "./berlin.js";

describe("Europe/Berlin helpers", () => {
  it("converts wall clock to instants on both sides of the October DST switch", () => {
    expect(zonedTimeToDate(2026, 10, 24, 10, 0).toISOString()).toBe("2026-10-24T08:00:00.000Z");
    expect(zonedTimeToDate(2026, 10, 26, 10, 0).toISOString()).toBe("2026-10-26T09:00:00.000Z");
  });

  it("resolves the spring gap forward", () => {
    // 02:30 does not exist on 2027-03-28 in Berlin.
    expect(toZonedIso(zonedTimeToDate(2027, 3, 28, 2, 30))).toBe("2027-03-28T03:30:00+02:00");
  });

  it("formats ISO with the right offset", () => {
    expect(toZonedIso(new Date("2026-10-20T08:00:00Z"))).toBe("2026-10-20T10:00:00+02:00");
    expect(toZonedIso(new Date("2026-12-01T08:00:00Z"))).toBe("2026-12-01T09:00:00+01:00");
    expect(berlinIso("2026-10-20T10:00:00+02:00")).toBe("2026-10-20T10:00:00+02:00");
    expect(berlinIso("nonsense")).toBeNull();
    expect(berlinIso(1792483200)).toBe(toZonedIso(new Date(1792483200 * 1000)));
  });

  it("groups by Berlin calendar day, not UTC", () => {
    // 23:30 UTC on the 19th is already the 20th in Berlin.
    expect(dateKey(new Date("2026-10-19T23:30:00Z"))).toBe("2026-10-20");
    expect(hhmm(new Date("2026-10-19T23:30:00Z"))).toBe("01:30");
    expect(startOfDay("2026-10-20").toISOString()).toBe("2026-10-19T22:00:00.000Z");
  });

  it("does calendar arithmetic on day keys", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(weekdayOf("2026-10-19")).toBe(1);
    expect(weekdayOf("2026-10-25")).toBe(7);
    expect(mondayOf("2026-10-25")).toBe("2026-10-19");
    expect(dayLabel("2026-10-20")).toBe("Di 20.10.");
  });

  it("maps Stud.IP weekday numbers to ISO", () => {
    expect(isoWeekday(0)).toBe(7);
    expect(isoWeekday("1")).toBe(1);
    expect(isoWeekday(9)).toBeNull();
  });
});
