import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { StudIpClient } from "./client.js";
import { CoursesResource } from "./resources/courses.js";
import { FilesResource } from "./resources/files.js";
import { ScheduleResource } from "./resources/courses.js";
import { paths, ensureDir, slugify } from "./config.js";
import { semesterFolderSlug } from "./workspace-path.js";
import type { SyncReport, SyncState, SyncStateEntry } from "./types.js";

export type SyncPart = "calendar" | "wiki" | "news" | "forum" | "courseware" | "tasks";

export interface SyncOptions {
  outputDir: string;
  layout?: "flat" | "tree";
  dryRun?: boolean;
  concurrency?: number;
  /** calendar → calendar.ics. Course content (news, forum, wiki, courseware, tasks) runs in the CLI pipeline. */
  include?: SyncPart[];
  courseFilter?: (course: { id: string; title: string }) => boolean;
  /** Stud.IP semester id — default: calendar current semester. */
  semesterId?: string;
  /** Folder label override (default: semester title slug, e.g. SS2026). */
  semesterLabel?: string;
  /** Sync every enrollment across all semesters. */
  allSemesters?: boolean;
  /**
   * Relative folder per course (e.g. "WS2026-27" or "archive/SS2026").
   * Default: the resolved semester's slug for every course.
   */
  folderForCourse?: (course: { id: string; title: string; startSemesterId?: string }) => string;
}

export class SyncEngine {
  private courses: CoursesResource;
  private files: FilesResource;
  private schedule: ScheduleResource;

  constructor(client: StudIpClient) {
    this.courses = new CoursesResource(client);
    this.files = new FilesResource(client);
    this.schedule = new ScheduleResource(client);
  }

  async loadState(): Promise<SyncState> {
    try {
      const raw = await readFile(paths.syncStateFile, "utf-8");
      return JSON.parse(raw) as SyncState;
    } catch {
      return { version: 1, entries: {} };
    }
  }

  async saveState(state: SyncState): Promise<void> {
    const dataDir = paths.syncStateFile.replace(/\/sync-state\.json$/, "");
    await ensureDir(dataDir);
    await writeFile(paths.syncStateFile, JSON.stringify(state, null, 2));
  }

  async sync(options: SyncOptions): Promise<SyncReport> {
    const report: SyncReport = {
      downloaded: 0,
      skipped: 0,
      failed: 0,
      bytes: 0,
      errors: [],
      files: [],
    };

    const state = await this.loadState();
    const me = await this.courses.getMe();
    const semesterCtx = await this.courses.resolveSemesterContext({
      semesterId: options.semesterId,
      semesterLabel: options.semesterLabel,
      allSemesters: options.allSemesters,
    });
    const allCourses = await this.courses.listMine(me.id, {
      semesterId: options.semesterId ?? semesterCtx?.semester.id,
      allSemesters: options.allSemesters,
    });
    const semesterFolder = semesterFolderSlug(semesterCtx, options.allSemesters);
    const layout = options.layout ?? "flat";
    const concurrency = options.concurrency ?? 4;

    const filtered = allCourses.filter((c) => {
      if (!options.courseFilter) return true;
      const title = c.attributes?.title || c.id;
      return options.courseFilter({ id: c.id, title });
    });

    if (options.include?.includes("calendar")) {
      try {
        const ics = await this.schedule.exportCalendarIcs(me.id);
        const dest = join(options.outputDir, "calendar.ics");
        if (!options.dryRun) {
          await ensureDir(options.outputDir);
          await writeFile(dest, ics);
        }
      } catch (e) {
        report.errors.push({
          fileRefId: "calendar",
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }

    for (const course of filtered) {
      const title = course.attributes?.title || course.id;
      const courseSlug = slugify(title);
      const startRel = course.relationships?.["start-semester"]?.data;
      const folder = options.folderForCourse
        ? options.folderForCourse({
            id: course.id,
            title,
            startSemesterId: startRel && !Array.isArray(startRel) ? startRel.id : undefined,
          })
        : semesterFolder;
      const courseDir = join(options.outputDir, folder, courseSlug);

      let fileRefs: Awaited<ReturnType<FilesResource["listAllFileRefs"]>>;
      let folderPaths = new Map<string, string>();
      try {
        fileRefs = await this.files.listAllFileRefs(course.id);
        if (layout === "tree") {
          folderPaths = this.files.folderPathMap(await this.files.listAllFolders(course.id));
        }
      } catch (e) {
        // One locked or broken course must not stop the other twenty.
        (report.courseErrors ??= []).push({
          courseId: course.id,
          courseTitle: title,
          message: e instanceof Error ? e.message : String(e),
        });
        continue;
      }

      const tasks = fileRefs.map((fr) => async () => {
        const name = fr.attributes?.name || fr.id;
        const parentRel = fr.relationships?.parent?.data;
        const parentId =
          parentRel && !Array.isArray(parentRel) ? parentRel.id : null;
        const subPath =
          layout === "tree" && parentId && folderPaths.has(parentId)
            ? join("files", folderPaths.get(parentId)!)
            : "files";
        const destPath = join(courseDir, subPath, sanitizeFilename(name));

        const chdate = fr.attributes?.chdate;
        const existing = state.entries[fr.id];
        const meta = { courseId: course.id, courseTitle: title, name };
        // Names come from whoever may create folders in the course: a path
        // outside the course folder is never written, whatever the name.
        if (!isInside(courseDir, destPath)) {
          report.failed++;
          report.errors.push({ fileRefId: fr.id, message: `"${name}" would land outside the course folder; skipped` });
          report.files.push({ fileRefId: fr.id, path: destPath, action: "fail", ...meta });
          return;
        }
        if (existing && existing.chdate === chdate && existing.localPath === destPath) {
          report.skipped++;
          report.files.push({ fileRefId: fr.id, path: destPath, action: "skip", ...meta });
          return;
        }
        // Same version, new place (layout change or rollover): move instead of re-download.
        if (existing && existing.chdate === chdate && existing.localPath !== destPath && !options.dryRun) {
          try {
            await ensureDir(dirname(destPath));
            await rename(existing.localPath, destPath);
            state.entries[fr.id] = { ...existing, localPath: destPath };
            report.skipped++;
            report.files.push({ fileRefId: fr.id, path: destPath, action: "skip", ...meta });
            return;
          } catch {
            // old copy gone — download below
          }
        }
        const change = existing ? ("updated" as const) : ("new" as const);

        if (options.dryRun) {
          report.files.push({ fileRefId: fr.id, path: destPath, action: "download", change, ...meta });
          report.downloaded++;
          return;
        }

        try {
          const bytes = await this.files.downloadFileRef(fr.id, destPath);
          const entry: SyncStateEntry = {
            fileRefId: fr.id,
            chdate,
            localPath: destPath,
            downloadedAt: new Date().toISOString(),
          };
          state.entries[fr.id] = entry;
          report.downloaded++;
          report.bytes += bytes;
          report.files.push({ fileRefId: fr.id, path: destPath, action: "download", change, ...meta });
        } catch (e) {
          report.failed++;
          const msg = e instanceof Error ? e.message : String(e);
          report.errors.push({ fileRefId: fr.id, message: msg });
          report.files.push({ fileRefId: fr.id, path: destPath, action: "fail", ...meta });
        }
      });

      await runPool(tasks, concurrency);
    }

    if (!options.dryRun) await this.saveState(state);
    return report;
  }
}

/** A local file name from a Stud.IP name; "." and ".." (or only dots) are never a path. */
export function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim();
  if (!cleaned) return "file";
  return /^\.+$/.test(cleaned) ? "_" : cleaned;
}

/** True when `path` lies inside `dir` (not `dir` itself, not beside it). */
export function isInside(dir: string, path: string): boolean {
  const rel = relative(resolve(dir), resolve(path));
  return !!rel && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

async function runPool(tasks: Array<() => Promise<void>>, concurrency: number): Promise<void> {
  const queue = [...tasks];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const task = queue.shift();
      if (task) await task();
    }
  });
  await Promise.all(workers);
}
