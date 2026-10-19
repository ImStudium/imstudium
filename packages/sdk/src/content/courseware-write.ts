/**
 * Writes rendered courseware into a target folder:
 *   <coursewareDir>/README.md                     units, outline, tasks
 *   <coursewareDir>/<unit-slug>/<NN>-<page>.md    one file per page
 *   <coursewareDir>/<unit-slug>/files/<name>      block files
 *
 * Idempotent: pages whose content hash is unchanged are not rewritten,
 * pages that vanished from Stud.IP are removed (only files we generated),
 * downloads are skipped when size and change date still match.
 * File transfer is injected (`fetchFile`) so this runs anywhere.
 */
import { readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ensureDir } from "../config.js";
import { coursewareTasksUrl, coursewareUnitsUrl, type CwTask } from "../resources/courseware.js";
import { outlineLines, type RenderedUnit } from "./courseware-render.js";
import { formatLocalDateTime, parseFrontmatter } from "./markdown.js";

/** Download one file-ref to `destPath`; resolves to bytes written. */
export type FileFetcher = (fileRefId: string, destPath: string) => Promise<number>;

export interface WriteOptions {
  fetchFile?: FileFetcher;
  /** Rewrite pages even when the hash matches. */
  force?: boolean;
  /** Compute what would change, write nothing. */
  dryRun?: boolean;
}

export interface FileWriteStats {
  downloaded: number;
  skipped: number;
  failed: number;
  bytes: number;
  errors: Array<{ fileRefId: string; message: string }>;
}

export interface WriteUnitResult {
  unitId: string;
  dir: string;
  pages: number;
  written: number;
  skipped: number;
  removed: number;
  files: FileWriteStats;
}

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

/** Write `text` unless the file already carries the same frontmatter hash. */
export async function writeMarkdownIfChanged(
  path: string,
  text: string,
  hash: string | null,
  options: Pick<WriteOptions, "force" | "dryRun">,
): Promise<"written" | "skipped"> {
  const existing = await readText(path);
  if (!options.force && existing !== null) {
    if (hash ? parseFrontmatter(existing).hash === hash : existing === text) return "skipped";
  }
  if (!options.dryRun) {
    await ensureDir(dirname(path));
    await writeFile(path, text);
  }
  return "written";
}

/** Remove generated markdown files (by frontmatter source) that are no longer expected. */
export async function removeStale(
  dir: string,
  keep: Set<string>,
  source: string,
  options: Pick<WriteOptions, "dryRun">,
): Promise<number> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const name of names) {
    if (!name.endsWith(".md") || name === "README.md" || keep.has(name)) continue;
    const text = await readText(join(dir, name));
    if (!text || parseFrontmatter(text).source !== source) continue;
    if (!options.dryRun) await rm(join(dir, name), { force: true });
    removed++;
  }
  return removed;
}

async function fileIsCurrent(path: string, size: number | null, chdate: string | null): Promise<boolean> {
  try {
    const st = await stat(path);
    if (size !== null && st.size !== size) return false;
    if (chdate) {
      const t = Date.parse(chdate);
      if (Number.isFinite(t) && Math.abs(st.mtimeMs - t) > 2000) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function writeCoursewareUnit(
  rendered: RenderedUnit,
  unitDir: string,
  options: WriteOptions = {},
): Promise<WriteUnitResult> {
  const result: WriteUnitResult = {
    unitId: rendered.unit.id,
    dir: unitDir,
    pages: rendered.elements.length,
    written: 0,
    skipped: 0,
    removed: 0,
    files: { downloaded: 0, skipped: 0, failed: 0, bytes: 0, errors: [] },
  };
  if (!options.dryRun) await ensureDir(unitDir);

  for (const el of rendered.elements) {
    const action = await writeMarkdownIfChanged(join(unitDir, el.path), el.markdown, el.hash, options);
    result[action]++;
  }
  result.removed = await removeStale(
    unitDir,
    new Set(rendered.elements.map((e) => e.path)),
    "studip-courseware",
    options,
  );

  for (const file of rendered.downloads) {
    const rel = rendered.fileNames[file.id];
    if (!rel) continue;
    const dest = join(unitDir, rel);
    if (!options.force && (await fileIsCurrent(dest, file.size, file.chdate))) {
      result.files.skipped++;
      continue;
    }
    if (!options.fetchFile || options.dryRun) {
      if (options.dryRun) result.files.downloaded++;
      continue;
    }
    try {
      await ensureDir(dirname(dest));
      result.files.bytes += await options.fetchFile(file.id, dest);
      if (file.chdate) {
        const t = new Date(file.chdate);
        if (!Number.isNaN(t.getTime())) await utimes(dest, new Date(), t).catch(() => undefined);
      }
      result.files.downloaded++;
    } catch (e) {
      result.files.failed++;
      result.files.errors.push({ fileRefId: file.id, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return result;
}

/** Folder names for units: slug of the title, de-duplicated in shelf order. */
export function unitFolderNames(units: RenderedUnit[]): string[] {
  const seen = new Map<string, number>();
  return units.map((u) => {
    const n = (seen.get(u.slug) ?? 0) + 1;
    seen.set(u.slug, n);
    return n === 1 ? u.slug : `${u.slug}-${n}`;
  });
}

export interface CoursewareIndexInput {
  courseId: string;
  courseTitle: string;
  origin: string;
  units: Array<{ rendered: RenderedUnit; folder: string }>;
  tasks: CwTask[];
}

/** Absolute dates and status only, so the index changes when Stud.IP does — not daily. */
function taskLine(t: CwTask): string {
  const due = t.deadline ? formatLocalDateTime(t.deadline) : "no deadline";
  const extra = [
    t.unitTitle,
    t.progress !== null && t.status !== "submitted" ? `${Math.round(t.progress)}% done` : null,
    t.renewal ? `extension ${t.renewal}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const title = t.url ? `[${t.title}](${t.url})` : t.title;
  return `- **${due}** · ${t.status} · ${title}${extra ? ` (${extra})` : ""}`;
}

/** courseware/README.md — pure, so the hosted app can render the same index. */
export function renderCoursewareIndex(input: CoursewareIndexInput): string {
  const lines = [
    "---",
    "source: studip-courseware-index",
    `course: ${input.courseId}`,
    "---",
    "",
    `# Courseware — ${input.courseTitle}`,
    "",
    `Read-only copy of the course's Stud.IP courseware. Open in Stud.IP: ${coursewareUnitsUrl(input.origin, input.courseId)}`,
    "",
  ];
  if (input.tasks.length) {
    lines.push("## Tasks and deadlines", "", ...input.tasks.map(taskLine), "", `All tasks: ${coursewareTasksUrl(input.origin, input.courseId)}`, "");
  }
  if (!input.units.length) lines.push("_No courseware units in this course._", "");
  for (const { rendered, folder } of input.units) {
    lines.push(`## ${rendered.unit.title}`, "");
    if (rendered.unit.description) lines.push(`_${rendered.unit.description}_`, "");
    lines.push(
      ...outlineLines(
        rendered.elements.map((e) => e.element),
        (el) => {
          const page = rendered.elements.find((e) => e.element.id === el.id)!;
          const label = el.number ? `${el.number} ${el.title}` : el.title;
          return `[${label}](${encodeURI(`${folder}/${page.path}`)})`;
        },
      ),
      "",
    );
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
