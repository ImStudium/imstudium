import { join } from "node:path";
import type { StudiumCourse, StudiumWorkspace } from "./types.js";
import { ImstudiumError } from "./errors.js";

/** Uniform layout: `{semesterSlug}/{courseSlug}/` for every term. */
export function courseRelativePath(semesterSlug: string, courseSlug: string): string {
  return `${semesterSlug}/${courseSlug}`;
}

export function semesterFolderSlug(
  ctx: { slug: string } | null,
  allSemesters?: boolean,
): string {
  if (allSemesters) return "all";
  return ctx?.slug ?? "current";
}

export function resolveCourseDir(
  workspaceRoot: string,
  course: Pick<StudiumCourse, "path" | "slug">,
  ws?: Pick<StudiumWorkspace, "activeSemester">,
): string {
  if (course.path) return join(workspaceRoot, course.path);
  const folder = ws?.activeSemester?.slug || "current";
  return join(workspaceRoot, folder, course.slug);
}

/**
 * Personal shortcuts ("nlp" → "natural language processing") come from
 * config.courseAliases or IMSTUDIUM_COURSE_ALIASES ("nlp=natural language processing,de=data engineering").
 */
function courseAliases(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of (process.env.IMSTUDIUM_COURSE_ALIASES ?? "").split(",")) {
    const i = pair.indexOf("=");
    if (i > 0) out[pair.slice(0, i).trim().toLowerCase()] = pair.slice(i + 1).trim().toLowerCase();
  }
  return out;
}

/** What the course resolver needs to know about a course (workspace or live enrollment). */
export interface CourseCandidate {
  id: string;
  title: string;
  slug: string;
  courseNumber?: string;
  semester?: string;
  semesterId?: string;
}

/**
 * The one course resolver: Stud.IP id (32 hex), personal alias, course
 * number, slug or title fragment. Exact title/slug/number matches beat
 * fragments. Several matches resolve only by a stated rule — exactly one in
 * the focus semester, or one course enrolled in several terms (same title:
 * the last listed, i.e. newest) — and otherwise throw COURSE_AMBIGUOUS with
 * `details.candidates`. Never a silent first match. No match →
 * COURSE_NOT_FOUND with `details.available`.
 */
export function resolveCourseQuery<T extends CourseCandidate>(
  candidates: readonly T[],
  query: string,
  options: { aliases?: Record<string, string>; focusSemesterId?: string } = {},
): T {
  const raw = query.trim();
  const q = raw.toLowerCase();
  const byId = raw ? candidates.find((c) => c.id === raw) : undefined;
  if (byId) return byId;

  const expanded = options.aliases?.[q] ?? courseAliases()[q] ?? q;
  const dashed = expanded.replace(/\s+/g, "-");
  const title = (c: T) => c.title.toLowerCase();
  const slug = (c: T) => c.slug.toLowerCase();
  const number = (c: T) => (c.courseNumber ?? "").toLowerCase();

  const exact = q
    ? candidates.filter((c) => title(c) === expanded || slug(c) === q || slug(c) === dashed || (number(c) !== "" && number(c) === q))
    : [];
  const pool = exact.length
    ? exact
    : q
      ? candidates.filter((c) => title(c).includes(expanded) || slug(c).includes(q) || slug(c).includes(dashed))
      : [];

  if (pool.length === 1) return pool[0]!;
  if (pool.length === 0) {
    throw new ImstudiumError(`No course matches "${query}"`, "COURSE_NOT_FOUND", 404, undefined, {
      available: candidates.map((c) => c.title),
    });
  }
  if (options.focusSemesterId) {
    const inFocus = pool.filter((c) => c.semesterId === options.focusSemesterId);
    if (inFocus.length === 1) return inFocus[0]!;
  }
  if (new Set(pool.map(title)).size === 1) return pool[pool.length - 1]!;
  throw new ImstudiumError(`"${query}" matches ${pool.length} courses — pass a longer title fragment or the id`, "COURSE_AMBIGUOUS", undefined, undefined, {
    candidates: pool.map((c) => ({ id: c.id, title: c.title, ...(c.semester ? { semester: c.semester } : {}) })),
  });
}

/** A course of a loaded workspace (focus semester from the workspace). Throws like resolveCourseQuery. */
export function resolveWorkspaceCourse(ws: StudiumWorkspace, query: string, aliases: Record<string, string> = {}): StudiumCourse {
  return resolveCourseQuery(ws.courses, query, { aliases, focusSemesterId: ws.activeSemester?.id });
}

/**
 * @deprecated since 0.2.0 — use resolveWorkspaceCourse (throws instead of
 * guessing). Kept for SDK users: undefined when nothing matches, and
 * COURSE_AMBIGUOUS when several do.
 */
export function pickCourse(
  ws: StudiumWorkspace,
  query: string,
  aliases: Record<string, string> = {},
): StudiumCourse | undefined {
  try {
    return resolveWorkspaceCourse(ws, query, aliases);
  } catch (e) {
    if (e instanceof ImstudiumError && e.code === "COURSE_NOT_FOUND") return undefined;
    throw e;
  }
}
