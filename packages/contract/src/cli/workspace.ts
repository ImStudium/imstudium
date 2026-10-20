import { z } from "zod";
import { ChangeEntry, IsoDateTime, SearchHit, SemesterProgress, SyncReport } from "../common.js";

/** `imstudium search --json` */
export const SearchOutput = z
  .object({
    query: z.string(),
    count: z.number().int(),
    hits: z.array(SearchHit),
  })
  .describe("Ranked local search across materials, news, forum, courseware and wiki");
export type SearchOutput = z.infer<typeof SearchOutput>;

/** `imstudium changes --json` */
export const ChangesOutput = z
  .object({
    since: IsoDateTime,
    count: z.number().int(),
    changes: z.array(ChangeEntry).describe("Newest first, one entry per path"),
  })
  .describe("New and updated files from recent syncs (local, offline)");
export type ChangesOutput = z.infer<typeof ChangesOutput>;

const ArchivedSemester = z.object({
  slug: z.string(),
  title: z.string().optional(),
  courses: z.number().int(),
  path: z.string(),
});

/** `imstudium semester --json` */
export const SemesterOutput = z
  .object({
    current: z
      .object({
        id: z.string(),
        title: z.string(),
        slug: z.string().optional(),
        start: z.string().optional(),
        end: z.string().optional(),
        startOfLectures: z.string().optional(),
        endOfLectures: z.string().optional(),
      })
      .extend(SemesterProgress.partial().shape)
      .nullable()
      .describe("The semester running now per Stud.IP; null offline"),
    workspace: z
      .object({
        title: z.string(),
        slug: z.string(),
        folder: z.string(),
        courses: z.number().int(),
        generatedAt: z.string(),
      })
      .nullable(),
    archive: z.array(ArchivedSemester),
    needsRollover: z.boolean(),
    next: z.string(),
  })
  .describe("Where you are in the semester and whether a rollover is due");
export type SemesterOutput = z.infer<typeof SemesterOutput>;

const SemesterId = z.object({ id: z.string(), title: z.string(), slug: z.string() });
const RolloverMove = z.object({ slug: z.string(), from: z.string(), to: z.string() });
const RolloverPlan = z.object({
  workspacePath: z.string(),
  currentSlug: z.string(),
  moves: z.array(RolloverMove),
  conflicts: z.array(z.string()),
});

/** `imstudium semester start --json` (and `--dry-run`) */
export const SemesterStartOutput = z.union([
  z.object({
    semester: SemesterId,
    rollover: RolloverPlan.extend({
      moved: z.array(z.string()),
      syncStateRewritten: z.number().int(),
      corpusFilesRewritten: z.number().int(),
    }),
    report: SyncReport,
    extracted: z.number().int(),
  }),
  z.object({ semester: SemesterId, plan: RolloverPlan, downloads: z.number().int() }),
]);
export type SemesterStartOutput = z.infer<typeof SemesterStartOutput>;

/** `imstudium sync --json` */
export const SyncOutput = SyncReport.extend({
  semesters: z.array(
    z.object({
      title: z.string(),
      slug: z.string(),
      folder: z.string(),
      archived: z.boolean(),
      courses: z.number().int(),
    }),
  ),
  changes: z.array(ChangeEntry),
  extracted: z.number().int().optional().describe("Only with --extract"),
}).describe("Sync report: downloads, per-semester folders and the files that changed");
export type SyncOutput = z.infer<typeof SyncOutput>;

export const ExamDate = z.object({
  courseId: z.string(),
  courseTitle: z.string(),
  date: z.string().optional(),
  title: z.string(),
  location: z.string().optional(),
  confirmed: z.boolean(),
  source: z.enum(["event", "achievement", "miscellaneous"]),
  daysRemaining: z.number().int().optional(),
});

/** `imstudium klausuren --json` (and MCP `studium_klausuren`) */
export const KlausurenOutput = z
  .object({
    exams: z.array(ExamDate),
    nextDeadlines: z.array(ExamDate),
  })
  .describe("Exam timeline from studium.json");
export type KlausurenOutput = z.infer<typeof KlausurenOutput>;
