import type { StudIpClient } from "../client.js";
import type {
  CourseAttributes,
  EventAttributes,
  JsonApiResource,
  UserAttributes,
} from "../types.js";
import { slugify } from "../config.js";
import {
  filterCoursesForSemester,
  findCurrentSemester,
  type SemesterResource,
  SemestersResource,
  semesterSlug,
} from "../semesters.js";

export interface ListMineOptions {
  semesterId?: string;
  allSemesters?: boolean;
}

export interface ResolvedSemesterContext {
  semester: SemesterResource;
  slug: string;
  title: string;
  /** Whether this is the calendar-current semester (vs. an explicit override). */
  isCurrent: boolean;
  /** All known semesters — cheap to reuse for "other semesters" hints. */
  allSemesters: SemesterResource[];
}

type CourseResource = JsonApiResource<"courses"> & { attributes?: CourseAttributes };
type UserResource = JsonApiResource<"users"> & { attributes?: UserAttributes };
type EventResource = JsonApiResource<"schedule-entries" | "events"> & {
  attributes?: EventAttributes;
};

export class CoursesResource {
  readonly semesters: SemestersResource;

  constructor(private client: StudIpClient) {
    this.semesters = new SemestersResource(client);
  }

  async getMe(): Promise<UserResource> {
    const doc = await this.client.get<UserResource>("/users/me");
    if (!doc.data || Array.isArray(doc.data)) {
      throw new Error("Expected single user from /users/me");
    }
    return doc.data;
  }

  async listMine(userId?: string, options: ListMineOptions = {}): Promise<CourseResource[]> {
    const user = userId ? { id: userId } : await this.getMe();
    const all = await this.client.paginateAll<CourseResource>(`/users/${user.id}/courses`);
    if (options.allSemesters) return all;

    const allSemesters = await this.semesters.listAll();
    let target: SemesterResource | null = null;
    if (options.semesterId) {
      target = allSemesters.find((s) => s.id === options.semesterId) ?? null;
      if (!target) target = await this.semesters.get(options.semesterId);
    } else {
      target = findCurrentSemester(allSemesters);
    }
    if (!target) return all;
    return filterCoursesForSemester(all, target, allSemesters) as CourseResource[];
  }

  async resolveSemesterContext(options?: {
    semesterId?: string;
    semesterLabel?: string;
    allSemesters?: boolean;
  }): Promise<ResolvedSemesterContext | null> {
    if (options?.allSemesters) return null;
    const all = await this.semesters.listAll();
    const calendarCurrent = findCurrentSemester(all);
    let target: SemesterResource | null = null;
    if (options?.semesterId) {
      target = all.find((s) => s.id === options.semesterId) ?? null;
    } else if (options?.semesterLabel) {
      target = this.semesters.resolveByLabel(all, options.semesterLabel);
    } else {
      target = calendarCurrent;
    }
    if (!target) return null;
    const title = String(target.attributes?.title || target.id);
    return {
      semester: target,
      slug: semesterSlug(title),
      title,
      isCurrent: !!calendarCurrent && calendarCurrent.id === target.id,
      allSemesters: all,
    };
  }

  async listAll(filters?: { semester?: string; q?: string }): Promise<CourseResource[]> {
    const params: Record<string, string> = {};
    if (filters?.semester) params["filter[semester]"] = filters.semester;
    if (filters?.q && filters.q.length >= 3) params["filter[q]"] = filters.q;
    return this.client.paginateAll<CourseResource>("/courses", params);
  }

  async get(courseId: string): Promise<CourseResource> {
    const doc = await this.client.get<CourseResource>(`/courses/${courseId}`);
    if (!doc.data || Array.isArray(doc.data)) throw new Error("Course not found");
    return doc.data;
  }

  async getEvents(courseId: string): Promise<EventResource[]> {
    try {
      return await this.client.paginateAll<EventResource>(`/courses/${courseId}/events`);
    } catch {
      return [];
    }
  }

  courseSlug(course: CourseResource): string {
    const title = course.attributes?.title || course.id;
    return slugify(title);
  }
}

export class ScheduleResource {
  constructor(private client: StudIpClient) {}

  /**
   * Raw `/users/{id}/schedule`: `seminar-cycle-dates` (course cycles — the
   * course is the `owner` relationship, times are "HH:MM" + weekday) and your
   * own `schedule-entries`. `timestamp` (unix seconds) picks the semester;
   * default is the current one. Normalise with `normalizeScheduleItem`.
   *
   * Not paginated: the route rejects `page[...]` with 400, so a paginated
   * call used to fail silently and every course schedule came back empty.
   */
  async getSchedule(userId: string, options: { timestamp?: number } = {}): Promise<JsonApiResource[]> {
    try {
      const filter = options.timestamp ? { timestamp: Math.floor(options.timestamp) } : undefined;
      const doc = await this.client.get(`/users/${userId}/schedule`, { filter });
      return Array.isArray(doc.data) ? doc.data : doc.data ? [doc.data] : [];
    } catch {
      return [];
    }
  }

  async exportCalendarIcs(userId: string): Promise<string> {
    const res = await this.client.download(`/users/${userId}/events.ics`);
    return res.text();
  }
}

export class DiscoveryResource {
  constructor(private client: StudIpClient) {}

  async listRoutes(): Promise<Array<{ methods: string[]; pattern: string }>> {
    const doc = await this.client.get<JsonApiResource<"slim-routes">>("discovery");
    const data = Array.isArray(doc.data) ? doc.data : doc.data ? [doc.data] : [];
    return data.map((r: JsonApiResource<"slim-routes">) => ({
      methods: (r.attributes?.methods as string[]) || [],
      pattern: (r.attributes?.pattern as string) || "",
    }));
  }

  async getProperties(): Promise<Record<string, string>> {
    const doc = await this.client.get<JsonApiResource<"studip-properties">>("studip/properties");
    const data = Array.isArray(doc.data) ? doc.data : doc.data ? [doc.data] : [];
    const out: Record<string, string> = {};
    for (const p of data) {
      out[p.id] = String(p.attributes?.value ?? "");
    }
    return out;
  }
}
