/**
 * Who teaches a course — READ-ONLY. Lecturers and tutors by name, groups,
 * and how many students: students are only ever counted, never named.
 */
import type { StudIpClient } from "../client.js";
import { attr, Included } from "../jsonapi.js";
import type { JsonApiResource } from "../types.js";
import { berlinIso } from "../berlin.js";
import { first, isOfflineError, listOf, num, str } from "./attrs.js";
import { CatalogResource } from "./catalog.js";

export interface CoursePerson {
  id: string;
  name: string;
  username: string | null;
  email: string | null;
  /** Free label in the course, e.g. "Übungsleitung". */
  label: string | null;
  position: number;
}

export interface StatusGroupInfo {
  id: string;
  name: string;
  description: string | null;
  /** Max participants; null = unlimited. */
  capacity: number | null;
  selfAssign: boolean;
  selfAssignStart: string | null;
  selfAssignEnd: string | null;
  position: number;
}

export interface CoursePeople {
  courseId: string;
  lecturers: CoursePerson[];
  tutors: CoursePerson[];
  /** Visible students (permission autor) — a count only, never names. */
  studentCount: number | null;
  /** All members as Stud.IP counts them (course meta), if available. */
  memberCount: number | null;
  groups: StatusGroupInfo[];
  /** "public" when memberships were not readable and lecturers came from the catalog. */
  source: "memberships" | "public";
  warnings: string[];
}

export function normalizePerson(membership: JsonApiResource, included: Included): CoursePerson {
  const userRef = membership.relationships?.user?.data;
  const userId = userRef && !Array.isArray(userRef) ? userRef.id : membership.id;
  const user = included.get("users", userId);
  const composed = [attr(user, "name-prefix"), attr(user, "given-name"), attr(user, "family-name"), attr(user, "name-suffix")]
    .map((p) => str(p))
    .filter(Boolean)
    .join(" ");
  return {
    id: userId,
    name: str(attr(user, "formatted-name")) || composed || str(attr(user, "username")) || "(unbekannt)",
    username: str(attr(user, "username")),
    email: str(attr(user, "email")),
    label: str(first(membership, "label")),
    position: num(first(membership, "position")) ?? 0,
  };
}

export function normalizeStatusGroup(resource: JsonApiResource): StatusGroupInfo {
  const size = num(first(resource, "size"));
  return {
    id: resource.id,
    name: str(first(resource, "name", "full-name")) ?? "Gruppe",
    description: str(first(resource, "description")),
    capacity: size && size > 0 ? size : null,
    selfAssign: Boolean(first(resource, "selfassign")),
    selfAssignStart: berlinIso(first(resource, "selfassign-start")),
    selfAssignEnd: berlinIso(first(resource, "selfassign-end")),
    position: num(first(resource, "position")) ?? 0,
  };
}

export class PeopleResource {
  private readonly catalog: CatalogResource;

  constructor(private client: StudIpClient) {
    this.catalog = new CatalogResource(client);
  }

  /** Lecturers ("dozent") or tutors of a course, in Stud.IP's order. */
  async members(courseId: string, permission: "dozent" | "tutor"): Promise<CoursePerson[]> {
    const page = await this.client.paginate(`/courses/${courseId}/memberships`, {
      filter: { permission },
      include: "user",
      page: { limit: 100 },
    });
    const included = new Included(page.included);
    return page.data
      .map((m) => normalizePerson(m, included))
      .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, "de"));
  }

  /** Lecturers, falling back to the public course details when memberships are not readable. */
  async lecturers(courseId: string): Promise<CoursePerson[]> {
    try {
      return await this.members(courseId, "dozent");
    } catch (err) {
      if (isOfflineError(err)) throw err;
      const d = await this.catalog.details(courseId);
      return d.lecturers.map((l, i) => ({ id: l.id, name: l.name, username: l.username, email: null, label: null, position: i }));
    }
  }

  /** Count of members with a permission, without loading anyone's name. */
  async memberCount(courseId: string, permission: "autor" | "user" | "tutor" | "dozent"): Promise<number | null> {
    const doc = await this.client.get(`/courses/${courseId}/memberships`, { filter: { permission }, page: { limit: 1 } });
    return typeof doc.meta?.page?.total === "number" ? doc.meta.page.total : listOf(doc).length;
  }

  /** Groups (Übungsgruppen etc.) with capacity and self-assignment window. */
  async statusGroups(courseId: string): Promise<StatusGroupInfo[]> {
    const data = await this.client.paginateAll(`/courses/${courseId}/status-groups`, { page: { limit: 100 } });
    return data.map(normalizeStatusGroup).sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, "de"));
  }

  /** Lecturers and tutors by name, groups, student count. */
  async coursePeople(courseId: string): Promise<CoursePeople> {
    const warnings: string[] = [];
    const settle = async <T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> => {
      try {
        return await fn();
      } catch (err) {
        if (isOfflineError(err)) throw err;
        warnings.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
        return fallback;
      }
    };
    const [lecturers, tutors, studentCount, groups, memberCount] = await Promise.all([
      settle("lecturers", () => this.members(courseId, "dozent"), null as CoursePerson[] | null),
      settle("tutors", () => this.members(courseId, "tutor"), [] as CoursePerson[]),
      settle("students", () => this.memberCount(courseId, "autor"), null as number | null),
      settle("groups", () => this.statusGroups(courseId), [] as StatusGroupInfo[]),
      settle("course", () => this.courseMemberCount(courseId), null as number | null),
    ]);
    if (lecturers) {
      return { courseId, lecturers, tutors, studentCount, memberCount, groups, source: "memberships", warnings };
    }
    const details = await this.catalog.details(courseId);
    return {
      courseId,
      lecturers: details.lecturers.map((l, i) => ({ id: l.id, name: l.name, username: l.username, email: null, label: null, position: i })),
      tutors,
      studentCount,
      memberCount,
      groups,
      source: "public",
      warnings,
    };
  }

  /** Users matching a name (Stud.IP user search, login needed). */
  async searchUsers(query: string, limit = 10): Promise<CoursePerson[]> {
    const doc = await this.client.get(`/users`, { filter: { search: query }, page: { limit } });
    return listOf(doc).map((u, i) => {
      const asMember: JsonApiResource = { type: "course-memberships", id: u.id, relationships: { user: { data: { type: "users", id: u.id } } } };
      return { ...normalizePerson(asMember, new Included([u])), position: i };
    });
  }

  private async courseMemberCount(courseId: string): Promise<number | null> {
    const { data } = await this.client.getOne(`/courses/${courseId}`);
    return num((data.meta as Record<string, unknown> | undefined)?.["members-count"]);
  }
}
