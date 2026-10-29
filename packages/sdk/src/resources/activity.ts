import type { StudIpClient } from "../client.js";
import { attr, htmlToText, Included } from "../jsonapi.js";
import type { JsonApiResource } from "../types.js";
import { fetchPages, personFrom, toIso, toMs, type Person } from "./comm-util.js";

/** Activity types Stud.IP 6.1 accepts in filter[activity-type]. */
export const ACTIVITY_TYPES = [
  "activity",
  "courseware",
  "documents",
  "forum",
  "message",
  "news",
  "participants",
  "schedule",
  "wiki",
] as const;

export type ActivityType = (typeof ACTIVITY_TYPES)[number];

const TYPE_ALIASES: Record<string, ActivityType> = {
  file: "documents",
  files: "documents",
  document: "documents",
  docs: "documents",
  messages: "message",
  mail: "message",
  members: "participants",
  participant: "participants",
  dates: "schedule",
  termine: "schedule",
  dateien: "documents",
  ankuendigungen: "news",
  announcements: "news",
  cw: "courseware",
};

/** Map user input ("files", "news,forum") to Stud.IP activity types; throws on unknown words. */
export function parseActivityTypes(input: string | undefined): ActivityType[] | undefined {
  if (!input) return undefined;
  const out = new Set<ActivityType>();
  for (const raw of input.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)) {
    const t = (ACTIVITY_TYPES as readonly string[]).includes(raw) ? (raw as ActivityType) : TYPE_ALIASES[raw];
    if (!t) throw new Error(`Unknown activity type "${raw}" — use ${ACTIVITY_TYPES.join(", ")}`);
    out.add(t);
  }
  return out.size ? [...out] : undefined;
}

/** One entry of the activity stream: "what happened in my courses". */
export interface ActivityItem {
  id: string;
  date: string;
  /** documents, forum, news, wiki, message, participants, schedule, courseware, … */
  type: string | null;
  /** created, edited, shared, sent, answered, … */
  verb: string | null;
  /** Stud.IP's sentence, e.g. who did what where. */
  title: string;
  text: string;
  contextType: "course" | "institute" | "user" | "system";
  courseId: string | null;
  courseTitle: string | null;
  objectType: string | null;
  objectId: string | null;
  actor: Person | null;
  /** Where to look in the Stud.IP web UI. */
  url: string | null;
}

export interface ActivityQuery {
  since?: Date;
  until?: Date;
  types?: ActivityType[];
  /** Only activities of this course. */
  courseId?: string;
  limit?: number;
}

const CONTEXT_TYPES: Record<string, ActivityItem["contextType"]> = {
  courses: "course",
  institutes: "institute",
  users: "user",
};

function activityUrl(origin: string | undefined, item: Omit<ActivityItem, "url">): string | null {
  if (!origin) return null;
  if (item.type === "documents" && item.objectType === "file-refs" && item.objectId) {
    return `${origin}/dispatch.php/file/details/${item.objectId}${item.courseId ? `?cid=${item.courseId}` : ""}`;
  }
  if (item.type === "message") return `${origin}/dispatch.php/messages/overview`;
  if (item.courseId) return `${origin}/dispatch.php/course/overview?cid=${item.courseId}`;
  return null;
}

export function normalizeActivity(
  resource: JsonApiResource,
  included: Included = new Included(),
  origin?: string,
): ActivityItem {
  const a = resource.attributes ?? {};
  const ctx = resource.relationships?.context?.data;
  const context = ctx && !Array.isArray(ctx) ? ctx : null;
  const contextType = context ? (CONTEXT_TYPES[context.type] ?? "system") : "system";
  const courseId = context?.type === "courses" ? context.id : null;

  const objectRel = resource.relationships?.object as
    | { data?: { type: string; id: string } | null; meta?: Record<string, unknown> }
    | undefined;
  const objectData = objectRel?.data && !Array.isArray(objectRel.data) ? objectRel.data : null;
  const objectType = objectData?.type ?? (objectRel?.meta?.["object-type"] as string | undefined) ?? null;
  const objectId = objectData?.id ?? (objectRel?.meta?.["object-id"] as string | undefined) ?? null;

  const base: Omit<ActivityItem, "url"> = {
    id: resource.id,
    date: toIso(a.mkdate) ?? "",
    type: typeof a["activity-type"] === "string" ? (a["activity-type"] as string) : null,
    verb: typeof a.verb === "string" ? a.verb : null,
    title: htmlToText(a.title) || "(activity)",
    text: htmlToText(a.content),
    contextType,
    courseId,
    courseTitle: attr<string>(courseId ? included.get("courses", courseId) : undefined, "title") ?? null,
    objectType,
    objectId,
    actor: personFrom(included, resource, "actor"),
  };
  return { ...base, url: activityUrl(origin, base) };
}

export class ActivityResource {
  constructor(private client: StudIpClient) {}

  private get origin(): string {
    return this.client.apiBase.replace(/\/jsonapi\.php\/v1\/?$/, "");
  }

  /**
   * GET /users/{id}/activitystream with time (epoch seconds), type and course
   * filters. Stud.IP defaults to the last six months when no start is given.
   */
  async stream(userId: string, query: ActivityQuery = {}): Promise<ActivityItem[]> {
    const filter: Record<string, string | number | undefined> = {
      start: query.since ? Math.floor(query.since.getTime() / 1000) : undefined,
      end: query.until ? Math.floor(query.until.getTime() / 1000) : undefined,
      "activity-type": query.types?.length ? query.types.join(",") : undefined,
      "context-type": query.courseId ? "course" : undefined,
      "context-id": query.courseId,
    };
    const page = await fetchPages(
      this.client,
      `/users/${userId}/activitystream`,
      { include: "actor,context", filter },
      { max: query.limit ?? 50 },
    );
    const included = new Included(page.included);
    return page.data
      .map((r) => normalizeActivity(r, included, this.origin))
      .sort((a, b) => toMs(b.date) - toMs(a.date));
  }
}
