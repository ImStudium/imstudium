import type { StudIpClient } from "../client.js";
import type {
  CourseAttributes,
  EventAttributes,
  JsonApiResource,
  UserAttributes,
} from "../types.js";
import { slugify } from "../config.js";

type CourseResource = JsonApiResource<"courses"> & { attributes?: CourseAttributes };
type UserResource = JsonApiResource<"users"> & { attributes?: UserAttributes };
type EventResource = JsonApiResource<"schedule-entries" | "events"> & {
  attributes?: EventAttributes;
};

export class CoursesResource {
  constructor(private client: StudIpClient) {}

  async getMe(): Promise<UserResource> {
    const doc = await this.client.get<UserResource>("/users/me");
    if (!doc.data || Array.isArray(doc.data)) {
      throw new Error("Expected single user from /users/me");
    }
    return doc.data;
  }

  async listMine(userId?: string): Promise<CourseResource[]> {
    const user = userId ? { id: userId } : await this.getMe();
    return this.client.paginateAll<CourseResource>(`/users/${user.id}/courses`);
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

  async getSchedule(userId: string): Promise<EventResource[]> {
    try {
      return await this.client.paginateAll<EventResource>(`/users/${userId}/schedule`);
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
