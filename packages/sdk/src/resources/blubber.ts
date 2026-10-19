import type { StudIpClient } from "../client.js";
import { htmlToText, Included, relId } from "../jsonapi.js";
import type { JsonApiResource } from "../types.js";
import { fetchPages, personFrom, toAtom, toIso, toMs, type Person } from "./comm-util.js";

/** A Blubber thread (course chat, private conversation or public stream post). */
export interface BlubberThread {
  id: string;
  /** Display name Stud.IP gives the thread (course title for course threads). */
  name: string;
  /** course | public | private | institute */
  contextType: string;
  courseId: string | null;
  /** Opening text (often empty for a course's default thread). */
  text: string;
  author: Person | null;
  createdAt: string | null;
  lastActivity: string | null;
  /** Comments you have not seen yet, if Stud.IP reported it. */
  unseenComments: number | null;
  commentable: boolean;
  followed: boolean;
}

export interface BlubberComment {
  id: string;
  threadId: string | null;
  text: string;
  date: string;
  author: Person | null;
}

export interface BlubberThreadWithComments extends BlubberThread {
  /** Latest comments, oldest first. */
  comments: BlubberComment[];
}

function unseenFrom(resource: JsonApiResource): number | null {
  const related = (resource.relationships?.comments?.links as Record<string, unknown> | undefined)?.related;
  if (related && typeof related === "object") {
    const n = (related as { meta?: Record<string, unknown> }).meta?.["unseen-comments"];
    if (typeof n === "number") return n;
    if (typeof n === "string" && /^\d+$/.test(n)) return Number(n);
  }
  return null;
}

export function normalizeBlubberThread(resource: JsonApiResource, included: Included = new Included()): BlubberThread {
  const a = resource.attributes ?? {};
  const contextType = String(a["context-type"] ?? "unknown");
  const context = resource.relationships?.context?.data;
  const courseId =
    context && !Array.isArray(context) && context.type === "courses" ? context.id : null;
  return {
    id: resource.id,
    name: String(a.name ?? "").trim() || "(unnamed thread)",
    contextType,
    courseId,
    text: htmlToText(a["content-html"] ?? a.content),
    author: personFrom(included, resource, "author"),
    createdAt: toIso(a.mkdate),
    lastActivity: toIso(a["latest-activity"]) ?? toIso(a.chdate),
    unseenComments: unseenFrom(resource),
    commentable: Boolean(a["is-commentable"]),
    followed: Boolean(a["is-followed"]),
  };
}

export function normalizeBlubberComment(
  resource: JsonApiResource,
  included: Included = new Included(),
  threadId?: string,
): BlubberComment {
  const a = resource.attributes ?? {};
  return {
    id: resource.id,
    threadId: threadId ?? relId(resource, "thread"),
    text: htmlToText(a["content-html"] ?? a.content),
    date: toIso(a.mkdate) ?? "",
    author: personFrom(included, resource, "author"),
  };
}

function newestFirst(threads: BlubberThread[], limit?: number): BlubberThread[] {
  const out = threads.sort((a, b) => toMs(b.lastActivity) - toMs(a.lastActivity));
  return limit && limit > 0 ? out.slice(0, limit) : out;
}

export class BlubberResource {
  constructor(private client: StudIpClient) {}

  /** Threads of a course (usually its one course chat). */
  async course(courseId: string, options: { limit?: number } = {}): Promise<BlubberThread[]> {
    const page = await fetchPages(this.client, `/courses/${courseId}/blubber-threads`, { include: "author" }, { max: 200 });
    const included = new Included(page.included);
    return newestFirst(page.data.map((t) => normalizeBlubberThread(t, included)), options.limit);
  }

  /** Your Blubber stream across courses and conversations (server-side `since`). */
  async mine(options: { limit?: number; since?: Date } = {}): Promise<BlubberThread[]> {
    const page = await fetchPages(
      this.client,
      "/blubber-threads",
      { include: "author", filter: options.since ? { since: toAtom(options.since) } : undefined },
      { max: options.limit ?? 30 },
    );
    const included = new Included(page.included);
    return newestFirst(page.data.map((t) => normalizeBlubberThread(t, included)), options.limit);
  }

  /** Private conversations between you and `userId` (your own id lists all of yours). */
  async private(userId: string, options: { limit?: number } = {}): Promise<BlubberThread[]> {
    const page = await fetchPages(this.client, `/users/${userId}/blubber-threads`, { include: "author" }, { max: 200 });
    const included = new Included(page.included);
    return newestFirst(page.data.map((t) => normalizeBlubberThread(t, included)), options.limit);
  }

  /** Latest `limit` comments of a thread (default 20), returned oldest first. */
  async comments(threadId: string, options: { limit?: number; since?: Date } = {}): Promise<BlubberComment[]> {
    const page = await fetchPages(
      this.client,
      `/blubber-threads/${threadId}/comments`,
      {
        include: "author",
        sort: "-mkdate",
        filter: options.since ? { since: toAtom(options.since) } : undefined,
      },
      { max: options.limit ?? 20 },
    );
    const included = new Included(page.included);
    return page.data
      .map((c) => normalizeBlubberComment(c, included, threadId))
      .sort((a, b) => toMs(a.date) - toMs(b.date));
  }

  /** Course threads with their latest comments. */
  async courseWithComments(
    courseId: string,
    options: { limit?: number; since?: Date } = {},
  ): Promise<BlubberThreadWithComments[]> {
    const threads = await this.course(courseId);
    return Promise.all(
      threads.map(async (t) => ({ ...t, comments: await this.comments(t.id, options) })),
    );
  }
}
