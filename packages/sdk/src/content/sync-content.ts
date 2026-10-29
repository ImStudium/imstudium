/**
 * One call per course that mirrors learning content into the workspace:
 *   <courseDir>/courseware/…   (units, pages, block files, README with tasks)
 *   <courseDir>/wiki/…         (page tree + README)
 * and returns the course's courseware tasks so callers can surface deadlines.
 *
 * Dependencies are injected, so the hosted sync service can pass its own
 * loaders/transport and a different target directory.
 */
import { join } from "node:path";
import type { CoursewareResource, CwTask, CwUnit } from "../resources/courseware.js";
import { renderWiki, writeWiki, type WikiResource } from "../resources/wiki.js";
import { renderUnit } from "./courseware-render.js";
import {
  renderCoursewareIndex,
  unitFolderNames,
  writeCoursewareUnit,
  writeMarkdownIfChanged,
  type FileFetcher,
  type FileWriteStats,
} from "./courseware-write.js";

export interface ContentSyncDeps {
  courseware: Pick<CoursewareResource, "listCourseUnits" | "loadUnitContent" | "listTasks">;
  wiki: Pick<WikiResource, "listPages">;
  /** Downloads one file-ref to a path. Omit to skip block files. */
  fetchFile?: FileFetcher;
  /** Instance origin for Stud.IP links, e.g. https://digicampus.uni-augsburg.de */
  origin: string;
}

export type ContentPart = "courseware" | "wiki" | "tasks";

export interface ContentSyncOptions {
  /** Default: all three. */
  include?: ContentPart[];
  /** Only units whose id equals or whose title contains this (case-insensitive). */
  unit?: string;
  /** Download block files (default true when deps.fetchFile is set). */
  downloadFiles?: boolean;
  force?: boolean;
  dryRun?: boolean;
  now?: Date;
}

export interface ContentSyncResult {
  courseId: string;
  courseTitle: string;
  courseware: {
    dir: string;
    units: number;
    pages: number;
    written: number;
    skipped: number;
    removed: number;
    files: FileWriteStats;
  } | null;
  wiki: { dir: string; pages: number; written: number; skipped: number; removed: number } | null;
  /** Courseware tasks, soonest deadline first — feed these into deadline views. */
  tasks: CwTask[];
  errors: Array<{ scope: "courseware" | "wiki" | "tasks" | "unit"; id?: string; message: string }>;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function matchUnit(unit: CwUnit, query: string): boolean {
  const q = query.trim().toLowerCase();
  return unit.id === query || unit.title.toLowerCase().includes(q);
}

/** Build deps from a createSdk() result (CLI and local sync). */
export function contentDeps(sdk: {
  courseware: CoursewareResource;
  wiki: WikiResource;
  files: { downloadFileRef(id: string, dest: string): Promise<number> };
  config: { instanceOrigin: string };
}): ContentSyncDeps {
  return {
    courseware: sdk.courseware,
    wiki: sdk.wiki,
    fetchFile: (id, dest) => sdk.files.downloadFileRef(id, dest),
    origin: sdk.config.instanceOrigin,
  };
}

export async function syncContent(
  deps: ContentSyncDeps,
  course: { id: string; title: string },
  courseDir: string,
  opts: ContentSyncOptions = {},
): Promise<ContentSyncResult> {
  const include = new Set<ContentPart>(opts.include ?? ["courseware", "wiki", "tasks"]);
  const result: ContentSyncResult = {
    courseId: course.id,
    courseTitle: course.title,
    courseware: null,
    wiki: null,
    tasks: [],
    errors: [],
  };
  const writeOpts = { force: opts.force, dryRun: opts.dryRun };

  let units: CwUnit[] = [];
  if (include.has("courseware") || include.has("tasks")) {
    try {
      units = await deps.courseware.listCourseUnits(course.id);
    } catch (e) {
      result.errors.push({ scope: "courseware", message: message(e) });
    }
  }

  if (include.has("tasks")) {
    try {
      result.tasks = await deps.courseware.listTasks(course.id, {
        courseTitle: course.title,
        unitTitles: Object.fromEntries(units.map((u) => [u.id, u.title])),
        origin: deps.origin,
        now: opts.now,
      });
    } catch (e) {
      result.errors.push({ scope: "tasks", message: message(e) });
    }
  }

  if (include.has("courseware")) {
    const dir = join(courseDir, "courseware");
    const stats: NonNullable<ContentSyncResult["courseware"]> = {
      dir,
      units: 0,
      pages: 0,
      written: 0,
      skipped: 0,
      removed: 0,
      files: { downloaded: 0, skipped: 0, failed: 0, bytes: 0, errors: [] },
    };
    const selected = opts.unit ? units.filter((u) => matchUnit(u, opts.unit!)) : units;
    const rendered = [];
    for (const unit of selected) {
      try {
        const content = await deps.courseware.loadUnitContent(unit);
        for (const err of content.errors) result.errors.push({ scope: "unit", id: err.elementId, message: err.message });
        rendered.push(renderUnit(content, { origin: deps.origin }));
      } catch (e) {
        result.errors.push({ scope: "unit", id: unit.id, message: message(e) });
      }
    }
    const folders = unitFolderNames(rendered);
    const download = opts.downloadFiles ?? true;
    for (const [i, r] of rendered.entries()) {
      const w = await writeCoursewareUnit(r, join(dir, folders[i]!), {
        ...writeOpts,
        fetchFile: download ? deps.fetchFile : undefined,
      });
      stats.units++;
      stats.pages += w.pages;
      stats.written += w.written;
      stats.skipped += w.skipped;
      stats.removed += w.removed;
      stats.files.downloaded += w.files.downloaded;
      stats.files.skipped += w.files.skipped;
      stats.files.failed += w.files.failed;
      stats.files.bytes += w.files.bytes;
      stats.files.errors.push(...w.files.errors);
    }
    // With a unit filter the index would be partial — keep the full one then.
    // Courses without courseware get no courseware/ folder at all.
    if (!opts.unit && (rendered.length || result.tasks.length)) {
      const readme = renderCoursewareIndex({
        courseId: course.id,
        courseTitle: course.title,
        origin: deps.origin,
        units: rendered.map((r, i) => ({ rendered: r, folder: folders[i]! })),
        tasks: result.tasks,
      });
      await writeMarkdownIfChanged(join(dir, "README.md"), readme, null, writeOpts);
    }
    result.courseware = stats;
  }

  if (include.has("wiki")) {
    try {
      const pages = await deps.wiki.listPages(course.id);
      const dir = join(courseDir, "wiki");
      if (pages.length) {
        const w = await writeWiki(renderWiki(pages, { origin: deps.origin, courseId: course.id, courseTitle: course.title }), dir, writeOpts);
        result.wiki = w;
      } else {
        result.wiki = { dir, pages: 0, written: 0, skipped: 0, removed: 0 };
      }
    } catch (e) {
      result.errors.push({ scope: "wiki", message: message(e) });
    }
  }

  return result;
}
