import { join } from "node:path";
import type { StudiumCourse, StudiumWorkspace } from "./types.js";

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

const COURSE_ALIASES: Record<string, string> = {
  nlp: "natural language processing",
  de: "data engineering",
  gki: "generative",
};

export function pickCourse(ws: StudiumWorkspace, query: string): StudiumCourse | undefined {
  const q = query.trim().toLowerCase();
  const expanded = COURSE_ALIASES[q] ?? q;
  const matches = ws.courses.filter(
    (c) =>
      c.id === query ||
      c.title.toLowerCase().includes(expanded) ||
      c.slug.toLowerCase().includes(q) ||
      c.slug.toLowerCase().includes(expanded.replace(/\s+/g, "-")),
  );
  if (matches.length === 0) return undefined;
  if (matches.length === 1) return matches[0];
  const activeId = ws.activeSemester?.id;
  if (activeId) {
    const inFocus = matches.find((c) => c.semesterId === activeId);
    if (inFocus) return inFocus;
  }
  return matches[0];
}
