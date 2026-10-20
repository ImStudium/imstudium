import { z } from "zod";
import { CwTask, CwUnit } from "../common.js";

/** `imstudium tasks --json` */
export const TasksOutput = z
  .object({
    count: z.number().int().describe("Tasks shown"),
    open: z.number().int(),
    overdue: z.number().int(),
    tasks: z.array(CwTask),
  })
  .describe("Courseware tasks (Abgaben), soonest deadline first");
export type TasksOutput = z.infer<typeof TasksOutput>;

const CourseLite = z.object({ id: z.string(), title: z.string() });

export const CoursewareElement = z.object({
  id: z.string(),
  title: z.string(),
  number: z.string(),
  depth: z.number().int(),
  parentId: z.string().nullable(),
  position: z.number(),
  canVisit: z.boolean(),
  chdate: z.string().nullable(),
  url: z.string(),
});

/** `imstudium courseware --json` (no course): units per current course. */
export const CoursewareListOutput = z.object({
  courses: z.array(CourseLite.extend({ units: z.array(CwUnit) })),
  count: z.number().int(),
});

/** `imstudium courseware <course> --json`: outline of the course's units. */
export const CoursewareCourseOutput = z.object({
  course: CourseLite,
  units: z.array(CwUnit.extend({ elements: z.array(CoursewareElement) })),
  tasks: z.array(CwTask),
});

const FileWriteStats = z.object({
  downloaded: z.number().int(),
  skipped: z.number().int(),
  failed: z.number().int(),
  bytes: z.number(),
  errors: z.array(z.object({ fileRefId: z.string(), message: z.string() })),
});

/** `imstudium courseware|wiki <course> --save --json` */
export const ContentSaveOutput = z.object({
  courseId: z.string(),
  courseTitle: z.string(),
  courseware: z
    .object({
      dir: z.string(),
      units: z.number().int(),
      pages: z.number().int(),
      written: z.number().int(),
      skipped: z.number().int(),
      removed: z.number().int(),
      files: FileWriteStats,
    })
    .nullable(),
  wiki: z
    .object({ dir: z.string(), pages: z.number().int(), written: z.number().int(), skipped: z.number().int(), removed: z.number().int() })
    .nullable(),
  tasks: z.array(CwTask),
  errors: z.array(z.object({ scope: z.enum(["courseware", "wiki", "tasks", "unit"]), id: z.string().optional(), message: z.string() })),
});

export const CoursewareOutput = z
  .union([CoursewareCourseOutput, CoursewareListOutput, ContentSaveOutput])
  .describe("Courseware units and outline; with --save the write report");
export type CoursewareOutput = z.infer<typeof CoursewareOutput>;
export type CoursewareListOutput = z.infer<typeof CoursewareListOutput>;
export type CoursewareCourseOutput = z.infer<typeof CoursewareCourseOutput>;
