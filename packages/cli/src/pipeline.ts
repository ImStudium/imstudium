import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import {
  courseActiveInSemester,
  findCurrentSemester,
  rebuildSearchIndexes,
  semesterIdFromRelationships,
  semesterSlug,
  syncCommunication,
  syncContent,
  syncPlanning,
  contentDeps,
  type ContentPart,
  type CwTask,
  type SyncPart,
  type CourseWithSemester,
  type SemesterResource,
  type StudiumWorkspace,
  type SyncReport,
} from "@imstudium/sdk";
import type { Sdk } from "./runtime.js";
import { meId } from "./me.js";
import { berlinDayMonth, berlinWeekday, nowStamp } from "./kit/format.js";

export interface RunSyncOptions {
  out: string;
  semesterId?: string;
  semesterLabel?: string;
  /** Every enrolled semester: current at the root, the rest under archive/. */
  allSemesters?: boolean;
  course?: string;
  layout?: "flat" | "tree";
  dryRun?: boolean;
  extract?: boolean;
  include?: SyncPart[];
  onProgress?: (message: string) => void;
}

export interface SemesterRun {
  title: string;
  slug: string;
  folder: string;
  archived: boolean;
  courses: number;
}

export interface ChangeEntry {
  at: string;
  kind: "file";
  change: "new" | "updated";
  courseId?: string;
  courseTitle?: string;
  name?: string;
  /** Relative to the workspace root. */
  path: string;
}

export interface RunSyncResult {
  report: SyncReport;
  /** Courseware tasks (Abgaben) of the current semester, soonest first. */
  tasks: CwTask[];
  semesters: SemesterRun[];
  /** The current-semester workspace (studium.json) when it was rebuilt. */
  workspace?: StudiumWorkspace;
  extracted: number;
  changes: ChangeEntry[];
}

function emptyReport(): SyncReport {
  return { downloaded: 0, skipped: 0, failed: 0, bytes: 0, errors: [], files: [], courseErrors: [] };
}

function mergeReport(into: SyncReport, from: SyncReport): void {
  into.downloaded += from.downloaded;
  into.skipped += from.skipped;
  into.failed += from.failed;
  into.bytes += from.bytes;
  into.errors.push(...from.errors);
  into.files.push(...from.files);
  into.courseErrors = [...(into.courseErrors ?? []), ...(from.courseErrors ?? [])];
}

function matchesCourse(query: string | undefined) {
  if (!query) return undefined;
  const q = query.toLowerCase();
  return (c: { id: string; title: string }) => c.title.toLowerCase().includes(q) || c.id === query;
}

/**
 * Home semester of each enrollment: the current semester when the course
 * runs now, otherwise its start semester. Multi-semester courses therefore
 * live in exactly one folder.
 */
export function groupCoursesBySemester(
  courses: CourseWithSemester[],
  semesters: SemesterResource[],
  current: SemesterResource | null,
): Map<string, CourseWithSemester[]> {
  const groups = new Map<string, CourseWithSemester[]>();
  for (const course of courses) {
    const home =
      current && courseActiveInSemester(course, current, semesters)
        ? current.id
        : semesterIdFromRelationships(course, "start-semester");
    if (!home) continue;
    const list = groups.get(home) ?? [];
    list.push(course);
    groups.set(home, list);
  }
  return groups;
}

/**
 * The one sync pipeline: files → studium overview → extraction → search index
 * → change log → Echo snapshot. sync, semester start, watch and onboard all
 * run through here.
 */
export async function runSync(sdk: Sdk, opts: RunSyncOptions): Promise<RunSyncResult> {
  const progress = opts.onProgress ?? (() => undefined);
  const result: RunSyncResult = { report: emptyReport(), semesters: [], extracted: 0, changes: [], tasks: [] };
  const include = opts.include ?? DEFAULT_INCLUDE;
  const layout = opts.layout ?? "tree";
  const origin = sdk.config.instanceOrigin;

  if (opts.allSemesters) {
    const id = await meId(sdk);
    const semesters = await sdk.courses.semesters.listAll();
    const current = findCurrentSemester(semesters);
    const courses = (await sdk.courses.listMine(id, { allSemesters: true })) as CourseWithSemester[];
    const groups = groupCoursesBySemester(courses, semesters, current);
    const ordered = semesters.filter((s) => groups.has(s.id));

    for (const semester of ordered) {
      const title = String(semester.attributes?.title ?? semester.id);
      const slug = semesterSlug(title);
      const isCurrent = current?.id === semester.id;
      const folder = isCurrent ? slug : `archive/${slug}`;
      const ids = groups.get(semester.id)!.map((c) => c.id);
      const idSet = new Set(ids);
      progress(`${title}: ${ids.length} course(s) → ${folder}/`);

      const report = await sdk.sync.sync({
        outputDir: opts.out,
        layout,
        dryRun: opts.dryRun,
        include: isCurrent ? include : include.filter((i) => i !== "calendar"),
        semesterId: semester.id,
        folderForCourse: () => folder,
        courseFilter: (c) => idSet.has(c.id) && (matchesCourse(opts.course)?.(c) ?? true),
      });
      mergeReport(result.report, report);

      if (!opts.dryRun) {
        const ws = await sdk.studium.build(opts.out, origin, {
          semesterId: semester.id,
          folder,
          courseIds: ids,
          archive: !isCurrent,
        });
        if (isCurrent) result.workspace = ws;
        await syncCourseCommunication(sdk, opts, ws, isCurrent ? include : include.filter((i) => i !== "forum"), result);
        await syncCourseContent(sdk, opts, ws, isCurrent ? include : include.filter((i) => i !== "tasks"), result, isCurrent);
        if (isCurrent && include.includes("calendar")) await syncStundenplan(sdk, opts, ws, result);
        await extractAndIndex(sdk, opts, ws, result);
      }
      result.semesters.push({ title, slug, folder, archived: !isCurrent, courses: ids.length });
    }
  } else {
    const report = await sdk.sync.sync({
      outputDir: opts.out,
      layout,
      dryRun: opts.dryRun,
      include,
      semesterId: opts.semesterId,
      semesterLabel: opts.semesterLabel,
      courseFilter: matchesCourse(opts.course),
    });
    mergeReport(result.report, report);
    if (!opts.dryRun) {
      const ws = await sdk.studium.build(opts.out, origin, {
        semesterId: opts.semesterId,
        semesterLabel: opts.semesterLabel,
      });
      result.workspace = ws;
      result.semesters.push({
        title: ws.activeSemester.title,
        slug: ws.activeSemester.slug,
        folder: ws.workspaceFolder,
        archived: false,
        courses: ws.courses.length,
      });
      await syncCourseCommunication(sdk, opts, ws, include, result);
      await syncCourseContent(sdk, opts, ws, include, result, true);
      if (include.includes("calendar")) await syncStundenplan(sdk, opts, ws, result);
      await extractAndIndex(sdk, opts, ws, result);
    }
  }

  if (!opts.dryRun) {
    result.changes = await recordChanges(opts.out, result.report);
    await writeNewMd(opts.out);
    if (include.includes("tasks")) await writeTasks(opts.out, result.tasks);
    if (result.workspace) await writeEchoSnapshot(opts.out, result.workspace);
  }
  return result;
}

/** What a plain `imstudium sync` brings home besides files. */
export const DEFAULT_INCLUDE: SyncPart[] = ["calendar", "wiki", "news", "forum", "courseware", "tasks"];

/** News and forum threads as markdown in each course folder (never messages). */
async function syncCourseCommunication(
  sdk: Sdk,
  opts: RunSyncOptions,
  ws: StudiumWorkspace,
  include: RunSyncOptions["include"],
  result: RunSyncResult,
): Promise<void> {
  const news = include?.includes("news") ?? false;
  const forum = include?.includes("forum") ?? false;
  if (!news && !forum) return;
  for (const course of ws.courses) {
    if (!course.path) continue;
    opts.onProgress?.(`news & forum ${course.title}`);
    const r = await syncCommunication(sdk, { id: course.id, title: course.title }, join(opts.out, course.path), {
      news,
      forum,
    });
    for (const e of r.errors) {
      (result.report.courseErrors ??= []).push({ courseId: course.id, courseTitle: course.title, message: `${e.area}: ${e.message}` });
    }
  }
}

/** Courseware pages, wiki and courseware tasks per course (pure SDK writers). */
async function syncCourseContent(
  sdk: Sdk,
  opts: RunSyncOptions,
  ws: StudiumWorkspace,
  include: SyncPart[],
  result: RunSyncResult,
  collectTasks: boolean,
): Promise<void> {
  const parts = include.filter((i): i is ContentPart => i === "courseware" || i === "wiki" || i === "tasks");
  if (!parts.length) return;
  const deps = contentDeps(sdk);
  for (const course of ws.courses) {
    if (!course.path) continue;
    opts.onProgress?.(`${parts.join(", ")} ${course.title}`);
    const r = await syncContent(deps, { id: course.id, title: course.title }, join(opts.out, course.path), {
      include: parts,
    });
    if (collectTasks) result.tasks.push(...r.tasks);
    for (const e of r.errors) {
      (result.report.courseErrors ??= []).push({
        courseId: course.id,
        courseTitle: course.title,
        message: `${e.scope}: ${e.message}`,
      });
    }
  }
}

/** stundenplan.md — the weekly plan plus single dates and cancellations (current semester only). */
async function syncStundenplan(sdk: Sdk, opts: RunSyncOptions, ws: StudiumWorkspace, result: RunSyncResult): Promise<void> {
  try {
    opts.onProgress?.("stundenplan");
    await syncPlanning(
      {
        planning: sdk.planning,
        userId: await meId(sdk),
        courses: ws.courses.map((c) => ({ id: c.id, title: c.title, number: c.courseNumber ?? null })),
        semester: {
          id: ws.activeSemester.id,
          title: ws.activeSemester.title,
          start: ws.activeSemester.start,
          end: ws.activeSemester.end,
        },
      },
      opts.out,
    );
  } catch (e) {
    (result.report.courseErrors ??= []).push({
      courseId: "-",
      courseTitle: "Stundenplan",
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

async function extractAndIndex(
  sdk: Sdk,
  opts: RunSyncOptions,
  ws: StudiumWorkspace,
  result: RunSyncResult,
): Promise<void> {
  if (!opts.extract) return;
  for (const course of ws.courses) {
    if (!course.path) continue;
    const courseDir = join(opts.out, course.path);
    opts.onProgress?.(`extract ${course.title}`);
    const results = await sdk.extractor.extractDir(join(courseDir, "files"), join(courseDir, "extracted"), {
      course: { title: course.title, path: course.path },
      workspaceRoot: opts.out,
    });
    result.extracted += results.filter((r) => !r.error && !r.skipped).length;
  }
  await rebuildSearchIndexes(opts.out, ws);
  if (ws.activeSemester.isCurrent !== false) await sdk.studium.refreshSearchArtifacts(opts.out, ws);
}

const STATE_DIR = ".imstudium";

/** Append this run's new/updated files to .imstudium/changes.jsonl. */
export async function recordChanges(out: string, report: SyncReport): Promise<ChangeEntry[]> {
  const at = new Date().toISOString();
  const changes: ChangeEntry[] = report.files
    .filter((f) => f.action === "download" && f.change)
    .map((f) => ({
      at,
      kind: "file",
      change: f.change!,
      courseId: f.courseId,
      courseTitle: f.courseTitle,
      name: f.name,
      path: relative(out, f.path),
    }));
  if (!changes.length) return changes;
  await mkdir(join(out, STATE_DIR), { recursive: true });
  await appendFile(join(out, STATE_DIR, "changes.jsonl"), changes.map((c) => JSON.stringify(c)).join("\n") + "\n");
  return changes;
}

export async function readChanges(out: string, sinceMs: number): Promise<ChangeEntry[]> {
  try {
    const raw = await readFile(join(out, STATE_DIR, "changes.jsonl"), "utf-8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as ChangeEntry)
      .filter((c) => Date.parse(c.at) >= sinceMs);
  } catch {
    return [];
  }
}

/** NEW.md — what arrived in the last 14 days, per course, newest first. */
export async function writeNewMd(out: string, days = 14): Promise<void> {
  const since = Date.now() - days * 86_400_000;
  const changes = (await readChanges(out, since)).reverse();
  const byCourse = new Map<string, ChangeEntry[]>();
  const seen = new Set<string>();
  for (const c of changes) {
    if (seen.has(c.path)) continue; // newest entry per file only
    seen.add(c.path);
    const key = c.courseTitle ?? "Other";
    byCourse.set(key, [...(byCourse.get(key) ?? []), c]);
  }
  const lines = [
    "# New in Stud.IP",
    "",
    `Last ${days} days · updated ${nowStamp()}`,
    "",
  ];
  if (!byCourse.size) lines.push("_Nothing new._", "");
  for (const [course, list] of byCourse) {
    lines.push(`## ${course}`, "");
    for (const c of list) {
      lines.push(`- ${berlinDayMonth(c.at)} ${c.change === "new" ? "🆕" : "✏️"} [${c.name ?? c.path}](${encodeURI(c.path)})`);
    }
    lines.push("");
  }
  lines.push("_Full log: `.imstudium/changes.jsonl` · `imstudium changes --since 7d`_", "");
  await writeFile(join(out, "NEW.md"), lines.join("\n"));
}

/** .imstudium/tasks.json + abgaben.md — courseware deadlines, soonest first. */
export async function writeTasks(out: string, tasks: CwTask[]): Promise<void> {
  const sorted = [...tasks].sort((a, b) => (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999"));
  await mkdir(join(out, STATE_DIR), { recursive: true });
  await writeFile(join(out, STATE_DIR, "tasks.json"), JSON.stringify({ updatedAt: new Date().toISOString(), tasks: sorted }, null, 2) + "\n");
  const fmt = (iso: string | null) => (iso ? berlinWeekday(iso, { time: true }) : "ohne Frist");
  const open = sorted.filter((t) => t.status === "open" || t.status === "overdue" || t.status === "upcoming");
  const done = sorted.filter((t) => t.status === "submitted");
  const lines = ["# Abgaben", "", `Courseware tasks · updated ${nowStamp()}`, ""];
  if (!open.length) lines.push("_Nothing open._", "");
  for (const t of open) {
    const left = t.daysLeft === null ? "" : t.daysLeft < 0 ? ` · **${-t.daysLeft} d overdue**` : ` · in ${t.daysLeft} d`;
    lines.push(`- **${fmt(t.deadline)}**${left} — ${t.title} (${t.courseTitle ?? ""}${t.unitTitle ? ` · ${t.unitTitle}` : ""})${t.progress !== null ? ` · ${t.progress}%` : ""}`);
  }
  if (done.length) lines.push("", `## Submitted (${done.length})`, "", ...done.map((t) => `- ${fmt(t.deadline)} — ${t.title} (${t.courseTitle ?? ""})`));
  lines.push("", "_imstudium tasks --open · .imstudium/tasks.json_", "");
  await writeFile(join(out, "abgaben.md"), lines.join("\n"));
}

export async function readTasks(out: string): Promise<CwTask[]> {
  try {
    return (JSON.parse(await readFile(join(out, STATE_DIR, "tasks.json"), "utf-8")) as { tasks: CwTask[] }).tasks;
  } catch {
    return [];
  }
}

/**
 * snapshots/studium.json for Echo: counts and dates only — no titles,
 * no student id, no file names.
 */
export async function writeEchoSnapshot(out: string, ws: StudiumWorkspace): Promise<string> {
  const next = ws.nextDeadlines[0];
  const week = await readChanges(out, Date.now() - 7 * 86_400_000);
  const openTasks = (await readTasks(out)).filter((t) => t.status === "open" || t.status === "overdue");
  const metrics = {
    semester: ws.activeSemester.title,
    courses: ws.courses.length,
    exams: ws.courses.reduce((n, c) => n + (c.examDates?.length ?? 0), 0),
    nextDate: next?.date ?? null,
    nextDays: next?.daysRemaining ?? null,
    newFiles7d: new Set(week.map((c) => c.path)).size,
    openTasks: openTasks.length,
    nextTaskDays: openTasks.map((t) => t.daysLeft).filter((d): d is number => d !== null).sort((a, b) => a - b)[0] ?? null,
    lastSync: new Date().toISOString(),
  };
  await mkdir(join(out, "snapshots"), { recursive: true });
  const file = join(out, "snapshots", "studium.json");
  await writeFile(
    file,
    JSON.stringify(
      {
        schemaVersion: 1,
        pack: "studium",
        asOf: new Date().toISOString(),
        metrics,
        modules: ["studium.courses", "studium.exams"],
      },
      null,
      2,
    ) + "\n",
  );
  return file;
}
