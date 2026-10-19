import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import {
  courseActiveInSemester,
  findCurrentSemester,
  rebuildSearchIndexes,
  semesterIdFromRelationships,
  semesterSlug,
  syncCommunication,
  type CourseWithSemester,
  type SemesterResource,
  type StudiumWorkspace,
  type SyncReport,
} from "@imstudium/sdk";
import type { Sdk } from "./runtime.js";
import { meId } from "./me.js";

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
  include?: Array<"wiki" | "news" | "calendar" | "forum">;
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
  const result: RunSyncResult = { report: emptyReport(), semesters: [], extracted: 0, changes: [] };
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
      await extractAndIndex(sdk, opts, ws, result);
    }
  }

  if (!opts.dryRun) {
    result.changes = await recordChanges(opts.out, result.report);
    await writeNewMd(opts.out);
    if (result.workspace) await writeEchoSnapshot(opts.out, result.workspace);
  }
  return result;
}

/** What a plain `imstudium sync` brings home besides files. */
export const DEFAULT_INCLUDE: Array<"wiki" | "news" | "calendar" | "forum"> = ["calendar", "wiki", "news", "forum"];

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
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", timeZone: "Europe/Berlin" });
  const lines = [
    "# New in Stud.IP",
    "",
    `Last ${days} days · updated ${new Date().toLocaleString("de-DE", { timeZone: "Europe/Berlin" })}`,
    "",
  ];
  if (!byCourse.size) lines.push("_Nothing new._", "");
  for (const [course, list] of byCourse) {
    lines.push(`## ${course}`, "");
    for (const c of list) {
      lines.push(`- ${fmt(c.at)} ${c.change === "new" ? "🆕" : "✏️"} [${c.name ?? c.path}](${encodeURI(c.path)})`);
    }
    lines.push("");
  }
  lines.push("_Full log: `.imstudium/changes.jsonl` · `imstudium changes --since 7d`_", "");
  await writeFile(join(out, "NEW.md"), lines.join("\n"));
}

/**
 * snapshots/studium.json for Echo: counts and dates only — no titles,
 * no student id, no file names.
 */
export async function writeEchoSnapshot(out: string, ws: StudiumWorkspace): Promise<string> {
  const next = ws.nextDeadlines[0];
  const week = await readChanges(out, Date.now() - 7 * 86_400_000);
  const metrics = {
    semester: ws.activeSemester.title,
    courses: ws.courses.length,
    exams: ws.courses.reduce((n, c) => n + (c.examDates?.length ?? 0), 0),
    nextDate: next?.date ?? null,
    nextDays: next?.daysRemaining ?? null,
    newFiles7d: new Set(week.map((c) => c.path)).size,
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
