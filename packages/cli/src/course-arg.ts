import {
  expandPath,
  ImstudiumError,
  pickCourse,
  resolveCourseDir,
  slugify,
  type StudiumWorkspace,
} from "@imstudium/sdk";
import type { Sdk } from "./runtime.js";
import { meId } from "./me.js";

export interface CourseRef {
  id: string;
  title: string;
  slug: string;
  /** Local course folder when the course is in the workspace. */
  dir?: string;
  semester?: string;
}

const STUDIP_ID = /^[0-9a-f]{32}$/i;

let workspaceCache: StudiumWorkspace | null | undefined;

async function workspace(sdk: Sdk): Promise<StudiumWorkspace | null> {
  if (workspaceCache === undefined) {
    workspaceCache = await sdk.studium.loadWorkspace(sdk.workspacePath).catch(() => null);
  }
  return workspaceCache;
}

/**
 * Resolve "nlp", "Data Engineering", a slug, a course number or a Stud.IP id.
 * The local workspace answers first (offline, instant); the live enrollment
 * list across all semesters is the fallback.
 */
export async function resolveCourse(sdk: Sdk, query: string): Promise<CourseRef> {
  const ws = await workspace(sdk);
  if (ws) {
    const hit = pickCourse(ws, query, sdk.config.courseAliases);
    if (hit) {
      return {
        id: hit.id,
        title: hit.title,
        slug: hit.slug,
        dir: resolveCourseDir(sdk.workspacePath, hit, ws),
        semester: hit.semester,
      };
    }
  }

  if (STUDIP_ID.test(query)) {
    const course = await sdk.courses.get(query);
    const title = String(course.attributes?.title ?? query);
    return { id: course.id, title, slug: slugify(title) };
  }

  const all = await sdk.courses.listMine(await meId(sdk), { allSemesters: true });
  const q = query.trim().toLowerCase();
  const matches = all.filter((c) => {
    const title = String(c.attributes?.title ?? "").toLowerCase();
    const number = String(c.attributes?.["course-number"] ?? "").toLowerCase();
    return title.includes(q) || slugify(title).toLowerCase().includes(q) || (number && number === q);
  });
  if (matches.length === 0) {
    throw new ImstudiumError(
      `No course matches "${query}"`,
      "COURSE_NOT_FOUND",
      404,
      "imstudium courses list shows your courses; pass a title fragment, slug or id.",
    );
  }
  const course = matches[matches.length - 1]!; // newest enrollment wins
  const title = String(course.attributes?.title ?? course.id);
  return { id: course.id, title, slug: slugify(title) };
}

/** Courses of the focus semester — from the workspace when present, else live. */
export async function currentCourses(sdk: Sdk): Promise<CourseRef[]> {
  const ws = await workspace(sdk);
  const end = ws?.activeSemester?.end ? Date.parse(ws.activeSemester.end) : NaN;
  const stale = Number.isFinite(end) && end < Date.now(); // workspace still on last semester
  if (ws?.courses.length && !stale) {
    return ws.courses
      .filter((c) => !ws.activeSemester?.id || !c.semesterId || c.semesterId === ws.activeSemester.id)
      .map((c) => ({
        id: c.id,
        title: c.title,
        slug: c.slug,
        dir: resolveCourseDir(sdk.workspacePath, c, ws),
        semester: c.semester,
      }));
  }
  const live = await sdk.courses.listMine(await meId(sdk));
  return live.map((c) => {
    const title = String(c.attributes?.title ?? c.id);
    return { id: c.id, title, slug: slugify(title) };
  });
}

/**
 * A course of a loaded workspace by title fragment, shortcut, slug or id —
 * the offline resolver for commands that only make sense on synced courses
 * (extract, index, view, changes, search). Throws COURSE_NOT_FOUND.
 */
export function workspaceCourse(sdk: Pick<Sdk, "config">, ws: StudiumWorkspace, query: string): StudiumWorkspace["courses"][number] {
  const hit = pickCourse(ws, query, sdk.config.courseAliases);
  if (!hit) {
    throw new ImstudiumError(`No course in the workspace matches "${query}"`, "COURSE_NOT_FOUND", 404, "Pass a title fragment, shortcut, slug or id", {
      available: ws.courses.map((c) => c.title),
    });
  }
  return hit;
}

/**
 * Run `fn` for each course in parallel. With `strict` (one course the
 * student named) errors surface; otherwise a course that fails (no access,
 * tool disabled) is noted on stderr and skipped.
 */
export async function perCourse<T>(
  courses: CourseRef[],
  fn: (c: CourseRef) => Promise<T>,
  options: { strict?: boolean; onSkip?: (course: CourseRef, message: string) => void } = {},
): Promise<Array<{ course: CourseRef; value: T }>> {
  if (options.strict) return Promise.all(courses.map(async (course) => ({ course, value: await fn(course) })));
  const settled = await Promise.allSettled(courses.map(async (course) => ({ course, value: await fn(course) })));
  const out: Array<{ course: CourseRef; value: T }> = [];
  settled.forEach((s, i) => {
    if (s.status === "fulfilled") out.push(s.value);
    else options.onSkip?.(courses[i]!, s.reason instanceof Error ? s.reason.message : String(s.reason));
  });
  return out;
}

/** The course's workspace folder, or WORKSPACE_MISSING (for --save). `override` (-o) wins. */
export function courseDir(course: CourseRef, workspacePath: string, override?: string): string {
  if (override) return expandPath(override);
  if (course.dir) return course.dir;
  throw new ImstudiumError(
    `${course.title} is not in your workspace yet`,
    "WORKSPACE_MISSING",
    undefined,
    `Run imstudium sync first, or pass -o <course folder> (workspace: ${workspacePath})`,
  );
}

/** Forget the cached workspace (after a sync rewrote studium.json). */
export function resetCourseCache(): void {
  workspaceCache = undefined;
}
