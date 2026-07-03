import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { StudIpClient } from "./client.js";
import { CoursesResource, ScheduleResource } from "./resources/courses.js";
import { FilesResource } from "./resources/files.js";
import { ensureDir, slugify } from "./config.js";
import type {
  StudiumCourse,
  StudiumExamDate,
  StudiumScheduleEntry,
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

  async build(workspacePath: string, instanceUrl: string): Promise<StudiumWorkspace> {
    await ensureDir(workspacePath);
    const me = await this.courses.getMe();
    const userName =
      (me.attributes?.["formatted-name"] as string) ||
      (me.attributes?.username as string) ||
      me.id;

    const rawCourses = await this.courses.listMine(me.id);
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

      const course: StudiumCourse = {
        id: c.id,
        title,
        courseNumber: c.attributes?.["course-number"],
        courseType: c.attributes?.["course-type"],
        subtitle: c.attributes?.subtitle,
        description: c.attributes?.description,
        achievement: c.attributes?.achievement,
        credits: c.attributes?.credits,
        semester: "current",
        schedule: courseSchedule,
        examDates,
        fileCount: fileRefs.length,
        folderCount: folders.length,
        lastSynced: new Date().toISOString(),
        slug: slugify(title),
      };
      studiumCourses.push(course);

      const courseDir = join(workspacePath, "current", course.slug);
      await ensureDir(courseDir);
      await this.writeCourseBrief(courseDir, course);
    }

    const now = new Date();
    for (const exam of allExams) {
      if (exam.date) {
        const d = new Date(exam.date);
        exam.daysRemaining = Math.ceil((d.getTime() - now.getTime()) / 86_400_000);
      }
    }

    allExams.sort((a, b) => {
      if (!a.date) return 1;
      if (!b.date) return -1;
      return new Date(a.date).getTime() - new Date(b.date).getTime();
    });

    const workspace: StudiumWorkspace = {
      schemaVersion: "1",
      generatedAt: new Date().toISOString(),
      instanceUrl,
      user: { id: me.id, name: userName },
      semesters: ["current"],
      courses: studiumCourses,
      nextDeadlines: allExams.filter((e) => e.date && (e.daysRemaining ?? 999) >= 0).slice(0, 10),
    };

    await writeFile(join(workspacePath, "studium.json"), JSON.stringify(workspace, null, 2));
    await this.writeStudiumMd(workspacePath, workspace);
    await this.writeKlausurenMd(workspacePath, allExams);

    return workspace;
  }

  async loadWorkspace(workspacePath: string): Promise<StudiumWorkspace | null> {
    try {
      const raw = await readFile(join(workspacePath, "studium.json"), "utf-8");
      return JSON.parse(raw) as StudiumWorkspace;
    } catch {
      return null;
    }
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
    const lines = [
      "# Studium Overview",
      "",
      `Generated: ${ws.generatedAt}`,
      `Student: ${ws.user?.name || "—"}`,
      "",
      "## Courses",
      "",
    ];

    for (const c of ws.courses) {
      lines.push(`- **${c.title}** (${c.fileCount} files) — \`${c.slug}\``);
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

async function readNotesSection(filePath: string): Promise<string | null> {
  try {
    const content = await readFile(filePath, "utf-8");
    const match = content.match(/## Student notes\n\n([\s\S]*?)(?:\n## |\s*$)/);
    return match?.[1]?.trim() || null;
  } catch {
    return null;
  }
}
