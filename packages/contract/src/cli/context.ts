import { z } from "zod";
import { CourseDate, CwTask, DayKey, IsoDateTime } from "../common.js";

/** `imstudium context --json` — the one orientation call for agents. */
export const ContextOutput = z
  .object({
    generatedAt: IsoDateTime,
    semester: z.object({
      studip: z.object({ title: z.string(), slug: z.string(), week: z.number().int().optional() }).nullable(),
      workspace: z.object({ title: z.string(), folder: z.string(), courses: z.number().int() }).nullable(),
      rolloverNeeded: z.boolean(),
      archive: z.number().int().describe("Number of archived semesters"),
    }),
    lastSync: IsoDateTime.nullable(),
    today: z
      .object({
        date: DayKey,
        source: z.string(),
        entries: z.array(CourseDate),
        next: CourseDate.nullable(),
      })
      .nullable(),
    tasks: z.array(CwTask.pick({ title: true, courseTitle: true, deadline: true, daysLeft: true, status: true, url: true })),
    exams: z.array(
      z.object({
        course: z.string(),
        title: z.string(),
        date: z.string().optional(),
        daysRemaining: z.number().int().optional(),
        confirmed: z.boolean(),
      }),
    ),
    newFiles: z.array(
      z.object({
        at: IsoDateTime,
        course: z.string().optional(),
        name: z.string().optional(),
        path: z.string(),
        change: z.string(),
      }),
    ),
    news: z.array(z.object({ date: z.string(), course: z.string(), title: z.string(), path: z.string() })),
    unreadMessages: z.number().int().nullable(),
    next: z.array(z.string()).describe("Suggested next commands, most useful first"),
  })
  .describe("Semester, today, Abgaben, Klausuren, new files, news and the next sensible command");
export type ContextOutput = z.infer<typeof ContextOutput>;
