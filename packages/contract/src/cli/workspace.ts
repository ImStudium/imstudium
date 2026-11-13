import { z } from "zod";
import { ChangeEntry, IsoDateTime, SearchHit, SemesterProgress, SyncReport } from "../common.js";
import { OcrSummary } from "./setup.js";

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
    enrolled: z
      .number()
      .int()
      .nullable()
      .optional()
      .describe("Your courses in the running semester on Stud.IP; null when signed out or offline"),
    needsRollover: z.boolean().describe("A semester start is due: Stud.IP is on a newer semester you have courses in"),
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
  z.object({
    semester: SemesterId,
    plan: RolloverPlan,
    downloads: z.number().int(),
    courses: z.number().int().optional().describe("Your courses in the target semester"),
  }),
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
  ocr: OcrSummary.optional().describe("Only with --extract: pages read by on-device OCR"),
}).describe("Sync report: downloads, per-semester folders and the files that changed");
export type SyncOutput = z.infer<typeof SyncOutput>;

const ExtractResult = z.object({
  source: z.string(),
  outDir: z.string(),
  kind: z.enum(["pdf", "office", "image", "text", "unsupported"]),
  pages: z.number().int(),
  tool: z.string().optional().describe("pdf-inspector · pdf-inspector+ocr · anydoc · passthrough · copy"),
  skipped: z.boolean().optional().describe("Unchanged since the last extraction"),
  error: z.string().optional(),
  hint: z.string().optional(),
  ocrPages: z.array(z.number().int()).optional().describe("0-based pages read by on-device OCR"),
  ocrLowConfidencePages: z.array(z.number().int()).optional(),
  imageOnlyPages: z.array(z.number().int()).optional().describe("0-based pages still without text"),
});

/** `imstudium extract --json` (workspace mode; `--file` returns one result) */
export const ExtractOutput = z
  .object({
    extracted: z.number().int(),
    skipped: z.number().int(),
    failed: z.number().int(),
    hints: z.array(z.string()),
    ocr: OcrSummary,
    results: z.array(ExtractResult),
    searchIndex: z.unknown().nullable().optional(),
  })
  .describe("Local extraction to content.md: counts, OCR totals and one result per file");
export type ExtractOutput = z.infer<typeof ExtractOutput>;

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
