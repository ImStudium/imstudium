import { z } from "zod";
import { CourseDate, DayKey, Holiday, TimetableDay } from "../common.js";

const TimetableHead = {
  from: DayKey,
  to: DayKey,
  source: z.enum(["live", "ics"]),
  stale: z.boolean().describe("true when the cached calendar.ics answered instead of Stud.IP"),
  icsUpdatedAt: z.string().nullable(),
  warnings: z.array(z.string()),
  days: z.array(TimetableDay),
};

/** `imstudium today --json` */
export const TodayOutput = z
  .object({
    ...TimetableHead,
    date: DayKey,
    entries: z.array(CourseDate),
    next: CourseDate.nullable().describe("First date after this day, when the day is empty or over"),
  })
  .describe("Dates of one day (default today, Europe/Berlin)");
export type TodayOutput = z.infer<typeof TodayOutput>;

/** `imstudium week --json` */
export const WeekOutput = z.object(TimetableHead).describe("Dates of one week, Mo–So, grouped by day");
export type WeekOutput = z.infer<typeof WeekOutput>;

/** `imstudium holidays --json` */
export const HolidaysOutput = z.object({
  from: DayKey,
  to: DayKey,
  semester: z
    .object({
      id: z.string().optional(),
      title: z.string().optional(),
      start: z.string().optional(),
      end: z.string().optional(),
      startOfLectures: z.string().optional(),
      endOfLectures: z.string().optional(),
    })
    .nullable(),
  holidays: z.array(Holiday),
});
export type HolidaysOutput = z.infer<typeof HolidaysOutput>;
