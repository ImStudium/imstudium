import { access, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { StudIpClient } from "./client.js";
import type { JsonApiResource } from "./types.js";
import { ensureDir } from "./config.js";
import { cachedJson } from "./cache.js";

export type SemesterResource = JsonApiResource<"semesters"> & {
  attributes?: {
    title?: string;
    description?: string;
    start?: string;
    end?: string;
  };
};

export type CourseWithSemester = JsonApiResource<"courses"> & {
  relationships?: Record<
    string,
    { data?: { type: string; id: string } | { type: string; id: string }[] | null }
  >;
};

export function semesterSlug(title: string): string {
  return title.replace(/\s+/g, "").replace(/\//g, "-");
}

export function semesterIdFromRelationships(
  course: CourseWithSemester,
  key: "start-semester" | "end-semester",
): string | undefined {
  const rel = course.relationships?.[key]?.data;
  if (!rel || Array.isArray(rel)) return undefined;
  return rel.id;
}

/** Course runs during target semester (start/end range overlaps). */
export function courseActiveInSemester(
  course: CourseWithSemester,
  target: SemesterResource,
  allSemesters: SemesterResource[],
): boolean {
  const byId = new Map(allSemesters.map((s) => [s.id, s]));
  const startId = semesterIdFromRelationships(course, "start-semester");
  const endId = semesterIdFromRelationships(course, "end-semester") || startId;
  if (!startId) return false;

  const startSem = byId.get(startId);
  const endSem = byId.get(endId || startId);
  if (!startSem || !endSem) return startId === target.id;

  const courseStart = Date.parse(String(startSem.attributes?.start));
  const courseEnd = Date.parse(String(endSem.attributes?.end));
  const targetStart = Date.parse(String(target.attributes?.start));
  const targetEnd = Date.parse(String(target.attributes?.end));
  if ([courseStart, courseEnd, targetStart, targetEnd].some(Number.isNaN)) {
    return startId === target.id || endId === target.id;
  }
  return courseStart <= targetEnd && courseEnd >= targetStart;
}

/** Semester whose [start, end] contains `at`, searched within an already-fetched list. */
export function findCurrentSemester(
  all: SemesterResource[],
  at = new Date(),
): SemesterResource | null {
  const now = at.getTime();
  return (
    all.find((s) => {
      const start = Date.parse(String(s.attributes?.start));
      const end = Date.parse(String(s.attributes?.end));
      return start <= now && now <= end;
    }) ?? null
  );
}

/** Match "SS 2026", "WS2025-26", partial title. */
export function resolveSemesterByLabel(
  all: SemesterResource[],
  label: string,
): SemesterResource | null {
  const norm = label.trim().toLowerCase().replace(/\s+/g, "");
  return (
    all.find((s) => {
      const title = String(s.attributes?.title || "");
      const slug = semesterSlug(title).toLowerCase();
      return (
        title.toLowerCase() === label.trim().toLowerCase() ||
        slug === norm ||
        slug.includes(norm) ||
        norm.includes(slug)
      );
    }) ?? null
  );
}

export interface SemesterProgress {
  weekNumber: number;
  daysElapsed: number;
  daysTotal: number;
  progressPercent: number;
}

/** Where a semester stands right now — powers the "week 5 of 26" temporal banner. */
export function computeSemesterProgress(
  semester: SemesterResource,
  at = new Date(),
): SemesterProgress | undefined {
  const start = Date.parse(String(semester.attributes?.start));
  const end = Date.parse(String(semester.attributes?.end));
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return undefined;

  const now = at.getTime();
  const daysTotal = Math.max(1, Math.round((end - start) / 86_400_000));
  const daysElapsed = Math.max(0, Math.min(daysTotal, Math.round((now - start) / 86_400_000)));
  const weekNumber = Math.max(1, Math.ceil((daysElapsed + 1) / 7));
  const progressPercent = Math.round((daysElapsed / daysTotal) * 100);
  return { weekNumber, daysElapsed, daysTotal, progressPercent };
}

/**
 * Relative folder for a semester's course files.
 * Current semester lives at workspace root (e.g. `SS2026/`); anything else is
 * explicitly archived (e.g. `archive/WS2025-26/`) so the root stays focused.
 */
export function resolveWorkspaceFolder(
  ctx: { slug: string; isCurrent: boolean } | null,
  allSemesters?: boolean,
): string {
  if (allSemesters) return "all";
  if (!ctx) return "current";
  return ctx.isCurrent ? ctx.slug : `archive/${ctx.slug}`;
}

export class SemestersResource {
  constructor(private client: StudIpClient) {}

  /** Public and slow-changing: cached for a day per instance. */
  async listAll(): Promise<SemesterResource[]> {
    return cachedJson(`semesters:${this.client.apiBase}`, 24 * 3_600_000, () =>
      this.client.paginateAll<SemesterResource>("/semesters", { "page[limit]": "100" }),
    );
  }

  async get(semesterId: string): Promise<SemesterResource> {
    const doc = await this.client.get<SemesterResource>(`/semesters/${semesterId}`);
    if (!doc.data || Array.isArray(doc.data)) throw new Error("Semester not found");
    return doc.data;
  }

  /** Semester whose [start, end] contains now. */
  async getCurrent(at = new Date()): Promise<SemesterResource | null> {
    const all = await this.listAll();
    return findCurrentSemester(all, at);
  }

  /** Match "SS 2026", "WS2025-26", partial title. */
  resolveByLabel(all: SemesterResource[], label: string): SemesterResource | null {
    return resolveSemesterByLabel(all, label);
  }

  /** Recent + current + next semesters, for surfacing "other semesters available". */
  recentWindow(all: SemesterResource[], current: SemesterResource | null, count = 6): SemesterResource[] {
    if (!current) return all.slice(-count);
    const idx = all.findIndex((s) => s.id === current.id);
    if (idx === -1) return all.slice(-count);
    const start = Math.max(0, idx - (count - 2));
    return all.slice(start, idx + 2);
  }
}

export function filterCoursesForSemester(
  courses: CourseWithSemester[],
  target: SemesterResource,
  allSemesters: SemesterResource[],
): CourseWithSemester[] {
  return courses.filter((c) => courseActiveInSemester(c, target, allSemesters));
}

/**
 * One-time cleanup: earlier versions synced everything into a generic
 * `current/` folder. Once we know the real semester slug, move any leftover
 * `current/` folder out of the way into `archive/legacy-current/` instead of
 * silently mixing old and new data. No-op if `current/` doesn't exist or the
 * new folder actually is named "current".
 */
export async function migrateLegacyCurrentFolder(
  workspacePath: string,
  activeFolder: string,
): Promise<string | null> {
  if (activeFolder === "current") return null;
  const legacyDir = join(workspacePath, "current");
  const archiveDir = join(workspacePath, "archive", "legacy-current");

  try {
    await access(legacyDir);
  } catch {
    return null;
  }
  try {
    await access(archiveDir);
    return null;
  } catch {
    // does not exist yet — safe to migrate
  }

  try {
    await ensureDir(dirname(archiveDir));
    await rename(legacyDir, archiveDir);
    return archiveDir;
  } catch {
    return null;
  }
}
