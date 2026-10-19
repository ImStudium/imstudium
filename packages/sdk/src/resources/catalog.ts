/**
 * Course catalog for semester planning — READ-ONLY.
 *
 * The `tree-node` routes are public on Stud.IP 6.1 (no login): course search
 * by title/number within a semester, the study-area tree, and per-course
 * details (lecturers, cycle text with rooms). `/courses`, `/modules` and
 * `/courses-of-study` need a session.
 */
import type { StudIpClient } from "../client.js";
import { ImstudiumError } from "../errors.js";
import { attr, htmlToText, Included, relId } from "../jsonapi.js";
import type { JsonApiResource } from "../types.js";
import { first, listOf, num, originOf, str } from "./attrs.js";

export interface CatalogCourse {
  id: string;
  number: string | null;
  title: string;
  subtitle: string | null;
  typeId: number | null;
  /** Veranstaltungstyp, e.g. "Vorlesung", "Seminar". */
  typeName: string | null;
  semesterId: string | null;
  memberCount: number | null;
  lecturers?: string[];
  /** Cycle lines from the details route, e.g. "Dienstag, 14:00 - 15:30, Wöchentlich (ab dem 13.10.26)". */
  dates?: string[];
  admission?: string | null;
  url: string;
}

export interface CatalogCourseDetails {
  courseId: string;
  semesterText: string | null;
  lecturers: Array<{ id: string; username: string | null; name: string }>;
  dates: string[];
  admission: string | null;
}

export interface StudyAreaNode {
  /** Plain study-area id (without the "StudipStudyArea_" prefix). */
  id: string;
  name: string;
  description: string | null;
  hasChildren: boolean;
  /** Names from the top level down to this node (root omitted). */
  path: string[];
}

export interface ModuleInfo {
  id: string;
  code: string | null;
  name: string;
  displayName: string | null;
  cp: number | null;
  cycle: string | null;
  semesterDuration: string | null;
  responsible: string | null;
  examinationPeriod: string | null;
}

export interface CourseOfStudyInfo {
  id: string;
  name: string;
  shortName: string | null;
  displayName: string | null;
  type: string | null;
  status: string | null;
}

export interface CatalogSearchOptions {
  q: string;
  semesterId?: string;
  /** Restrict to a study-area subtree (plain or prefixed id). */
  areaId?: string;
  limit?: number;
  /**
   * "tree" (default): public `/tree-node/…/courses` — works without login,
   * matches title and number. "courses": `/courses?filter[q]` (login needed),
   * can match lecturer names etc. via `fields`.
   */
  source?: "tree" | "courses";
  fields?: "all" | "title_lecturer_number" | "title" | "sub_title" | "lecturer" | "number" | "comment" | "scope";
}

// ---------------------------------------------------------------------------
// Normalisers (pure)
// ---------------------------------------------------------------------------

export function normalizeCatalogCourse(resource: JsonApiResource, included: Included, instanceOrigin: string): CatalogCourse {
  const semType = included.one(resource, "sem-type");
  return {
    id: resource.id,
    number: str(first(resource, "course-number")),
    title: str(first(resource, "title")) ?? resource.id,
    subtitle: str(first(resource, "subtitle")),
    typeId: num(first(resource, "course-type")) ?? num(relId(resource, "sem-type")),
    typeName: str(attr(semType, "name")),
    semesterId: relId(resource, "start-semester"),
    memberCount: num((resource.meta as Record<string, unknown> | undefined)?.["members-count"]),
    url: `${instanceOrigin.replace(/\/$/, "")}/dispatch.php/course/details?sem_id=${resource.id}`,
  };
}

/** `/tree-node/course/details/{id}` (plain JSON) → details. */
export function normalizeCatalogDetails(courseId: string, raw: unknown): CatalogCourseDetails {
  const r = (raw ?? {}) as Record<string, unknown>;
  const lecturers = Array.isArray(r.lecturers)
    ? (r.lecturers as Array<Record<string, unknown>>)
        .map((l) => ({ id: str(l.id) ?? "", username: str(l.username), name: str(l.name) ?? "" }))
        .filter((l) => l.name)
    : [];
  const html = typeof r.dates === "string" ? r.dates : "";
  const dates = [...html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)]
    .map((m) => htmlToText(m[1]).replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (!dates.length && html) {
    const text = htmlToText(html).replace(/\s+/g, " ").trim();
    if (text) dates.push(text);
  }
  const admission =
    r.admissionstate && typeof r.admissionstate === "object" ? str((r.admissionstate as Record<string, unknown>).info) : null;
  return { courseId, semesterText: str(r.semester), lecturers, dates, admission };
}

const TREE_PREFIX = "StudipStudyArea_";

/** "StudipStudyArea_<id>" for a plain id, "root" or an already-prefixed id. */
export function studyAreaNodeId(id?: string | null): string {
  if (!id || id === "root") return `${TREE_PREFIX}root`;
  return id.startsWith(TREE_PREFIX) ? id : `${TREE_PREFIX}${id}`;
}

export function normalizeStudyArea(resource: JsonApiResource): StudyAreaNode {
  const plainId = str(first(resource, "id")) ?? resource.id.replace(TREE_PREFIX, "");
  const ancestors = Array.isArray(resource.attributes?.ancestors)
    ? (resource.attributes!.ancestors as Array<Record<string, unknown>>)
    : [];
  const path = ancestors
    .filter((a) => a.id !== "root")
    .map((a) => str(a.name))
    .filter((n): n is string => !!n);
  const name = str(first(resource, "name")) ?? plainId;
  if (!path.length || path[path.length - 1] !== name) path.push(name);
  return {
    id: plainId,
    name,
    description: str(first(resource, "description", "info")),
    hasChildren: Boolean(first(resource, "has-children")),
    path,
  };
}

export function normalizeModule(resource: JsonApiResource): ModuleInfo {
  return {
    id: resource.id,
    code: str(first(resource, "code")),
    name: str(first(resource, "name", "display-name")) ?? resource.id,
    displayName: str(first(resource, "display-name")),
    cp: num(first(resource, "cp")),
    cycle: str(first(resource, "cycle")),
    semesterDuration: str(first(resource, "semester-duration")),
    responsible: str(htmlToText(first(resource, "responsible"))),
    examinationPeriod: str(first(resource, "examination-period")),
  };
}

export function normalizeCourseOfStudy(resource: JsonApiResource): CourseOfStudyInfo {
  return {
    id: resource.id,
    name: str(first(resource, "name", "display-name")) ?? resource.id,
    shortName: str(first(resource, "short-name")),
    displayName: str(first(resource, "display-name")),
    type: str(first(resource, "type")),
    status: str(first(resource, "status-name", "status")),
  };
}

// ---------------------------------------------------------------------------
// Resource
// ---------------------------------------------------------------------------

export class CatalogResource {
  constructor(private client: StudIpClient) {}

  get instanceOrigin(): string {
    return originOf(this.client.apiBase);
  }

  async search(options: CatalogSearchOptions): Promise<{ courses: CatalogCourse[]; total: number | null; source: "tree" | "courses" }> {
    const q = options.q.trim();
    if (q.length < 3) {
      throw new ImstudiumError("Search term too short — Stud.IP needs at least 3 characters.", "BAD_ARGS", 400);
    }
    const limit = Math.max(1, Math.min(options.limit ?? 20, 100));
    const source = options.source ?? (options.fields && options.fields !== "all" ? "courses" : "tree");
    const page =
      source === "tree"
        ? await this.client.paginate(
            `/tree-node/${studyAreaNodeId(options.areaId)}/courses`,
            { filter: { q, semester: options.semesterId, recursive: 1 }, include: "sem-type", page: { limit } },
            { max: limit },
          )
        : await this.client.paginate(
            `/courses`,
            { filter: { q, semester: options.semesterId, fields: options.fields }, include: "sem-type", page: { limit } },
            { max: limit },
          );
    const included = new Included(page.included);
    return {
      courses: page.data.map((c) => normalizeCatalogCourse(c, included, this.instanceOrigin)),
      total: page.total ?? null,
      source,
    };
  }

  /** Public course details: lecturers, cycle text with rooms, admission state. */
  async details(courseId: string): Promise<CatalogCourseDetails> {
    return normalizeCatalogDetails(courseId, await this.client.get(`/tree-node/course/details/${courseId}`));
  }

  /** Children of a study area (top level when no id). Not paginated. */
  async studyAreaChildren(id?: string): Promise<StudyAreaNode[]> {
    return listOf(await this.client.get(`/tree-node/${studyAreaNodeId(id)}/children`)).map(normalizeStudyArea);
  }

  async studyArea(id: string): Promise<StudyAreaNode> {
    const { data } = await this.client.getOne(`/tree-node/${studyAreaNodeId(id)}`);
    return normalizeStudyArea(data);
  }

  /** Courses in a study-area subtree for a semester. */
  async studyAreaCourses(
    id: string,
    options: { semesterId?: string; q?: string; recursive?: boolean; limit?: number } = {},
  ): Promise<{ courses: CatalogCourse[]; total: number | null }> {
    const limit = Math.max(1, Math.min(options.limit ?? 50, 100));
    const q = options.q && options.q.trim().length >= 3 ? options.q.trim() : undefined;
    const page = await this.client.paginate(
      `/tree-node/${studyAreaNodeId(id)}/courses`,
      {
        filter: { semester: options.semesterId, q, recursive: options.recursive === false ? undefined : 1 },
        include: "sem-type",
        page: { limit },
      },
      { max: limit },
    );
    const included = new Included(page.included);
    return { courses: page.data.map((c) => normalizeCatalogCourse(c, included, this.instanceOrigin)), total: page.total ?? null };
  }

  /** MVV modules by name/code, valid in a semester (login needed). */
  async modules(options: { q?: string; semesterId?: string; limit?: number } = {}): Promise<{ modules: ModuleInfo[]; total: number | null }> {
    const limit = Math.max(1, Math.min(options.limit ?? 30, 100));
    const q = options.q && options.q.trim().length >= 3 ? options.q.trim() : undefined;
    const page = await this.client.paginate(`/modules`, { filter: { q, semester: options.semesterId }, page: { limit } }, { max: limit });
    return { modules: page.data.map(normalizeModule), total: page.total ?? null };
  }

  /** Courses of study (Studiengänge) by name (login needed). */
  async coursesOfStudy(options: { q?: string; limit?: number } = {}): Promise<{ courses: CourseOfStudyInfo[]; total: number | null }> {
    const limit = Math.max(1, Math.min(options.limit ?? 30, 100));
    const q = options.q && options.q.trim().length >= 3 ? options.q.trim() : undefined;
    const page = await this.client.paginate(`/courses-of-study`, { filter: { q }, page: { limit } }, { max: limit });
    return { courses: page.data.map(normalizeCourseOfStudy), total: page.total ?? null };
  }
}
