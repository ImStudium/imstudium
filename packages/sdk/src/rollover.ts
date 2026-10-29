import { access, copyFile, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ensureDir, paths } from "./config.js";
import type { StudiumWorkspace, SyncState } from "./types.js";

/** Folder names the workspace uses for semesters: SS2026, WS2026-27. */
export const SEMESTER_FOLDER = /^(SS|WS)\d{4}(-\d{2})?$/;

export interface RolloverMove {
  slug: string;
  from: string;
  to: string;
}

export interface RolloverPlan {
  workspacePath: string;
  currentSlug: string;
  moves: RolloverMove[];
  /** Folders that could not move because archive/<slug> already exists. */
  conflicts: string[];
}

export interface RolloverResult extends RolloverPlan {
  moved: string[];
  syncStateRewritten: number;
  corpusFilesRewritten: number;
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Semester start: every semester folder at the workspace root that is not
 * the current semester moves to archive/<slug>. Nothing is deleted.
 */
export async function planRollover(workspacePath: string, currentSlug: string): Promise<RolloverPlan> {
  const plan: RolloverPlan = { workspacePath, currentSlug, moves: [], conflicts: [] };
  let entries: string[] = [];
  try {
    entries = (await readdir(workspacePath, { withFileTypes: true }))
      .filter((d) => d.isDirectory() && SEMESTER_FOLDER.test(d.name))
      .map((d) => d.name);
  } catch {
    return plan;
  }
  for (const slug of entries.sort()) {
    if (slug === currentSlug) continue;
    const to = join(workspacePath, "archive", slug);
    if (await exists(to)) plan.conflicts.push(slug);
    else plan.moves.push({ slug, from: join(workspacePath, slug), to });
  }
  return plan;
}

const PATH_KEYS = ["ref", "coursePath", "path", "corpusPath"];

/** Rewrite path-like values (`"ref":"SS2026/…"`) to `archive/SS2026/…`; text stays as it is. */
export function rewriteRelativeRefs(text: string, slug: string): string {
  const escaped = slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const keys = PATH_KEYS.join("|");
  return text.replace(new RegExp(`("(?:${keys})"\\s*:\\s*")${escaped}/`, "g"), `$1archive/${slug}/`);
}

async function rewriteSearchFiles(dir: string, slug: string): Promise<number> {
  let count = 0;
  let courses: string[] = [];
  try {
    courses = (await readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return 0;
  }
  for (const course of courses) {
    for (const name of ["corpus.jsonl", "materials.json", "index.json"]) {
      const file = join(dir, course, "search", name);
      try {
        const before = await readFile(file, "utf-8");
        const after = rewriteRelativeRefs(before, slug);
        if (after !== before) {
          await writeFile(file, after);
          count++;
        }
      } catch {
        // course without that file
      }
    }
  }
  return count;
}

/** Keep the sync state pointing at the moved files so nothing downloads twice. */
async function rewriteSyncState(moves: RolloverMove[], stateFile: string): Promise<number> {
  let state: SyncState;
  try {
    state = JSON.parse(await readFile(stateFile, "utf-8")) as SyncState;
  } catch {
    return 0;
  }
  let n = 0;
  for (const entry of Object.values(state.entries)) {
    for (const m of moves) {
      if (entry.localPath.startsWith(`${m.from}/`)) {
        entry.localPath = m.to + entry.localPath.slice(m.from.length);
        n++;
        break;
      }
    }
  }
  if (n) await writeFile(stateFile, JSON.stringify(state, null, 2));
  return n;
}

/**
 * Snapshot the outgoing semester's overview into its archive folder so the
 * archive stays self-describing (semester.json, STUDIUM.md, klausuren.md).
 */
async function snapshotOverview(workspacePath: string, move: RolloverMove): Promise<void> {
  let ws: StudiumWorkspace | null = null;
  try {
    ws = JSON.parse(await readFile(join(workspacePath, "studium.json"), "utf-8")) as StudiumWorkspace;
  } catch {
    return;
  }
  if (!ws || (ws.workspaceFolder !== move.slug && ws.activeSemester?.slug !== move.slug)) return;
  const archived: StudiumWorkspace = {
    ...ws,
    workspaceFolder: `archive/${move.slug}`,
    activeSemester: { ...ws.activeSemester, isCurrent: false },
    courses: ws.courses.map((c) => ({
      ...c,
      path: c.path?.startsWith(`${move.slug}/`) ? `archive/${c.path}` : c.path,
      search: c.search
        ? { ...c.search, corpusPath: c.search.corpusPath.replace(new RegExp(`^${move.slug}/`), `archive/${move.slug}/`) }
        : c.search,
    })),
  };
  await writeFile(join(move.to, "semester.json"), JSON.stringify(archived, null, 2));
  for (const name of ["STUDIUM.md", "klausuren.md"]) {
    await copyFile(join(workspacePath, name), join(move.to, name)).catch(() => undefined);
  }
}

export async function applyRollover(
  plan: RolloverPlan,
  options: { syncStateFile?: string } = {},
): Promise<RolloverResult> {
  const result: RolloverResult = { ...plan, moved: [], syncStateRewritten: 0, corpusFilesRewritten: 0 };
  if (!plan.moves.length) return result;
  await ensureDir(join(plan.workspacePath, "archive"));
  for (const move of plan.moves) {
    await rename(move.from, move.to);
    result.moved.push(move.slug);
    result.corpusFilesRewritten += await rewriteSearchFiles(move.to, move.slug);
    await snapshotOverview(plan.workspacePath, move);
  }
  result.syncStateRewritten = await rewriteSyncState(
    plan.moves.filter((m) => result.moved.includes(m.slug)),
    options.syncStateFile ?? paths.syncStateFile,
  );
  return result;
}

/** Archived semesters with their course count, newest first. */
export async function listArchivedSemesters(
  workspacePath: string,
): Promise<Array<{ slug: string; title?: string; courses: number; path: string }>> {
  const dir = join(workspacePath, "archive");
  let names: string[] = [];
  try {
    names = (await readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
  const out = [];
  for (const slug of names) {
    let title: string | undefined;
    let courses = 0;
    try {
      const ws = JSON.parse(await readFile(join(dir, slug, "semester.json"), "utf-8")) as StudiumWorkspace;
      title = ws.activeSemester?.title;
      courses = ws.courses.length;
    } catch {
      courses = (await readdir(join(dir, slug), { withFileTypes: true }).catch(() => [])).filter((d) =>
        d.isDirectory(),
      ).length;
    }
    out.push({ slug, title, courses, path: `archive/${slug}` });
  }
  return out.sort((a, b) => semesterSortKey(b.slug) - semesterSortKey(a.slug));
}

/** SS2026 → 2026.0, WS2026-27 → 2026.5 */
export function semesterSortKey(slug: string): number {
  const m = slug.match(/^(SS|WS)(\d{4})/);
  if (!m) return -1;
  return Number(m[2]) + (m[1] === "WS" ? 0.5 : 0);
}
