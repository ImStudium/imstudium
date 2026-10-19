import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "vitest";
import type { StudIpClient } from "../client.js";
import { toSearchParams } from "../client.js";
import { Included } from "../jsonapi.js";
import type { JsonApiDocument, JsonApiResource } from "../types.js";
import {
  ActivityResource,
  BlubberResource,
  ForumResource,
  MessagesResource,
  NewsResource,
  excerpt,
  fetchPages,
  forumThreadMarkdown,
  frontmatter,
  normalizeActivity,
  normalizeBlubberComment,
  normalizeBlubberThread,
  normalizeForumDiscussion,
  normalizeForumThread,
  normalizeMessage,
  normalizeNews,
  normalizeNewsComment,
  parseActivityTypes,
  parseFrontmatter,
  planForumPaths,
  selectNews,
  syncCommunication,
  toAtom,
  toIso,
  writeNewsMarkdown,
  type NewsItem,
} from "./communication.js";

// ── Synthetic fixtures (no real Stud.IP data) ─────────────────────────────────

const COURSE = "c0000000000000000000000000000001";
const LECTURER = "u0000000000000000000000000000001";
const STUDENT = "u0000000000000000000000000000002";
const ME = "u0000000000000000000000000000009";

function user(id: string, name: string): JsonApiResource {
  return { type: "users", id, attributes: { "formatted-name": name, username: name.toLowerCase().replace(/\W+/g, ".") } };
}

function news(id: string, title: string, start: string, extra: Record<string, unknown> = {}): JsonApiResource {
  return {
    type: "news",
    id,
    attributes: {
      title,
      content: "<p>Hello <strong>class</strong>,</p><p>see the new sheet.</p>",
      mkdate: start,
      chdate: start,
      "publication-start": start,
      "publication-end": "2026-12-31T23:59:00+01:00",
      "comments-allowed": false,
      ...extra,
    },
    relationships: {
      author: { data: { type: "users", id: LECTURER } },
      ranges: { data: [{ type: "courses", id: COURSE }] },
    },
  };
}

interface Call {
  path: string;
  query: string;
}

/** Minimal stand-in for StudIpClient: routes GETs to fixture docs, pages by offset. */
function fakeClient(routes: Record<string, JsonApiDocument | (() => JsonApiDocument)>) {
  const calls: Call[] = [];
  const resolve = (path: string, params?: unknown): JsonApiDocument => {
    const query = toSearchParams(params as Record<string, string>);
    calls.push({ path, query: decodeURIComponent(query.toString()) });
    const route = routes[path];
    if (!route) {
      const err = Object.assign(new Error(`404 ${path}`), { status: 404 });
      throw err;
    }
    const doc = typeof route === "function" ? route() : route;
    if (!Array.isArray(doc.data)) return doc;
    const offset = Number(query.get("page[offset]") ?? 0);
    const limit = Number(query.get("page[limit]") ?? 30);
    return {
      ...doc,
      data: doc.data.slice(offset, offset + limit),
      meta: { page: { offset, limit, total: doc.data.length } },
    };
  };
  const client = {
    apiBase: "https://studip.example.org/jsonapi.php/v1",
    async get(path: string, params?: unknown) {
      return resolve(path, params);
    },
    async getOne(path: string, params?: unknown) {
      const doc = resolve(path, params);
      return { data: doc.data as JsonApiResource, included: doc.included ?? [] };
    },
    async request(method: string, path: string) {
      calls.push({ path: `${method} ${path}`, query: "" });
      throw new Error("write attempted");
    },
  };
  return { client: client as unknown as StudIpClient, calls };
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "imstudium-comm-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

// ── comm-util ─────────────────────────────────────────────────────────────────

describe("comm-util", () => {
  it("normalises dates and keeps the instance offset", () => {
    assert.equal(toIso("2026-10-12T14:03:00+02:00"), "2026-10-12T14:03:00+02:00");
    assert.equal(toIso(1760270580), "2025-10-12T12:03:00.000Z");
    assert.equal(toIso(""), null);
    assert.equal(toAtom(new Date("2026-10-12T12:03:00.123Z")), "2026-10-12T12:03:00+00:00");
  });

  it("round-trips frontmatter with colons, quotes and numbers", () => {
    const fm = frontmatter({ id: "abc", title: 'Exam: "room" change', date: "2026-10-12T14:03:00+02:00", postings: 3, skip: undefined });
    assert.ok(!fm.includes("skip"));
    const parsed = parseFrontmatter(`${fm}\n# body`);
    assert.equal(parsed.title, 'Exam: "room" change');
    assert.equal(parsed.date, "2026-10-12T14:03:00+02:00");
    assert.equal(parsed.postings, "3");
  });

  it("builds a short excerpt", () => {
    assert.equal(excerpt("# Heading\n\nFirst line\nSecond line\nThird"), "Heading · First line");
    assert.ok(excerpt("x".repeat(400), 50).endsWith("…"));
  });

  it("pages by offset until the total is reached", async () => {
    const data = Array.from({ length: 7 }, (_, i) => ({ type: "news", id: `n${i}` }));
    const { client, calls } = fakeClient({ "/x": { data } });
    const page = await fetchPages(client, "/x", {}, { pageSize: 3 });
    assert.equal(page.data.length, 7);
    assert.equal(page.total, 7);
    assert.deepEqual(calls.map((c) => c.query), [
      "page[limit]=3&page[offset]=0",
      "page[limit]=3&page[offset]=3",
      "page[limit]=3&page[offset]=6",
    ]);
    const capped = await fetchPages(client, "/x", {}, { pageSize: 3, max: 4 });
    assert.equal(capped.data.length, 4);
  });
});

// ── news ──────────────────────────────────────────────────────────────────────

describe("news", () => {
  it("normalises a course announcement with its author", () => {
    const item = normalizeNews(
      news("n1", "Sheet 1 is online", "2026-10-12T14:03:00+02:00"),
      new Included([user(LECTURER, "Dr. Example Lecturer")]),
      { courseId: COURSE, courseTitle: "Example Course" },
    );
    assert.equal(item.title, "Sheet 1 is online");
    assert.equal(item.text, "Hello **class**,\nsee the new sheet.");
    assert.equal(item.date, "2026-10-12T14:03:00+02:00");
    assert.deepEqual(item.author, { id: LECTURER, name: "Dr. Example Lecturer", username: "dr.example.lecturer" });
    assert.equal(item.scope, "course");
    assert.equal(item.courseId, COURSE);
    assert.equal(item.courseTitle, "Example Course");
    assert.equal(item.expiresAt, "2026-12-31T23:59:00+01:00");
  });

  it("detects global news and falls back to mkdate", () => {
    const res = news("g1", "Maintenance", "2026-10-01T08:00:00+02:00");
    res.relationships!.ranges = { data: [{ type: "global", id: "studip" }] };
    delete res.attributes!["publication-start"];
    const item = normalizeNews(res);
    assert.equal(item.scope, "global");
    assert.equal(item.courseId, null);
    assert.equal(item.date, "2026-10-01T08:00:00+02:00");
    assert.equal(item.author?.name, "(unknown)");
  });

  it("selects newest first with since and limit", () => {
    const items = ["2026-10-01", "2026-10-10", "2026-10-05"].map((d, i) =>
      normalizeNews(news(`n${i}`, `T${i}`, `${d}T10:00:00+02:00`)),
    );
    const out = selectNews(items, { since: new Date("2026-10-04T00:00:00+02:00"), limit: 5 });
    assert.deepEqual(out.map((n) => n.id), ["n1", "n2"]);
  });

  it("normalises news comments", () => {
    const c = normalizeNewsComment(
      { type: "comments", id: "k1", attributes: { content: "Thanks!", mkdate: "2026-10-12T15:00:00+02:00" }, relationships: { author: { data: { type: "users", id: STUDENT } } } },
      new Included([user(STUDENT, "Student A")]),
      "n1",
    );
    assert.deepEqual(c, { id: "k1", newsId: "n1", text: "Thanks!", date: "2026-10-12T15:00:00+02:00", author: { id: STUDENT, name: "Student A", username: "student.a" } });
  });

  it("writes dated markdown and a README index, idempotently", async () => {
    const inc = new Included([user(LECTURER, "Dr. Example Lecturer")]);
    const items: NewsItem[] = [
      normalizeNews(news("aaaaaaaaaaaa1111", "Exam date fixed", "2026-10-10T09:00:00+02:00"), inc, { courseId: COURSE }),
      normalizeNews(news("bbbbbbbbbbbb2222", "Sheet 1 is online", "2026-10-12T14:03:00+02:00"), inc, { courseId: COURSE }),
      normalizeNews(news("cccccccccccc3333", "Sheet 1 is online", "2026-10-12T18:00:00+02:00"), inc, { courseId: COURSE }),
    ];
    const newsDir = join(dir, "news");
    // a file from the old exporter (<id[0..12]>.md, no frontmatter) gets replaced
    await import("node:fs/promises").then((fs) => fs.mkdir(newsDir, { recursive: true }));
    await writeFile(join(newsDir, "aaaaaaaaaaaa.md"), "# Exam date fixed\n\nold format\n");

    const first = await writeNewsMarkdown(newsDir, items, { courseTitle: "Example Course" });
    assert.equal(first.written, 3);
    const files = (await readdir(newsDir)).sort();
    assert.deepEqual(files, [
      "2026-10-10-exam-date-fixed.md",
      "2026-10-12-sheet-1-is-online-cccccc.md",
      "2026-10-12-sheet-1-is-online.md",
      "README.md",
    ]);
    const md = await readFile(join(newsDir, "2026-10-10-exam-date-fixed.md"), "utf-8");
    const fm = parseFrontmatter(md);
    assert.equal(fm.id, "aaaaaaaaaaaa1111");
    assert.equal(fm.author, "Dr. Example Lecturer");
    assert.equal(fm.course, "Example Course");
    assert.equal(fm.date, "2026-10-10T09:00:00+02:00");
    assert.match(md, /# Exam date fixed\n\n_2026-10-10 · Dr\. Example Lecturer · Example Course_\n\nHello \*\*class\*\*/);

    const readme = await readFile(join(newsDir, "README.md"), "utf-8");
    const order = ["cccccc", "sheet-1-is-online.md", "exam-date-fixed"].map((s) => readme.indexOf(s));
    assert.ok(order.every((i) => i > 0) && order[0]! < order[2]! && order[1]! < order[2]!, readme);
    assert.match(readme, /^# News — Example Course/);

    const second = await writeNewsMarkdown(newsDir, items, { courseTitle: "Example Course" });
    assert.equal(second.written, 0);
    assert.equal(second.unchanged, 3);

    // a renamed announcement moves instead of duplicating
    const renamed = [{ ...items[0]!, title: "Exam date changed" }, ...items.slice(1)];
    await writeNewsMarkdown(newsDir, renamed, { courseTitle: "Example Course" });
    const after = await readdir(newsDir);
    assert.ok(after.includes("2026-10-10-exam-date-changed.md"));
    assert.ok(!after.includes("2026-10-10-exam-date-fixed.md"));
  });

  it("NewsResource.course asks for authors and never filters server-side", async () => {
    const { client, calls } = fakeClient({
      [`/courses/${COURSE}/news`]: {
        data: [news("n1", "A", "2026-10-01T10:00:00+02:00"), news("n2", "B", "2026-10-11T10:00:00+02:00")],
        included: [user(LECTURER, "Dr. Example Lecturer")],
      },
    });
    const items = await new NewsResource(client).course(COURSE, { since: new Date("2026-10-05T00:00:00Z") });
    assert.deepEqual(items.map((n) => n.id), ["n2"]);
    assert.equal(items[0]!.author?.name, "Dr. Example Lecturer");
    assert.ok(calls.every((c) => c.query.includes("include=author") && !c.query.includes("filter")));
  });
});

// ── messages ──────────────────────────────────────────────────────────────────

function message(id: string, sender: string | null, read: boolean, date: string): JsonApiResource {
  return {
    type: "messages",
    id,
    attributes: { subject: `Subject ${id}`, message: "<p>Line one<br>Line two</p>", mkdate: date, "is-read": read, priority: "normal", tags: ["uni"] },
    relationships: {
      ...(sender ? { sender: { data: { type: "users", id: sender } } } : {}),
      recipients: { data: [{ type: "users", id: ME }, { type: "users", id: STUDENT }] },
    },
  };
}

describe("messages", () => {
  it("normalises sender, recipients and read state", () => {
    const m = normalizeMessage(
      message("m1", LECTURER, false, "2026-10-12T09:00:00+02:00"),
      new Included([user(LECTURER, "Dr. Example Lecturer"), user(ME, "Me Student")]),
      "inbox",
    );
    assert.equal(m.subject, "Subject m1");
    assert.equal(m.text, "Line one\nLine two");
    assert.equal(m.read, false);
    assert.deepEqual(m.sender, { id: LECTURER, name: "Dr. Example Lecturer", username: "dr.example.lecturer" });
    assert.equal(m.recipientCount, 2);
    assert.deepEqual(m.recipients.map((r) => r.name), ["Me Student"]);
    assert.deepEqual(m.tags, ["uni"]);
  });

  it("labels system messages as sent by Stud.IP", () => {
    const m = normalizeMessage(message("m2", null, true, "2026-10-12T09:00:00+02:00"));
    assert.deepEqual(m.sender, { id: null, name: "Stud.IP" });
  });

  it("inbox uses filter[unread] and only GETs", async () => {
    const { client, calls } = fakeClient({
      [`/users/${ME}/inbox`]: {
        data: [message("m1", LECTURER, false, "2026-10-12T09:00:00+02:00"), message("m0", STUDENT, false, "2026-10-01T09:00:00+02:00")],
        included: [user(LECTURER, "Dr. Example Lecturer"), user(STUDENT, "Student A")],
      },
      "/messages/m1": { data: message("m1", LECTURER, false, "2026-10-12T09:00:00+02:00"), included: [user(LECTURER, "Dr. Example Lecturer")] },
    });
    const res = new MessagesResource(client);
    const inbox = await res.inbox(ME, { unread: true, limit: 1 });
    assert.deepEqual(inbox.map((m) => m.id), ["m1"]);
    assert.match(calls[0]!.query, /filter\[unread\]=1/);
    assert.match(calls[0]!.query, /include=sender/);
    const one = await res.get("m1");
    assert.equal(one.box, "single");
    assert.match(calls.at(-1)!.query, /include=sender,recipients/);
    assert.ok(calls.every((c) => !c.path.includes(" ")), "no write requests");
  });
});

// ── forum ─────────────────────────────────────────────────────────────────────

const TOPIC = "t0000000000000000000000000000001";
const CATEGORY = "k0000000000000000000000000000001";

function discussion(id: string, title: string, last: string, count: number, extra: Partial<JsonApiResource> = {}): JsonApiResource {
  return {
    type: "forum-discussions",
    id,
    attributes: { title, "closed-at": null, sticky: false, "view-count": 4, mkdate: "2026-10-01T10:00:00+02:00", chdate: last },
    meta: { "postings-count": count, "unread-postings-count": 1, "recent-activity": last },
    relationships: { topic: { data: { type: "forum-topics", id: TOPIC } }, user: { data: { type: "users", id: STUDENT } } },
    ...extra,
  };
}

function posting(id: string, author: string | null, date: string, extra: Record<string, unknown> = {}): JsonApiResource {
  return {
    type: "forum-postings",
    id,
    attributes: { content: "<p>raw</p>", "content-html": `<p>Posting ${id}</p>`, anonymous: false, mkdate: date, chdate: date, ...extra },
    relationships: author !== null ? { author: { data: { type: "forum-members", id: author } } } : {},
  };
}

function member(id: string, name: string, role: string): JsonApiResource {
  return { type: "forum-members", id, attributes: { username: "x", name, role, avatar_url: "" } };
}

const topicRes: JsonApiResource = {
  type: "forum-topics",
  id: TOPIC,
  attributes: { name: "Exercise sheets", description: "<p>Questions</p>", position: 0, mkdate: "2026-10-01T10:00:00+02:00", chdate: "2026-10-01T10:00:00+02:00" },
  meta: { "discussions-count": 1, "postings-count": 3, "unread-postings-count": 1, "recent-activity": "2026-10-12T10:00:00+02:00" },
  relationships: { category: { data: { type: "forum-categories", id: CATEGORY } } },
};

function threadDoc(): JsonApiDocument {
  const d = discussion("d1", "Question on task 3", "2026-10-12T10:00:00+02:00", 3, {});
  d.relationships!.postings = { data: [{ type: "forum-postings", id: "p2" }, { type: "forum-postings", id: "p1" }, { type: "forum-postings", id: "p3" }] };
  return {
    data: d,
    included: [
      posting("p2", LECTURER, "2026-10-11T09:00:00+02:00"),
      posting("p1", STUDENT, "2026-10-10T09:00:00+02:00"),
      posting("p3", "", "2026-10-12T10:00:00+02:00", { anonymous: true }),
      member(LECTURER, "Dr. Example Lecturer", "moderator"),
      member(STUDENT, "Student A", "author"),
      topicRes,
      user(STUDENT, "Student A"),
    ],
  };
}

describe("forum", () => {
  it("normalises discussion meta and topic name", () => {
    const d = normalizeForumDiscussion(discussion("d1", "Q", "2026-10-12T10:00:00+02:00", 3), new Included([topicRes, user(STUDENT, "Student A")]));
    assert.equal(d.topicName, "Exercise sheets");
    assert.equal(d.postingsCount, 3);
    assert.equal(d.unreadCount, 1);
    assert.equal(d.lastActivity, "2026-10-12T10:00:00+02:00");
    assert.equal(d.startedBy?.name, "Student A");
    assert.equal(d.closed, false);
  });

  it("orders postings oldest first, hides anonymous authors, marks moderators", () => {
    const doc = threadDoc();
    const t = normalizeForumThread(doc.data as JsonApiResource, doc.included!);
    assert.deepEqual(t.postings.map((p) => p.id), ["p1", "p2", "p3"]);
    assert.equal(t.postings[0]!.author.name, "Student A");
    assert.equal(t.postings[1]!.moderator, true);
    assert.deepEqual(t.postings[2]!.author, { id: null, name: "Anonymous" });
    assert.equal(t.postings[2]!.anonymous, true);
    assert.equal(t.postings[0]!.text, "Posting p1");
  });

  it("plans collision-free topic/discussion paths", () => {
    const topics = [
      { id: "ta", name: "General", position: 0 },
      { id: "tb", name: "General", position: 1 },
    ].map((t) => ({ ...t, description: "", categoryId: null, discussionsCount: 0, postingsCount: 0, unreadCount: 0, lastActivity: null }));
    const base = { topicName: null, startedBy: null, sticky: false, closed: false, closedAt: null, views: 0, postingsCount: 1, unreadCount: 0, lastActivity: null };
    const discussions = [
      { ...base, id: "d1aaaaaa", title: "Hello", topicId: "ta", createdAt: "2026-10-01T10:00:00+02:00" },
      { ...base, id: "d2bbbbbb", title: "Hello", topicId: "ta", createdAt: "2026-10-02T10:00:00+02:00" },
      { ...base, id: "d3cccccc", title: "Hello", topicId: "tb", createdAt: "2026-10-03T10:00:00+02:00" },
    ];
    const rels = planForumPaths({ topics, discussions }).map((p) => p.rel);
    assert.deepEqual(rels, ["general/hello.md", "general/hello-d2bbbb.md", "general-tb/hello.md"]);
  });

  it("renders a thread as markdown with frontmatter", () => {
    const doc = threadDoc();
    const md = forumThreadMarkdown(normalizeForumThread(doc.data as JsonApiResource, doc.included!), {
      courseTitle: "Example Course",
      courseId: COURSE,
      categoryName: "Course",
    });
    const fm = parseFrontmatter(md);
    assert.equal(fm.id, "d1");
    assert.equal(fm.topic, "Exercise sheets");
    assert.equal(fm.postings, "3");
    assert.match(md, /## Student A · 2026-10-10 09:00\n\nPosting p1/);
    assert.match(md, /## Dr\. Example Lecturer \(lecturer\/tutor\) · 2026-10-11 09:00/);
    assert.match(md, /## Anonymous · 2026-10-12 10:00/);
  });

  it("exports a course forum without the read-marking postings route, and skips unchanged threads", async () => {
    const routes = {
      [`/courses/${COURSE}/forum-categories`]: {
        data: [{ type: "forum-categories", id: CATEGORY, attributes: { name: "Course", position: 0 }, meta: { "topics-count": 1 } }],
      },
      [`/courses/${COURSE}/forum-topics`]: { data: [topicRes] },
      [`/courses/${COURSE}/forum-discussions`]: {
        data: [discussion("d1", "Question on task 3", "2026-10-12T10:00:00+02:00", 3)],
        included: [topicRes, user(STUDENT, "Student A")],
      },
      "/forum-discussions/d1": threadDoc,
    };
    const { client, calls } = fakeClient(routes);
    const forum = new ForumResource(client);
    const forumDir = join(dir, "forum");

    const first = await forum.exportCourseForum(COURSE, forumDir, { courseTitle: "Example Course" });
    assert.equal(first.available, true);
    assert.equal(first.fetched, 1);
    assert.equal(first.written, 1);
    const thread = await readFile(join(forumDir, "exercise-sheets", "question-on-task-3.md"), "utf-8");
    assert.match(thread, /category: Course/);
    const readme = await readFile(join(forumDir, "README.md"), "utf-8");
    assert.match(readme, /## Course\n\n### Exercise sheets\n\n- \[Question on task 3\]\(exercise-sheets\/question-on-task-3\.md\) — 3 postings · last 2026-10-12/);
    const threadCall = calls.find((c) => c.path === "/forum-discussions/d1");
    assert.match(threadCall!.query, /include=postings,postings\.author/);
    assert.ok(!calls.some((c) => c.path.endsWith("/postings")), "must not call the read-marking route");

    const second = await forum.exportCourseForum(COURSE, forumDir, { courseTitle: "Example Course" });
    assert.equal(second.fetched, 0);
    assert.equal(second.unchanged, 1);
  });

  it("reports a course without forum as unavailable", async () => {
    const { client } = fakeClient({});
    const { ImstudiumError } = await import("../errors.js");
    (client as unknown as { get: () => never }).get = () => {
      throw new ImstudiumError("forbidden", "HTTP_ERROR", 403);
    };
    const res = await new ForumResource(client).exportCourseForum(COURSE, join(dir, "forum"));
    assert.equal(res.available, false);
    assert.deepEqual(await readdir(dir), []);
  });
});

// ── blubber ───────────────────────────────────────────────────────────────────

describe("blubber", () => {
  const thread: JsonApiResource = {
    type: "blubber-threads",
    id: "b1",
    attributes: {
      name: "Example Course",
      "context-type": "course",
      content: "",
      "content-html": "",
      "is-commentable": true,
      "is-followed": true,
      "latest-activity": "2026-10-12T11:00:00+02:00",
      mkdate: "2026-04-01T10:00:00+02:00",
      chdate: "2026-04-01T10:00:00+02:00",
    },
    relationships: {
      author: { data: null },
      comments: { links: { related: { href: "/blubber-threads/b1/comments", meta: { "unseen-comments": 2 } } } as never },
      context: { data: { type: "courses", id: COURSE } },
    },
  };

  it("normalises a course thread with unseen count", () => {
    const t = normalizeBlubberThread(thread);
    assert.equal(t.courseId, COURSE);
    assert.equal(t.contextType, "course");
    assert.equal(t.unseenComments, 2);
    assert.equal(t.author, null);
    assert.equal(t.lastActivity, "2026-10-12T11:00:00+02:00");
  });

  it("normalises comments", () => {
    const c = normalizeBlubberComment(
      { type: "blubber-comments", id: "bc1", attributes: { content: "hi", "content-html": "<p>hi <em>all</em></p>", mkdate: "2026-10-12T11:00:00+02:00" }, relationships: { author: { data: { type: "users", id: STUDENT } }, thread: { data: { type: "blubber-threads", id: "b1" } } } },
      new Included([user(STUDENT, "Student A")]),
    );
    assert.deepEqual(c, { id: "bc1", threadId: "b1", text: "hi _all_", date: "2026-10-12T11:00:00+02:00", author: { id: STUDENT, name: "Student A", username: "student.a" } });
  });

  it("asks for the latest comments and returns them oldest first", async () => {
    const comments = ["2026-10-12T11:00:00+02:00", "2026-10-10T11:00:00+02:00"].map((d, i) => ({
      type: "blubber-comments",
      id: `bc${i}`,
      attributes: { content: `c${i}`, mkdate: d },
    }));
    const { client, calls } = fakeClient({ "/blubber-threads/b1/comments": { data: comments }, "/blubber-threads": { data: [thread] } });
    const res = new BlubberResource(client);
    const out = await res.comments("b1", { limit: 5, since: new Date("2026-10-01T00:00:00Z") });
    assert.deepEqual(out.map((c) => c.id), ["bc1", "bc0"]);
    assert.match(calls[0]!.query, /sort=-mkdate/);
    assert.match(calls[0]!.query, /filter\[since\]=2026-10-01T00:00:00\+00:00/);
    const mine = await res.mine({ limit: 3 });
    assert.equal(mine[0]!.id, "b1");
  });
});

// ── activity ──────────────────────────────────────────────────────────────────

describe("activity", () => {
  const activity = (id: string, type: string, date: string, object: Record<string, unknown>): JsonApiResource => ({
    type: "activities",
    id,
    attributes: { title: "Someone uploaded a file in course X", mkdate: date, content: "<p>sheet-1.pdf</p>", verb: "created", "activity-type": type },
    relationships: {
      actor: { data: { type: "users", id: LECTURER } },
      context: { data: { type: "courses", id: COURSE } },
      object: object as never,
    },
  });

  it("normalises an activity with course, object and url", () => {
    const a = normalizeActivity(
      activity("a1", "documents", "2026-10-12T10:00:00+02:00", { data: { type: "file-refs", id: "f1" } }),
      new Included([user(LECTURER, "Dr. Example Lecturer"), { type: "courses", id: COURSE, attributes: { title: "Example Course" } }]),
      "https://studip.example.org",
    );
    assert.equal(a.type, "documents");
    assert.equal(a.verb, "created");
    assert.equal(a.contextType, "course");
    assert.equal(a.courseTitle, "Example Course");
    assert.equal(a.objectType, "file-refs");
    assert.equal(a.text, "sheet-1.pdf");
    assert.equal(a.actor?.name, "Dr. Example Lecturer");
    assert.equal(a.url, `https://studip.example.org/dispatch.php/file/details/f1?cid=${COURSE}`);
  });

  it("reads object type from relationship meta when there is no route", () => {
    const a = normalizeActivity(activity("a2", "courseware", "2026-10-12T10:00:00+02:00", { meta: { "object-type": "courseware", "object-id": "42" } }));
    assert.equal(a.objectType, "courseware");
    assert.equal(a.objectId, "42");
    assert.equal(a.url, null);
  });

  it("parses activity types with aliases", () => {
    assert.deepEqual(parseActivityTypes("files, news,forum"), ["documents", "news", "forum"]);
    assert.equal(parseActivityTypes(undefined), undefined);
    assert.throws(() => parseActivityTypes("gossip"), /Unknown activity type/);
  });

  it("sends epoch-second time filters and type filter", async () => {
    const { client, calls } = fakeClient({
      [`/users/${ME}/activitystream`]: {
        data: [
          activity("a1", "documents", "2026-10-10T10:00:00+02:00", {}),
          activity("a2", "news", "2026-10-12T10:00:00+02:00", {}),
        ],
      },
    });
    const out = await new ActivityResource(client).stream(ME, {
      since: new Date("2026-10-05T00:00:00Z"),
      types: ["documents", "news"],
      courseId: COURSE,
    });
    assert.deepEqual(out.map((a) => a.id), ["a2", "a1"]);
    const q = calls[0]!.query;
    assert.match(q, /filter\[start\]=1791158400/);
    assert.match(q, /filter\[activity-type\]=documents,news/);
    assert.match(q, new RegExp(`filter\\[context-id\\]=${COURSE}`));
    assert.match(q, /include=actor,context/);
    assert.equal(out[0]!.url, `https://studip.example.org/dispatch.php/course/overview?cid=${COURSE}`);
  });
});

// ── sync hook ─────────────────────────────────────────────────────────────────

describe("syncCommunication", () => {
  it("writes news and forum for one course", async () => {
    const { client } = fakeClient({
      [`/courses/${COURSE}/news`]: { data: [news("n1", "Welcome", "2026-10-12T10:00:00+02:00")], included: [user(LECTURER, "Dr. Example Lecturer")] },
      [`/courses/${COURSE}/forum-categories`]: { data: [] },
      [`/courses/${COURSE}/forum-topics`]: { data: [topicRes] },
      [`/courses/${COURSE}/forum-discussions`]: { data: [discussion("d1", "Question on task 3", "2026-10-12T10:00:00+02:00", 3)], included: [topicRes] },
      "/forum-discussions/d1": threadDoc,
    });
    const courseDir = join(dir, "WS2026", "Example-Course");
    const res = await syncCommunication(
      { news: new NewsResource(client), forum: new ForumResource(client) },
      { id: COURSE, title: "Example Course" },
      courseDir,
    );
    assert.deepEqual(res.errors, []);
    assert.equal(res.news?.written, 1);
    assert.equal(res.forum?.written, 1);
    assert.deepEqual((await readdir(courseDir)).sort(), ["forum", "news"]);
    assert.ok((await readdir(join(courseDir, "news"))).includes("2026-10-12-welcome.md"));
  });

  it("keeps going when one area fails", async () => {
    const res = await syncCommunication(
      {
        news: { exportCourseNews: async () => { throw new Error("boom"); } },
        forum: { exportCourseForum: async (_id, d) => ({ dir: d, available: false, discussions: 0, fetched: 0, written: 0, unchanged: 0, files: [], errors: [] }) },
      },
      { id: COURSE },
      dir,
    );
    assert.deepEqual(res.errors, [{ area: "news", message: "boom" }]);
    assert.equal(res.forum?.available, false);
  });

  it("does nothing on dry run", async () => {
    let called = false;
    const res = await syncCommunication(
      {
        news: { exportCourseNews: async () => { called = true; throw new Error("x"); } },
        forum: { exportCourseForum: async () => { called = true; throw new Error("x"); } },
      },
      { id: COURSE },
      dir,
      { dryRun: true },
    );
    assert.equal(called, false);
    assert.deepEqual(res.errors, []);
  });
});
