import { join } from "node:path";
import type { StudIpClient } from "../client.js";
import { attr, htmlToText, Included, relId } from "../jsonapi.js";
import type { JsonApiResource } from "../types.js";
import {
  displayName,
  fetchPages,
  frontmatter,
  isoDay,
  isoMinute,
  isUnavailable,
  mdLabel,
  mdLink,
  moveIfRenamed,
  personFrom,
  personRef,
  scanMarkdown,
  titleSlug,
  toIso,
  toMs,
  writeIfChanged,
  UNKNOWN_PERSON,
  type Person,
} from "./comm-util.js";

export interface ForumCategory {
  id: string;
  name: string;
  description: string;
  position: number;
  topicsCount: number;
  discussionsCount: number;
  postingsCount: number;
  unreadCount: number;
  lastActivity: string | null;
}

export interface ForumTopic {
  id: string;
  name: string;
  description: string;
  position: number;
  categoryId: string | null;
  discussionsCount: number;
  postingsCount: number;
  unreadCount: number;
  lastActivity: string | null;
}

export interface ForumDiscussion {
  id: string;
  title: string;
  topicId: string | null;
  topicName: string | null;
  startedBy: Person | null;
  sticky: boolean;
  closed: boolean;
  closedAt: string | null;
  views: number;
  postingsCount: number;
  unreadCount: number;
  createdAt: string | null;
  lastActivity: string | null;
}

export interface ForumPosting {
  id: string;
  discussionId: string | null;
  text: string;
  date: string;
  updatedAt: string | null;
  author: Person;
  anonymous: boolean;
  /** Written by a lecturer or tutor of the course. */
  moderator: boolean;
}

export interface ForumThread {
  discussion: ForumDiscussion;
  /** Oldest first. */
  postings: ForumPosting[];
}

export interface CourseForum {
  courseId: string;
  /** false when the course has no forum or you may not read it. */
  available: boolean;
  categories: ForumCategory[];
  topics: ForumTopic[];
  /** Newest activity first. */
  discussions: ForumDiscussion[];
}

export interface ForumWriteResult {
  dir: string;
  available: boolean;
  discussions: number;
  /** Threads fetched from Stud.IP this run (others were unchanged since last sync). */
  fetched: number;
  written: number;
  unchanged: number;
  files: string[];
  errors: Array<{ discussionId: string; message: string }>;
}

const ANONYMOUS: Person = { id: null, name: "Anonymous" };

function num(meta: Record<string, unknown> | undefined, key: string): number {
  const v = meta?.[key];
  return typeof v === "number" ? v : Number(v) || 0;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

export function normalizeForumCategory(resource: JsonApiResource): ForumCategory {
  const a = resource.attributes ?? {};
  return {
    id: resource.id,
    name: str(a.name ?? a.title).trim() || "(unnamed)",
    description: htmlToText(a.description),
    position: Number(a.position) || 0,
    topicsCount: num(resource.meta, "topics-count"),
    discussionsCount: num(resource.meta, "discussions-count"),
    postingsCount: num(resource.meta, "postings-count"),
    unreadCount: num(resource.meta, "unread-postings-count"),
    lastActivity: toIso(resource.meta?.["recent-activity"]),
  };
}

export function normalizeForumTopic(resource: JsonApiResource): ForumTopic {
  const a = resource.attributes ?? {};
  return {
    id: resource.id,
    name: str(a.name ?? a.title).trim() || "(unnamed)",
    description: htmlToText(a["description-html"] ?? a.description),
    position: Number(a.position) || 0,
    categoryId: relId(resource, "category"),
    discussionsCount: num(resource.meta, "discussions-count"),
    postingsCount: num(resource.meta, "postings-count"),
    unreadCount: num(resource.meta, "unread-postings-count"),
    lastActivity: toIso(resource.meta?.["recent-activity"]),
  };
}

export function normalizeForumDiscussion(
  resource: JsonApiResource,
  included: Included = new Included(),
  topicNames: Map<string, string> = new Map(),
): ForumDiscussion {
  const a = resource.attributes ?? {};
  const topicId = relId(resource, "topic");
  const topic = topicId ? included.get("forum-topics", topicId) : undefined;
  const closedAt = toIso(a["closed-at"]);
  const createdAt = toIso(a.mkdate);
  return {
    id: resource.id,
    title: str(a.title).trim() || "(untitled)",
    topicId,
    topicName: attr<string>(topic, "name") ?? (topicId ? topicNames.get(topicId) : undefined) ?? null,
    startedBy: personFrom(included, resource, "user"),
    sticky: Boolean(a.sticky),
    closed: closedAt !== null,
    closedAt,
    views: Number(a["view-count"]) || 0,
    postingsCount: num(resource.meta, "postings-count"),
    unreadCount: num(resource.meta, "unread-postings-count"),
    createdAt,
    lastActivity: toIso(resource.meta?.["recent-activity"]) ?? toIso(a.chdate) ?? createdAt,
  };
}

export function normalizeForumPosting(resource: JsonApiResource, included: Included = new Included()): ForumPosting {
  const a = resource.attributes ?? {};
  const anonymous = Boolean(a.anonymous);
  const data = resource.relationships?.author?.data;
  const ref = data && !Array.isArray(data) ? data : null;
  const member = ref?.id ? included.get(ref.type, ref.id) : undefined;
  // Stud.IP blanks the author of anonymous postings (empty id) unless it is your own.
  const author: Person = ref?.id
    ? personRef(included, ref.type, ref.id)
    : anonymous
      ? ANONYMOUS
      : { id: null, name: UNKNOWN_PERSON };
  return {
    id: resource.id,
    discussionId: relId(resource, "discussion"),
    text: htmlToText(a["content-html"] ?? a.content),
    date: toIso(a.mkdate) ?? "",
    updatedAt: toIso(a.chdate),
    author,
    anonymous,
    moderator: attr<string>(member, "role") === "moderator",
  };
}

/** Discussion plus its postings from GET /forum-discussions/{id}?include=postings,postings.author. */
export function normalizeForumThread(data: JsonApiResource, includedList: JsonApiResource[]): ForumThread {
  const included = new Included(includedList);
  const discussion = normalizeForumDiscussion(data, included);
  let postingResources = included.many(data, "postings");
  if (postingResources.length === 0) postingResources = includedList.filter((r) => r.type === "forum-postings");
  const postings = postingResources
    .map((p) => normalizeForumPosting(p, included))
    .map((p) => ({ ...p, discussionId: p.discussionId ?? discussion.id }))
    .sort((x, y) => toMs(x.date) - toMs(y.date) || x.id.localeCompare(y.id));
  return {
    discussion: { ...discussion, postingsCount: discussion.postingsCount || postings.length },
    postings,
  };
}

// ── Markdown ──────────────────────────────────────────────────────────────────

export interface ForumMarkdownContext {
  courseTitle?: string;
  courseId?: string;
  topicName?: string | null;
  categoryName?: string | null;
}

export function forumThreadMarkdown(thread: ForumThread, ctx: ForumMarkdownContext = {}): string {
  const d = thread.discussion;
  const topic = ctx.topicName ?? d.topicName ?? undefined;
  const meta = [
    topic && `Topic: ${topic}`,
    ctx.categoryName && `Category: ${ctx.categoryName}`,
    `${d.postingsCount} posting${d.postingsCount === 1 ? "" : "s"}`,
    d.startedBy && `started by ${d.startedBy.name}${d.createdAt ? ` on ${isoDay(d.createdAt)}` : ""}`,
    d.closed && "closed",
  ].filter(Boolean);
  const posts = thread.postings.flatMap((p) => [
    `## ${displayName(p.author)}${p.moderator ? " (lecturer/tutor)" : ""} · ${isoMinute(p.date)}`,
    "",
    p.text || "_(empty)_",
    "",
  ]);
  return [
    frontmatter({
      id: d.id,
      title: d.title,
      topic: topic ?? undefined,
      category: ctx.categoryName ?? undefined,
      course: ctx.courseTitle,
      courseId: ctx.courseId,
      startedBy: d.startedBy?.name,
      created: d.createdAt ?? undefined,
      lastActivity: d.lastActivity ?? undefined,
      postings: d.postingsCount,
      closed: d.closed ? true : undefined,
    }),
    `# ${d.title}`,
    "",
    `_${meta.join(" · ")}_`,
    "",
    ...(posts.length ? posts : ["_No postings._", ""]),
  ].join("\n");
}

interface Placement {
  discussion: ForumDiscussion;
  rel: string;
}

/** Decide `<topic-slug>/<discussion-slug>.md` for every discussion, collision-free. */
export function planForumPaths(forum: Pick<CourseForum, "topics" | "discussions">): Placement[] {
  const topicDir = new Map<string, string>();
  const usedTopicDirs = new Set<string>();
  for (const t of [...forum.topics].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))) {
    let dir = titleSlug(t.name, `topic-${t.id.slice(0, 6)}`);
    if (usedTopicDirs.has(dir)) dir = `${dir}-${t.id.slice(0, 6)}`;
    usedTopicDirs.add(dir);
    topicDir.set(t.id, dir);
  }
  const used = new Set<string>();
  const out: Placement[] = [];
  const ordered = [...forum.discussions].sort((a, b) => toMs(a.createdAt) - toMs(b.createdAt) || a.id.localeCompare(b.id));
  for (const d of ordered) {
    let dir = d.topicId ? topicDir.get(d.topicId) : undefined;
    if (!dir) {
      dir = titleSlug(d.topicName ?? "", "general");
      if (d.topicId) {
        if (usedTopicDirs.has(dir)) dir = `${dir}-${d.topicId.slice(0, 6)}`;
        topicDir.set(d.topicId, dir);
        usedTopicDirs.add(dir);
      }
    }
    let rel = `${dir}/${titleSlug(d.title, d.id.slice(0, 8))}.md`;
    if (used.has(rel)) rel = rel.replace(/\.md$/, `-${d.id.slice(0, 6)}.md`);
    used.add(rel);
    out.push({ discussion: d, rel });
  }
  return out;
}

export function forumIndexMarkdown(forum: CourseForum, placements: Placement[], courseTitle?: string): string {
  const relOf = new Map(placements.map((p) => [p.discussion.id, p.rel]));
  const byTopic = new Map<string, ForumDiscussion[]>();
  for (const d of forum.discussions) {
    const key = d.topicId ?? "";
    byTopic.set(key, [...(byTopic.get(key) ?? []), d]);
  }
  const line = (d: ForumDiscussion) => {
    const rel = relOf.get(d.id);
    const label = mdLabel(d.title);
    const bits = [
      `${d.postingsCount} posting${d.postingsCount === 1 ? "" : "s"}`,
      d.lastActivity && `last ${isoDay(d.lastActivity)}`,
      d.startedBy && `started by ${d.startedBy.name}`,
      d.closed && "closed",
    ].filter(Boolean);
    return `- ${rel ? `[${label}](${mdLink(rel)})` : label} — ${bits.join(" · ")}`;
  };
  const sortDiscussions = (list: ForumDiscussion[]) =>
    [...list].sort((a, b) => Number(b.sticky) - Number(a.sticky) || toMs(b.lastActivity) - toMs(a.lastActivity));

  const topicsByCategory = new Map<string, ForumTopic[]>();
  for (const t of forum.topics) {
    const key = t.categoryId ?? "";
    topicsByCategory.set(key, [...(topicsByCategory.get(key) ?? []), t]);
  }
  const sections: string[] = [];
  const renderTopic = (t: ForumTopic) => {
    const list = byTopic.get(t.id) ?? [];
    byTopic.delete(t.id);
    if (list.length === 0) return;
    sections.push(`### ${t.name}`, "", ...sortDiscussions(list).map(line), "");
  };
  const categories = [...forum.categories].sort((a, b) => a.position - b.position);
  for (const c of categories) {
    const topics = (topicsByCategory.get(c.id) ?? []).sort((a, b) => a.position - b.position);
    topicsByCategory.delete(c.id);
    const before = sections.length;
    sections.push(`## ${c.name}`, "");
    topics.forEach(renderTopic);
    if (sections.length === before + 2) sections.length = before; // empty category
  }
  const rest = [...topicsByCategory.values()].flat().sort((a, b) => a.position - b.position);
  if (rest.length) {
    const before = sections.length;
    sections.push(categories.length ? "## Other topics" : "## Topics", "");
    rest.forEach(renderTopic);
    if (sections.length === before + 2) sections.length = before;
  }
  const orphans = [...byTopic.values()].flat();
  if (orphans.length) sections.push("## Other discussions", "", ...sortDiscussions(orphans).map(line), "");

  return [
    `# Forum${courseTitle ? ` — ${courseTitle}` : ""}`,
    "",
    "Discussions from the Stud.IP forum, one file per thread (postings oldest first). Written by `imstudium forum --save` and `imstudium sync`.",
    "",
    ...(sections.length ? sections : ["_No discussions yet._", ""]),
  ].join("\n");
}

// ── Resource ──────────────────────────────────────────────────────────────────

async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++]!;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

/**
 * The Stud.IP 6 forum: categories → topics → discussions → postings.
 *
 * Read side effect to know about: GET /forum-discussions/{id}/postings marks the
 * whole discussion as read for you. `thread()` therefore reads postings through
 * GET /forum-discussions/{id}?include=postings,postings.author, which does not.
 */
export class ForumResource {
  constructor(private client: StudIpClient) {}

  async categories(courseId: string): Promise<ForumCategory[]> {
    const page = await fetchPages(this.client, `/courses/${courseId}/forum-categories`);
    return page.data.map(normalizeForumCategory).sort((a, b) => a.position - b.position);
  }

  async topics(courseId: string): Promise<ForumTopic[]> {
    const page = await fetchPages(this.client, `/courses/${courseId}/forum-topics`, { include: "category" });
    return page.data.map(normalizeForumTopic).sort((a, b) => a.position - b.position);
  }

  async categoryTopics(categoryId: string): Promise<ForumTopic[]> {
    const page = await fetchPages(this.client, `/forum-categories/${categoryId}/topics`);
    return page.data.map((t) => {
      const topic = normalizeForumTopic(t);
      return { ...topic, categoryId: topic.categoryId ?? categoryId };
    });
  }

  /** Discussions of a course, newest activity first (no server filters — they are stored in your session). */
  async discussions(courseId: string, options: { since?: Date; limit?: number } = {}): Promise<ForumDiscussion[]> {
    const page = await fetchPages(this.client, `/courses/${courseId}/forum-discussions`, { include: "topic,user" }, { max: 1000 });
    return this.select(page.data, page.included, options);
  }

  async topicDiscussions(topicId: string, options: { since?: Date; limit?: number } = {}): Promise<ForumDiscussion[]> {
    const page = await fetchPages(this.client, `/forum-topics/${topicId}/discussions`, { include: "topic,user" }, { max: 1000 });
    return this.select(page.data, page.included, options);
  }

  private select(data: JsonApiResource[], included: JsonApiResource[], options: { since?: Date; limit?: number }) {
    const inc = new Included(included);
    const since = options.since?.getTime();
    const out = data
      .map((d) => normalizeForumDiscussion(d, inc))
      .filter((d) => since === undefined || toMs(d.lastActivity) >= since)
      .sort((a, b) => toMs(b.lastActivity) - toMs(a.lastActivity));
    return options.limit && options.limit > 0 ? out.slice(0, options.limit) : out;
  }

  /** Categories, topics and discussions in three requests. `available: false` if the course has no forum. */
  async overview(courseId: string, options: { since?: Date; limit?: number } = {}): Promise<CourseForum> {
    try {
      const [categories, topics, discussions] = await Promise.all([
        this.categories(courseId),
        this.topics(courseId),
        this.discussions(courseId, options),
      ]);
      const names = new Map(topics.map((t) => [t.id, t.name]));
      return {
        courseId,
        available: true,
        categories,
        topics,
        discussions: discussions.map((d) => ({ ...d, topicName: d.topicName ?? (d.topicId ? names.get(d.topicId) ?? null : null) })),
      };
    } catch (err) {
      if (isUnavailable(err)) return { courseId, available: false, categories: [], topics: [], discussions: [] };
      throw err;
    }
  }

  /** One discussion with every posting, oldest first. Does not mark it read. */
  async thread(discussionId: string): Promise<ForumThread> {
    const { data, included } = await this.client.getOne(`/forum-discussions/${discussionId}`, {
      include: "postings,postings.author,topic,user",
    });
    return normalizeForumThread(data, included);
  }

  /**
   * Write `<forumDir>/<topic>/<discussion>.md` per thread plus README.md.
   * Threads whose activity and posting count match the existing file are not refetched.
   */
  async exportCourseForum(
    courseId: string,
    forumDir: string,
    options: { courseTitle?: string; concurrency?: number } = {},
  ): Promise<ForumWriteResult> {
    const forum = await this.overview(courseId);
    const result: ForumWriteResult = {
      dir: forumDir,
      available: forum.available,
      discussions: forum.discussions.length,
      fetched: 0,
      written: 0,
      unchanged: 0,
      files: [],
      errors: [],
    };
    if (!forum.available) return result;

    const existing = await scanMarkdown(forumDir, 2);
    const placements = planForumPaths(forum);
    const topicById = new Map(forum.topics.map((t) => [t.id, t]));
    const categoryById = new Map(forum.categories.map((c) => [c.id, c]));

    await pool(placements, options.concurrency ?? 4, async ({ discussion: d, rel }) => {
      const target = join(forumDir, rel);
      const prev = existing.get(d.id);
      result.files.push(target);
      if (
        prev &&
        prev.path === target &&
        (prev.fm.lastActivity ?? "") === (d.lastActivity ?? "") &&
        prev.fm.postings === String(d.postingsCount)
      ) {
        result.unchanged++;
        return;
      }
      try {
        const thread = await this.thread(d.id);
        result.fetched++;
        const topic = d.topicId ? topicById.get(d.topicId) : undefined;
        const merged: ForumThread = {
          discussion: { ...thread.discussion, lastActivity: d.lastActivity ?? thread.discussion.lastActivity, postingsCount: d.postingsCount || thread.discussion.postingsCount },
          postings: thread.postings,
        };
        const md = forumThreadMarkdown(merged, {
          courseTitle: options.courseTitle,
          courseId,
          topicName: topic?.name ?? d.topicName,
          categoryName: topic?.categoryId ? categoryById.get(topic.categoryId)?.name : undefined,
        });
        await moveIfRenamed(prev?.path, target);
        if (await writeIfChanged(target, md)) result.written++;
        else result.unchanged++;
      } catch (err) {
        result.errors.push({ discussionId: d.id, message: err instanceof Error ? err.message : String(err) });
      }
    });

    await writeIfChanged(join(forumDir, "README.md"), forumIndexMarkdown(forum, placements, options.courseTitle));
    result.files.sort();
    return result;
  }
}
