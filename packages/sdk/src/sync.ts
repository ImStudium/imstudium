import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { StudIpClient } from "./client.js";
import { CoursesResource } from "./resources/courses.js";
import { FilesResource, NewsResource, WikiResource } from "./resources/files.js";
import { ScheduleResource } from "./resources/courses.js";
import { paths, ensureDir, slugify } from "./config.js";
import type { SyncReport, SyncState, SyncStateEntry } from "./types.js";

export interface SyncOptions {
  outputDir: string;
  layout?: "flat" | "tree";
  dryRun?: boolean;
  concurrency?: number;
  include?: Array<"wiki" | "news" | "calendar">;
  courseFilter?: (course: { id: string; title: string }) => boolean;
  semesterLabel?: string;
}

export class SyncEngine {
  private courses: CoursesResource;
  private files: FilesResource;
  private wiki: WikiResource;
  private news: NewsResource;
  private schedule: ScheduleResource;

  constructor(client: StudIpClient) {
    this.courses = new CoursesResource(client);
    this.files = new FilesResource(client);
    this.wiki = new WikiResource(client);
    this.news = new NewsResource(client);
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
    const allCourses = await this.courses.listMine(me.id);
    const layout = options.layout ?? "flat";
    const concurrency = options.concurrency ?? 8;

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
      const semester = options.semesterLabel || "current";
      const courseSlug = slugify(title);
      const courseDir = join(options.outputDir, semester, courseSlug);

      if (options.include?.includes("wiki")) {
        try {
          if (!options.dryRun) {
            await this.wiki.exportCourseWiki(course.id, join(courseDir, "wiki"));
          }
        } catch (e) {
          report.errors.push({
            fileRefId: `wiki:${course.id}`,
            message: e instanceof Error ? e.message : String(e),
          });
        }
      }

      if (options.include?.includes("news")) {
        try {
          if (!options.dryRun) {
            await this.news.exportCourseNews(course.id, join(courseDir, "news"));
          }
        } catch (e) {
          report.errors.push({
            fileRefId: `news:${course.id}`,
            message: e instanceof Error ? e.message : String(e),
          });
        }
      }

      const fileRefs = await this.files.listAllFileRefs(course.id);
      const folders = layout === "tree" ? await this.files.listAllFolders(course.id) : [];
      const folderPaths = layout === "tree" ? this.files.folderPathMap(folders) : new Map();

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
        if (existing && existing.chdate === chdate && existing.localPath === destPath) {
          report.skipped++;
          report.files.push({ fileRefId: fr.id, path: destPath, action: "skip" });
          return;
        }

        if (options.dryRun) {
          report.files.push({ fileRefId: fr.id, path: destPath, action: "download" });
          report.downloaded++;
          return;
        }

        try {
          const bytes = await this.files.downloadFileRef(fr.id, destPath);
          let etag: string | undefined;
          try {
            etag = await this.files.headFileRef(fr.id);
          } catch {
            // optional
          }
          const entry: SyncStateEntry = {
            fileRefId: fr.id,
            chdate,
            etag,
            localPath: destPath,
            downloadedAt: new Date().toISOString(),
          };
          state.entries[fr.id] = entry;
          report.downloaded++;
          report.bytes += bytes;
          report.files.push({ fileRefId: fr.id, path: destPath, action: "download" });
        } catch (e) {
          report.failed++;
          const msg = e instanceof Error ? e.message : String(e);
          report.errors.push({ fileRefId: fr.id, message: msg });
          report.files.push({ fileRefId: fr.id, path: destPath, action: "fail" });
        }
      });

      await runPool(tasks, concurrency);
    }

    if (!options.dryRun) await this.saveState(state);
    return report;
  }
}

export function sanitizeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, "_").trim() || "file";
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
