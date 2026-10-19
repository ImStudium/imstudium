import {
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
    const hit = pickCourse(ws, query);
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

/** Forget the cached workspace (after a sync rewrote studium.json). */
export function resetCourseCache(): void {
  workspaceCache = undefined;
}
