import { describe, expect, it } from "vitest";
import { expandIcs, parseIcs, parseIcsDate, parseRRule, unescapeIcsText, unfoldIcsLines } from "./ics.js";
import { toZonedIso } from "./berlin.js";

/** Synthetic calendar in the shape Stud.IP exports (CRLF, VTIMEZONE, TZID dates). */
function calendar(...events: string[][]): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Stud.IP@example.test//Stud.IP_iCalendar Library //EN",
    "BEGIN:VTIMEZONE",
    "TZID:Europe/Berlin",
    "BEGIN:DAYLIGHT",
    "DTSTART:19700329T020000",
    "RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3",
    "END:DAYLIGHT",
    "END:VTIMEZONE",
    ...events.flatMap((e) => ["BEGIN:VEVENT", ...e, "END:VEVENT"]),
    "END:VCALENDAR",
  ].join("\r\n");
}

const iso = (d: Date) => toZonedIso(d);

describe("ics lines", () => {
  it("unfolds continuation lines and handles CRLF", () => {
    expect(unfoldIcsLines("SUMMARY:Lineare \r\n Algebra\r\nLOCATION:HS 1\r\n")).toEqual([
      "SUMMARY:Lineare Algebra",
      "LOCATION:HS 1",
    ]);
  });

  it("unescapes text values", () => {
    expect(unescapeIcsText("Raum 1\\, 2. OG\\; Gebäude N\\nZugang Süd\\\\")).toBe("Raum 1, 2. OG; Gebäude N\nZugang Süd\\");
  });
});

describe("parseIcsDate", () => {
  it("reads TZID wall clock in winter and summer time", () => {
    const summer = parseIcsDate("20261020T100000", { TZID: "Europe/Berlin" })!;
    const winter = parseIcsDate("20261027T100000", { TZID: "Europe/Berlin" })!;
    expect(summer.date.toISOString()).toBe("2026-10-20T08:00:00.000Z");
    expect(winter.date.toISOString()).toBe("2026-10-27T09:00:00.000Z");
    expect(summer.allDay).toBe(false);
  });

  it("reads UTC and all-day values", () => {
    expect(parseIcsDate("20261020T080000Z")!.date.toISOString()).toBe("2026-10-20T08:00:00.000Z");
    const day = parseIcsDate("20261224", { VALUE: "DATE" })!;
    expect(day.allDay).toBe(true);
    expect(iso(day.date)).toBe("2026-12-24T00:00:00+01:00");
  });

  it("treats floating times as Berlin and unknown TZIDs as Berlin", () => {
    expect(iso(parseIcsDate("20261020T101500")!.date)).toBe("2026-10-20T10:15:00+02:00");
    expect(iso(parseIcsDate("20261020T101500", { TZID: "Not/AZone" })!.date)).toBe("2026-10-20T10:15:00+02:00");
  });
});

describe("parseRRule", () => {
  it("parses weekly rules with BYDAY, INTERVAL and UNTIL", () => {
    const r = parseRRule("FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH;UNTIL=20270205T230000Z")!;
    expect(r.freq).toBe("WEEKLY");
    expect(r.interval).toBe(2);
    expect(r.byDay).toEqual([2, 4]);
    expect(r.until?.toISOString()).toBe("2027-02-05T23:00:00.000Z");
  });

  it("ignores unsupported frequencies", () => {
    expect(parseRRule("FREQ=HOURLY")).toBeUndefined();
  });
});

describe("parseIcs", () => {
  it("parses Stud.IP course dates, cancelled marker and categories", () => {
    const events = parseIcs(
      calendar(
        [
          "UID:Stud.IP-SEM-aaa@example.test",
          "SUMMARY:1001 Beispielkurs (fällt aus)",
          "DTSTART;TZID=Europe/Berlin:20261020T100000",
          "DTEND;TZID=Europe/Berlin:20261020T113000",
          "LOCATION:Hörsaal A",
        ],
        [
          "UID:Stud.IP-SEM-bbb@example.test",
          "SUMMARY:1001 Beispielkurs",
          "DTSTART;TZID=Europe/Berlin:20261027T100000",
          "DTEND;TZID=Europe/Berlin:20261027T113000",
          "CATEGORIES:Vorlesung",
          "DESCRIPTION:Kapitel 1\\nKapitel 2",
          "BEGIN:VALARM",
          "SUMMARY:should be ignored",
          "END:VALARM",
        ],
      ),
    );
    expect(events).toHaveLength(2);
    expect(events[0]!.cancelled).toBe(true);
    expect(events[0]!.summary).toBe("1001 Beispielkurs");
    expect(events[0]!.location).toBe("Hörsaal A");
    expect(events[1]!.cancelled).toBe(false);
    expect(events[1]!.summary).toBe("1001 Beispielkurs");
    expect(events[1]!.categories).toEqual(["Vorlesung"]);
    expect(events[1]!.description).toBe("Kapitel 1\nKapitel 2");
    expect(iso(events[1]!.start)).toBe("2026-10-27T10:00:00+01:00");
  });

  it("marks STATUS:CANCELLED and supports DURATION", () => {
    const [ev] = parseIcs(
      calendar(["UID:x", "SUMMARY:Termin", "STATUS:CANCELLED", "DTSTART:20261020T080000Z", "DURATION:PT1H30M"]),
    );
    expect(ev!.cancelled).toBe(true);
    expect(ev!.end.toISOString()).toBe("2026-10-20T09:30:00.000Z");
  });

  it("skips events without DTSTART", () => {
    expect(parseIcs(calendar(["UID:x", "SUMMARY:kaputt"]))).toEqual([]);
  });
});

describe("expandIcs", () => {
  const from = new Date("2026-10-01T00:00:00Z");
  const to = new Date("2027-03-01T00:00:00Z");

  it("expands a weekly rule across the DST switch keeping the wall clock, minus EXDATE", () => {
    const events = parseIcs(
      calendar([
        "UID:weekly@example.test",
        "SUMMARY:Lerngruppe",
        "DTSTART;TZID=Europe/Berlin:20261019T180000",
        "DTEND;TZID=Europe/Berlin:20261019T193000",
        "RRULE:FREQ=WEEKLY;UNTIL=20261116T235959Z",
        "EXDATE;TZID=Europe/Berlin:20261102T180000",
      ]),
    );
    const occ = expandIcs(events, from, to).map((o) => iso(o.start));
    expect(occ).toEqual([
      "2026-10-19T18:00:00+02:00",
      "2026-10-26T18:00:00+01:00",
      "2026-11-09T18:00:00+01:00",
      "2026-11-16T18:00:00+01:00",
    ]);
  });

  it("honours COUNT (excluded instances still count), INTERVAL and BYDAY", () => {
    const events = parseIcs(
      calendar([
        "UID:b@example.test",
        "SUMMARY:Übung",
        "DTSTART;TZID=Europe/Berlin:20261020T081500",
        "DTEND;TZID=Europe/Berlin:20261020T094500",
        "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH;COUNT=4",
        "EXDATE;TZID=Europe/Berlin:20261022T081500",
      ]),
    );
    const occ = expandIcs(events, from, to).map((o) => iso(o.start));
    expect(occ).toEqual(["2026-10-20T08:15:00+02:00", "2026-11-03T08:15:00+01:00", "2026-11-05T08:15:00+01:00"]);
  });

  it("replaces an instance overridden by RECURRENCE-ID", () => {
    const events = parseIcs(
      calendar(
        [
          "UID:r@example.test",
          "SUMMARY:Tutorium",
          "DTSTART;TZID=Europe/Berlin:20261021T120000",
          "DTEND;TZID=Europe/Berlin:20261021T130000",
          "RRULE:FREQ=WEEKLY;COUNT=3",
        ],
        [
          "UID:r@example.test",
          "RECURRENCE-ID;TZID=Europe/Berlin:20261028T120000",
          "SUMMARY:Tutorium (verlegt)",
          "DTSTART;TZID=Europe/Berlin:20261029T140000",
          "DTEND;TZID=Europe/Berlin:20261029T150000",
        ],
      ),
    );
    const occ = expandIcs(events, from, to).map((o) => `${iso(o.start)} ${o.event.summary}`);
    expect(occ).toEqual([
      "2026-10-21T12:00:00+02:00 Tutorium",
      "2026-10-29T14:00:00+01:00 Tutorium (verlegt)",
      "2026-11-04T12:00:00+01:00 Tutorium",
    ]);
  });

  it("clips to the window and expands monthly/daily rules", () => {
    const events = parseIcs(
      calendar(
        [
          "UID:m",
          "SUMMARY:Fachschaft",
          "DTSTART;TZID=Europe/Berlin:20260131T190000",
          "DTEND;TZID=Europe/Berlin:20260131T200000",
          "RRULE:FREQ=MONTHLY;COUNT=6",
        ],
        ["UID:d", "SUMMARY:Daily", "DTSTART:20261030T070000Z", "DTEND:20261030T073000Z", "RRULE:FREQ=DAILY;COUNT=3"],
      ),
    );
    const occ = expandIcs(events, new Date("2026-03-01T00:00:00Z"), new Date("2026-11-30T00:00:00Z")).map((o) => iso(o.start));
    // Monthly on the 31st skips short months; the series ends after 6 instances (Jan, Mar, May, Jul, Aug, Oct).
    expect(occ).toEqual([
      "2026-03-31T19:00:00+02:00",
      "2026-05-31T19:00:00+02:00",
      "2026-07-31T19:00:00+02:00",
      "2026-08-31T19:00:00+02:00",
      "2026-10-30T08:00:00+01:00",
      "2026-10-31T08:00:00+01:00",
      "2026-10-31T19:00:00+01:00",
      "2026-11-01T08:00:00+01:00",
    ]);
  });
});
