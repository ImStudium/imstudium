import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { StudIpClient } from "./client.js";
import { CoursesResource, ScheduleResource, type ResolvedSemesterContext } from "./resources/courses.js";
import { FilesResource } from "./resources/files.js";
import { ensureDir, slugify } from "./config.js";
import {
  computeSemesterProgress,
  semesterSlug,
} from "./semesters.js";
import { courseRelativePath, semesterFolderSlug } from "./workspace-path.js";
import { agentSearchGuidance, type CourseSearchIndex, type WorkspaceSearchIndex } from "./search-corpus.js";
import { EXTRACTION_LIMITS_FOR_AGENTS } from "./extraction-guidance.js";
import type {
  StudiumCourse,
  StudiumExamDate,
  StudiumScheduleEntry,
  StudiumSemesterSummary,
  StudiumWorkspace,
} from "./types.js";

const EXAM_KEYWORDS = [
  /klausur/i,
  /prüfung/i,
  /pruefung/i,
  /exam/i,
  /test\b/i,
  /abschluss/i,
];

export class StudiumBuilder {
  private courses: CoursesResource;
  private files: FilesResource;
  private schedule: ScheduleResource;

  constructor(client: StudIpClient) {
    this.courses = new CoursesResource(client);
    this.files = new FilesResource(client);
    this.schedule = new ScheduleResource(client);
  }

  async build(
    workspacePath: string,
    instanceUrl: string,
    options?: {
      semesterId?: string;
      semesterLabel?: string;
      allSemesters?: boolean;
    },
  ): Promise<StudiumWorkspace> {
    await ensureDir(workspacePath);
    const me = await this.courses.getMe();
    const userName =
      (me.attributes?.["formatted-name"] as string) ||
      (me.attributes?.username as string) ||
      me.id;

    const semesterCtx = await this.courses.resolveSemesterContext({
      semesterId: options?.semesterId,
      semesterLabel: options?.semesterLabel,
      allSemesters: options?.allSemesters,
    });
    const rawCourses = await this.courses.listMine(me.id, {
      semesterId: options?.semesterId ?? semesterCtx?.semester.id,
      allSemesters: options?.allSemesters,
    });
    const semesterFolder = semesterFolderSlug(semesterCtx, options?.allSemesters);
    const semesterTitle = semesterCtx?.title || semesterFolder;
    const scheduleEntries = await this.schedule.getSchedule(me.id);

    const studiumCourses: StudiumCourse[] = [];
    const allExams: StudiumExamDate[] = [];

    for (const c of rawCourses) {
      const title = c.attributes?.title || c.id;
      const fileRefs = await this.files.listAllFileRefs(c.id);
      const folders = await this.files.listAllFolders(c.id);
      const events = await this.courses.getEvents(c.id);

      const courseSchedule: StudiumScheduleEntry[] = scheduleEntries
        .filter((e) => {
          const rel = e.relationships?.["course"]?.data;
          const cid = rel && !Array.isArray(rel) ? rel.id : undefined;
          return cid === c.id;
        })
        .map((e) => ({
          title: (e.attributes?.title as string) || "Event",
          start: e.attributes?.["start-date"] as string | undefined,
          end: e.attributes?.["end-date"] as string | undefined,
          location: e.attributes?.location as string | undefined,
          courseId: c.id,
          courseTitle: title,
        }));

      const examDates = extractExamDates(c.id, title, events, c.attributes);
      allExams.push(...examDates);

      const courseSlug = slugify(title);
      const relPath = courseRelativePath(semesterFolder, courseSlug);

      const course: StudiumCourse = {
        id: c.id,
        title,
        courseNumber: c.attributes?.["course-number"],
        courseType: c.attributes?.["course-type"],
        subtitle: c.attributes?.subtitle,
        description: c.attributes?.description,
        achievement: c.attributes?.achievement,
        credits: c.attributes?.credits,
        semester: semesterTitle,
        semesterId: semesterCtx?.semester.id,
        schedule: courseSchedule,
        examDates,
        fileCount: fileRefs.length,
        folderCount: folders.length,
        lastSynced: new Date().toISOString(),
        slug: courseSlug,
        path: relPath,
      };
      studiumCourses.push(course);

      const courseDir = join(workspacePath, relPath);
      await ensureDir(courseDir);
      await this.writeCourseBrief(courseDir, course);
    }

    for (const exam of allExams) {
      if (exam.date) {
        exam.daysRemaining = computeDaysRemaining(exam.date);
      }
    }

    allExams.sort((a, b) => {
      if (!a.date) return 1;
      if (!b.date) return -1;
      return new Date(a.date).getTime() - new Date(b.date).getTime();
    });

    const progress = semesterCtx ? computeSemesterProgress(semesterCtx.semester) : undefined;
    const otherSemesters = this.buildOtherSemesters(semesterCtx);

    const workspace: StudiumWorkspace = {
      schemaVersion: "2",
      generatedAt: new Date().toISOString(),
      instanceUrl,
      user: { id: me.id, name: userName },
      activeSemester: {
        id: semesterCtx?.semester.id || "unknown",
        title: semesterTitle,
        slug: semesterCtx?.slug || semesterFolder,
        isCurrent: options?.allSemesters ? true : (semesterCtx?.isCurrent ?? true),
        start: semesterCtx?.semester.attributes?.start,
        end: semesterCtx?.semester.attributes?.end,
        ...progress,
      },
      otherSemesters,
      workspaceFolder: semesterFolder,
      semesters: options?.allSemesters ? ["all"] : [semesterTitle],
      semesterId: semesterCtx?.semester.id,
      semesterSlug: semesterCtx?.slug || semesterFolder,
      courses: studiumCourses,
      nextDeadlines: allExams.filter((e) => e.date && (e.daysRemaining ?? 999) >= 0).slice(0, 10),
    };

    await this.attachSearchMetadata(workspacePath, workspace);

    await writeFile(join(workspacePath, "studium.json"), JSON.stringify(workspace, null, 2));
    await this.writeStudiumMd(workspacePath, workspace);
    await this.writeKlausurenMd(workspacePath, allExams);
    await writeLlmsTxt(workspacePath, workspace);

    return workspace;
  }

  async loadWorkspace(workspacePath: string): Promise<StudiumWorkspace | null> {
    try {
      const raw = await readFile(join(workspacePath, "studium.json"), "utf-8");
      return normalizeStudiumWorkspace(JSON.parse(raw) as StudiumWorkspace);
    } catch {
      return null;
    }
  }

  /** Re-attach search metadata and rewrite studium.json + llms.txt after (re)indexing. */
  async refreshSearchArtifacts(workspacePath: string, workspace: StudiumWorkspace): Promise<void> {
    await this.attachSearchMetadata(workspacePath, workspace);
    await writeFile(join(workspacePath, "studium.json"), JSON.stringify(workspace, null, 2));
    await writeLlmsTxt(workspacePath, workspace);
  }

  /** Attach existing search/index.json metadata without rebuilding corpora. */
  private async attachSearchMetadata(workspacePath: string, workspace: StudiumWorkspace): Promise<void> {
    try {
      const idx = JSON.parse(
        await readFile(join(workspacePath, "search/index.json"), "utf-8"),
      ) as WorkspaceSearchIndex;
      workspace.search = {
        chunkCount: idx.chunkCount,
        courseCount: idx.courseCount,
        indexedAt: idx.indexedAt,
      };
    } catch {
      // no workspace corpus yet
    }
    for (const course of workspace.courses) {
      if (!course.path) continue;
      try {
        const cidx = JSON.parse(
          await readFile(join(workspacePath, course.path, "search/index.json"), "utf-8"),
        ) as CourseSearchIndex;
        course.search = {
          corpusPath: `${course.path}/${cidx.corpusPath}`,
          chunkCount: cidx.chunkCount,
          indexedAt: cidx.indexedAt,
        };
      } catch {
        // course not indexed
      }
    }
  }

  /** Nearby semesters not covered by this snapshot — surfaced so agents know how to reach them. */
  private buildOtherSemesters(
    ctx: ResolvedSemesterContext | null,
  ): StudiumSemesterSummary[] {
    if (!ctx) return [];
    const current = this.courses.semesters.recentWindow(ctx.allSemesters, ctx.semester, 6);
    return current
      .filter((s) => s.id !== ctx.semester.id)
      .map((s) => {
        const title = String(s.attributes?.title || s.id);
        return {
          id: s.id,
          title,
          slug: semesterSlug(title),
          isCurrent: false,
          synced: false,
        };
      });
  }

  private async writeCourseBrief(dir: string, course: StudiumCourse): Promise<void> {
    const existingNotes = await readNotesSection(join(dir, "COURSE.md"));
    const lines = [
      `# ${course.title}`,
      "",
      course.subtitle ? `_${course.subtitle}_\n` : "",
      "## Overview",
      "",
      `- **Type:** ${course.courseType || "—"}`,
      `- **ECTS:** ${course.credits ?? "—"}`,
      `- **Files synced:** ${course.fileCount}`,
      "",
      "## Navigate",
      "",
      "- `search/materials.json` — file list, extract slugs, cite refs",
      "- `search/corpus.jsonl` — page index for your grep / semantic search (one JSON line per page)",
      "- `extracted/<slug>/content.md` — full text; `pages/` — slide images (read before explaining visuals)",
      "",
    ];

    if (course.description) {
      lines.push("## Description", "", course.description, "");
    }
    if (course.achievement) {
      lines.push("## Leistungsnachweis", "", course.achievement, "");
    }
    if (course.examDates.length) {
      lines.push("## Exams", "");
      for (const e of course.examDates) {
        lines.push(
          `- ${e.confirmed ? "✓" : "?"} **${e.title}**${e.date ? ` — ${e.date}` : ""}${e.location ? ` @ ${e.location}` : ""}`,
        );
      }
      lines.push("");
    }
    if (existingNotes) {
      lines.push("## Student notes", "", existingNotes, "");
    }

    await writeFile(join(dir, "COURSE.md"), lines.join("\n"));
  }

  private async writeStudiumMd(workspacePath: string, ws: StudiumWorkspace): Promise<void> {
    const existingNotes = await readNotesSection(join(workspacePath, "STUDIUM.md"));
    const sem = ws.activeSemester;
    const progress =
      sem.weekNumber != null
        ? ` — week ${sem.weekNumber} · day ${sem.daysElapsed}/${sem.daysTotal} (${sem.progressPercent}%)`
        : "";
    const lines = [
      "# Studium Overview",
      "",
      `📅 **Focus: ${sem.title}**${progress} — courses live in \`${ws.workspaceFolder}/\``,
      `Generated: ${ws.generatedAt}`,
      `Student: ${ws.user?.name || "—"}`,
      "",
    ];

    if (ws.otherSemesters.length) {
      const names = ws.otherSemesters.map((s) => s.title).join(", ");
      lines.push(
        `_Not synced by default: ${names}. Fetch one with \`imstudium sync --semester "<name>"\`._`,
        "",
      );
    }

    lines.push("## Courses", "");
    for (const c of ws.courses) {
      lines.push(
        `- **${c.title}** (${c.fileCount} files) — \`${c.slug}\`${c.semester ? ` · ${c.semester}` : ""}`,
      );
    }

    if (ws.nextDeadlines.length) {
      lines.push("", "## Upcoming exams (next 10)", "");
      for (const e of ws.nextDeadlines) {
        const days = e.daysRemaining != null ? ` — ${e.daysRemaining}d` : "";
        lines.push(`- ${e.date || "TBD"}: **${e.courseTitle}** — ${e.title}${days}`);
      }
    }

    if (existingNotes) {
      lines.push("", "## Student notes", "", existingNotes, "");
    }

    await writeFile(join(workspacePath, "STUDIUM.md"), lines.join("\n"));
  }

  private async writeKlausurenMd(workspacePath: string, exams: StudiumExamDate[]): Promise<void> {
    const existingNotes = await readNotesSection(join(workspacePath, "klausuren.md"));
    const confirmed = exams.filter((e) => e.confirmed);
    const unconfirmed = exams.filter((e) => !e.confirmed);

    const lines = [
      "# Klausuren & Prüfungen",
      "",
      `Updated: ${new Date().toISOString()}`,
      "",
      "## Confirmed",
      "",
    ];

    if (confirmed.length === 0) lines.push("_No confirmed exam dates yet._", "");
    for (const e of confirmed) {
      const days = e.daysRemaining != null ? ` (${e.daysRemaining} days)` : "";
      lines.push(
        `- **${e.date || "TBD"}** — ${e.courseTitle}: ${e.title}${e.location ? ` @ ${e.location}` : ""}${days}`,
      );
    }

    lines.push("", "## Unconfirmed (verify manually)", "");
    if (unconfirmed.length === 0) lines.push("_None_", "");
    for (const e of unconfirmed) {
      lines.push(`- ${e.courseTitle}: ${e.title} _(${e.source})_`);
    }

    if (existingNotes) {
      lines.push("", "## Student notes", "", existingNotes, "");
    }

    await writeFile(join(workspacePath, "klausuren.md"), lines.join("\n"));
  }
}

function extractExamDates(
  courseId: string,
  courseTitle: string,
  events: Array<{ attributes?: Record<string, unknown> }>,
  courseAttrs?: Record<string, unknown>,
): StudiumExamDate[] {
  const results: StudiumExamDate[] = [];

  for (const ev of events) {
    const title = String(ev.attributes?.title || "");
    const category = String(ev.attributes?.category || "");
    const combined = `${title} ${category}`;
    if (EXAM_KEYWORDS.some((re) => re.test(combined))) {
      results.push({
        courseId,
        courseTitle,
        date: ev.attributes?.["start-date"] as string | undefined,
        title: title || "Exam",
        location: ev.attributes?.location as string | undefined,
        confirmed: true,
        source: "event",
      });
    }
  }

  const achievement = String(courseAttrs?.achievement || "");
  if (achievement && EXAM_KEYWORDS.some((re) => re.test(achievement))) {
    results.push({
      courseId,
      courseTitle,
      title: achievement.slice(0, 120),
      confirmed: false,
      source: "achievement",
    });
  }

  const misc = String(courseAttrs?.miscellaneous || "");
  if (misc && EXAM_KEYWORDS.some((re) => re.test(misc))) {
    results.push({
      courseId,
      courseTitle,
      title: misc.slice(0, 120),
      confirmed: false,
      source: "miscellaneous",
    });
  }

  return results;
}

/** @internal — unit tests */
export const extractExamDatesForTest = extractExamDates;

export function computeDaysRemaining(isoDate: string): number {
  const d = new Date(isoDate);
  const now = new Date();
  return Math.ceil((d.getTime() - now.getTime()) / 86_400_000);
}

async function readNotesSection(filePath: string): Promise<string | null> {
  try {
    const content = await readFile(filePath, "utf-8");
    const match = content.match(/## Student notes\n\n([\s\S]*?)(?:\n## |\s*$)/);
    return match?.[1]?.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Workspace-root llms.txt — the navigation contract for any LLM/agent
 * landing in ~/Studium without harness-specific skills installed.
 */
export async function writeLlmsTxt(workspacePath: string, ws: StudiumWorkspace): Promise<void> {
  const sem = ws.activeSemester;
  const guidance = agentSearchGuidance(workspacePath, ws);
  const lines = [
    `# Studium — ${ws.user?.name || "student"}`,
    "",
    `> Local mirror of Stud.IP course materials, optimized for LLM navigation.`,
    `> Active semester: ${sem.title}${sem.weekNumber != null ? ` (week ${sem.weekNumber}, ${sem.progressPercent}% elapsed)` : ""}. Generated: ${ws.generatedAt}`,
    "",
    "## Start here",
    "",
    "- [studium.json](studium.json): machine-readable index — courses, exam dates, `course.path` for every folder. Always resolve paths from here, never guess.",
    "- [STUDIUM.md](STUDIUM.md): human overview of the semester.",
    "- [klausuren.md](klausuren.md): exam dates with days remaining.",
  ];

  if (guidance.chunkCount) {
    lines.push(
      "",
      "## Finding content (use YOUR search tools)",
      "",
      "This workspace does not ship a custom search command. Use the harness you already have:",
      "",
      `- **Grep:** \`${guidance.grepExample.replace("your terms", "keyword")}\``,
      "- **Semantic / codebase search:** index or search \`*/search/corpus.jsonl\` and \`extracted/*/content.md\`",
      `- **Fields per JSONL line:** ${guidance.corpusFields.join(", ")}`,
      `- **Cite with:** \`${guidance.citeWith}\``,
      `- **Then read:** ${guidance.resolveHit.pageText} · ${guidance.resolveHit.pageImage}`,
      "",
      `${guidance.chunkCount} indexed pages across ${guidance.courseCount} courses.`,
    );
  }

  lines.push("", "## Courses", "");
  for (const c of ws.courses) {
    const search = c.search ? ` — ${c.search.chunkCount} indexed pages` : "";
    lines.push(`- [${c.path}/](${c.path}/): **${c.title}** (${c.fileCount} files${search})`);
  }

  lines.push(
    "",
    "## Per-course layout",
    "",
    "- `COURSE.md` — brief: type, ECTS, exams, description",
    "- `search/materials.json` — file list + extract slugs + cite refs",
    "- `files/` — original downloads (PDF, PPTX, …)",
    "- `extracted/<slug>/content.md` — full extracted text, one `## Page N` per page",
    "- `extracted/<slug>/pages/page-NN.png` — rendered page images",
    "- `search/corpus.jsonl` — page index for grep / semantic search",
    "",
    "## Rules for agents",
    "",
    "1. Search with your native tools on corpus.jsonl — do not expect an ImStudium search MCP tool.",
    "2. Cite pages with `ref` from JSONL hits or materials.json.",
    "3. Slides/diagrams/formulas: read `pages/page-NNN.png` before explaining visual content — text alone is insufficient.",
    "4. Refresh: `imstudium sync --quiet --extract` (daily), `imstudium index` (rebuild page index).",
    "",
    "## Extraction limits (local poppler + Tesseract)",
    "",
    ...EXTRACTION_LIMITS_FOR_AGENTS.map((line) => `- ${line}`),
    "",
  );

  await writeFile(join(workspacePath, "llms.txt"), lines.join("\n"));
}

/** Backfill path + activeSemester from older studium.json snapshots. */
export function normalizeStudiumWorkspace(ws: StudiumWorkspace): StudiumWorkspace {
  const legacy = ws as StudiumWorkspace & {
    semesters?: string[];
    semesterId?: string;
    semesterSlug?: string;
    workspaceFolder?: string;
  };
  if (!ws.activeSemester) {
    ws.activeSemester = {
      id: legacy.semesterId || "unknown",
      title: legacy.semesters?.[0] || legacy.workspaceFolder || "current",
      slug: legacy.semesterSlug || legacy.workspaceFolder || legacy.semesters?.[0] || "current",
      isCurrent: true,
    };
  }
  if (!ws.otherSemesters) ws.otherSemesters = [];
  for (const c of ws.courses) {
    if (!c.path) {
      c.path = `${ws.activeSemester.slug}/${c.slug}`;
    }
  }
  return ws;
}
