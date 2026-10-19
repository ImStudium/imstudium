import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { StudIpClient } from "../client.js";
import { attr, htmlToText, Included, relId } from "../jsonapi.js";
import type { JsonApiIdentifier, JsonApiResource } from "../types.js";
import {
  displayName,
  fetchPages,
  frontmatter,
  isoDay,
  mdLabel,
  mdLink,
  moveIfRenamed,
  personFrom,
  scanMarkdown,
  titleSlug,
  toIso,
  toMs,
  writeIfChanged,
  type Person,
} from "./comm-util.js";

/** Where an announcement was published. */
export type NewsScope = "course" | "global" | "institute" | "user" | "unknown";

/** One Stud.IP announcement ("Ankündigung"), normalised. */
export interface NewsItem {
  id: string;
  title: string;
  /** Body as readable markdown-ish text. */
  text: string;
  /** When students could first see it (publication start; falls back to creation). */
  date: string;
  createdAt: string | null;
  updatedAt: string | null;
  /** End of visibility — Stud.IP hides the news afterwards. */
  expiresAt: string | null;
  author: Person | null;
  scope: NewsScope;
  courseId: string | null;
  courseTitle: string | null;
  commentsAllowed: boolean;
}

export interface NewsComment {
  id: string;
  newsId: string | null;
  text: string;
  date: string;
  author: Person | null;
}

export interface NewsContext {
  courseId?: string;
  courseTitle?: string;
}

export interface NewsListOptions {
  /** Only news published at or after this moment. */
  since?: Date;
  /** Newest N after filtering. */
  limit?: number;
  /** Course title to stamp on items (avoids an extra request). */
  courseTitle?: string;
}

export interface NewsWriteResult {
  dir: string;
  total: number;
  written: number;
  unchanged: number;
  files: string[];
}

function rangeIds(resource: JsonApiResource): JsonApiIdentifier[] {
  const data = resource.relationships?.ranges?.data;
  return Array.isArray(data) ? data : data ? [data] : [];
}

function scopeOf(ranges: JsonApiIdentifier[], context: NewsContext): NewsScope {
  if (context.courseId || ranges.some((r) => r.type === "courses")) return "course";
  if (ranges.some((r) => r.type === "global")) return "global";
  if (ranges.some((r) => r.type === "institutes")) return "institute";
  if (ranges.some((r) => r.type === "users")) return "user";
  return "unknown";
}

export function normalizeNews(
  resource: JsonApiResource,
  included: Included = new Included(),
  context: NewsContext = {},
): NewsItem {
  const a = resource.attributes ?? {};
  const ranges = rangeIds(resource);
  const courseId = context.courseId ?? ranges.find((r) => r.type === "courses")?.id ?? null;
  const createdAt = toIso(a.mkdate);
  return {
    id: resource.id,
    title: String(a.title ?? "").trim() || "(untitled)",
    text: htmlToText(a.content),
    date: toIso(a["publication-start"]) ?? createdAt ?? "",
    createdAt,
    updatedAt: toIso(a.chdate),
    expiresAt: toIso(a["publication-end"]),
    author: personFrom(included, resource, "author"),
    scope: scopeOf(ranges, context),
    courseId,
    courseTitle: context.courseTitle ?? attr<string>(courseId ? included.get("courses", courseId) : undefined, "title") ?? null,
    commentsAllowed: Boolean(a["comments-allowed"]),
  };
}

export function normalizeNewsComment(
  resource: JsonApiResource,
  included: Included = new Included(),
  newsId?: string,
): NewsComment {
  const a = resource.attributes ?? {};
  return {
    id: resource.id,
    newsId: newsId ?? relId(resource, "news"),
    text: htmlToText(a.content),
    date: toIso(a.mkdate) ?? "",
    author: personFrom(included, resource, "author"),
  };
}

/** Newest first, optionally only since a date and capped. */
export function selectNews(items: NewsItem[], options: Pick<NewsListOptions, "since" | "limit"> = {}): NewsItem[] {
  const since = options.since?.getTime();
  const out = items
    .filter((n) => since === undefined || toMs(n.date) >= since)
    .sort((a, b) => toMs(b.date) - toMs(a.date) || a.id.localeCompare(b.id));
  return options.limit && options.limit > 0 ? out.slice(0, options.limit) : out;
}

// ── Markdown ──────────────────────────────────────────────────────────────────

export function newsFileBase(item: NewsItem): string {
  return `${isoDay(item.date)}-${titleSlug(item.title, item.id.slice(0, 8))}`;
}

export function newsMarkdown(item: NewsItem, courseTitle?: string | null): string {
  const course = courseTitle ?? item.courseTitle ?? undefined;
  const meta = [isoDay(item.date), displayName(item.author), course].filter(Boolean).join(" · ");
  return [
    frontmatter({
      id: item.id,
      title: item.title,
      date: item.date,
      author: item.author?.name,
      course: course ?? undefined,
      courseId: item.courseId ?? undefined,
      updated: item.updatedAt ?? undefined,
      expires: item.expiresAt ?? undefined,
    }),
    `# ${item.title}`,
    "",
    `_${meta}_`,
    "",
    item.text || "_(no text)_",
    "",
  ].join("\n");
}

async function removeLegacyFile(dir: string, id: string, keep: string): Promise<void> {
  // The old exporter wrote <first 12 id chars>.md without frontmatter.
  const legacy = join(dir, `${id.slice(0, 12)}.md`);
  if (legacy === keep) return;
  try {
    const text = await readFile(legacy, "utf-8");
    if (!text.startsWith("---\n")) await unlink(legacy);
  } catch {
    // none
  }
}

/**
 * Write `<newsDir>/<YYYY-MM-DD>-<slug>.md` per announcement plus a README index
 * (newest first). Idempotent: unchanged news are not rewritten, a renamed title
 * moves the file, and news that expired in Stud.IP stay as an archive.
 */
export async function writeNewsMarkdown(
  newsDir: string,
  items: NewsItem[],
  options: { courseTitle?: string } = {},
): Promise<NewsWriteResult> {
  const existing = await scanMarkdown(newsDir, 1);
  const taken = new Map<string, string>();
  for (const [id, entry] of existing) taken.set(entry.rel, id);

  const result: NewsWriteResult = { dir: newsDir, total: items.length, written: 0, unchanged: 0, files: [] };
  const ordered = [...items].sort((a, b) => toMs(a.date) - toMs(b.date) || a.id.localeCompare(b.id));
  for (const item of ordered) {
    const base = newsFileBase(item);
    let name = `${base}.md`;
    const owner = taken.get(name);
    if (owner && owner !== item.id) name = `${base}-${item.id.slice(0, 6)}.md`;
    taken.set(name, item.id);

    const target = join(newsDir, name);
    await moveIfRenamed(existing.get(item.id)?.path, target);
    if (await writeIfChanged(target, newsMarkdown(item, options.courseTitle))) result.written++;
    else result.unchanged++;
    await removeLegacyFile(newsDir, item.id, target);
    result.files.push(target);
  }

  await writeNewsIndex(newsDir, options.courseTitle);
  return result;
}

/** README.md listing every news file in the folder (current and archived), newest first. */
export async function writeNewsIndex(newsDir: string, courseTitle?: string): Promise<void> {
  const entries = [...(await scanMarkdown(newsDir, 1)).values()].sort(
    (a, b) => toMs(b.fm.date) - toMs(a.fm.date) || a.rel.localeCompare(b.rel),
  );
  const course = courseTitle ?? entries.find((e) => e.fm.course)?.fm.course;
  const lines = [
    `# News${course ? ` — ${course}` : ""}`,
    "",
    "Announcements from Stud.IP, newest first — one file each. Written by `imstudium news --save` and `imstudium sync`.",
    "",
    ...(entries.length
      ? entries.map(
          (e) =>
            `- **${isoDay(e.fm.date)}** · [${mdLabel(e.fm.title || e.rel)}](${mdLink(e.rel)})${e.fm.author ? ` — ${e.fm.author}` : ""}`,
        )
      : ["_No announcements yet._"]),
    "",
  ];
  await writeIfChanged(join(newsDir, "README.md"), lines.join("\n"));
}

// ── Resource ──────────────────────────────────────────────────────────────────

const MAX_NEWS = 500;

export class NewsResource {
  constructor(private client: StudIpClient) {}

  /** Raw JSON:API news of a course (kept for SDK consumers of 0.1.x). */
  async listCourseNews(courseId: string): Promise<JsonApiResource<"news">[]> {
    return this.client.paginateAll<JsonApiResource<"news">>(`/courses/${courseId}/news`);
  }

  /**
   * Announcements currently visible in a course. Stud.IP 6.1 offers no filters on
   * news routes (unknown filters are rejected), so `since`/`limit` apply locally.
   */
  async course(courseId: string, options: NewsListOptions = {}): Promise<NewsItem[]> {
    const page = await fetchPages(this.client, `/courses/${courseId}/news`, { include: "author" }, { max: MAX_NEWS });
    const included = new Included(page.included);
    const items = page.data.map((r) => normalizeNews(r, included, { courseId, courseTitle: options.courseTitle }));
    return selectNews(items, options);
  }

  /** News the user authored (Stud.IP's /users/{id}/news — not a feed of their courses). */
  async byAuthor(userId: string, options: NewsListOptions = {}): Promise<NewsItem[]> {
    const page = await fetchPages(this.client, `/users/${userId}/news`, { include: "author" }, { max: MAX_NEWS });
    const included = new Included(page.included);
    return selectNews(page.data.map((r) => normalizeNews(r, included)), options);
  }

  /** System-wide announcements shown on the Stud.IP start page. */
  async global(options: NewsListOptions = {}): Promise<NewsItem[]> {
    const page = await fetchPages(this.client, "/studip/news", { include: "author" }, { max: MAX_NEWS });
    const included = new Included(page.included);
    return selectNews(page.data.map((r) => normalizeNews(r, included)), options);
  }

  /** Comments under one announcement, oldest first. */
  async comments(newsId: string, options: { limit?: number } = {}): Promise<NewsComment[]> {
    const page = await fetchPages(this.client, `/news/${newsId}/comments`, { include: "author" }, { max: options.limit });
    const included = new Included(page.included);
    return page.data
      .map((r) => normalizeNewsComment(r, included, newsId))
      .sort((a, b) => toMs(a.date) - toMs(b.date));
  }

  /**
   * Fetch a course's news and write them into `outDir` (the course's `news/`
   * folder) as dated markdown files plus README.md.
   */
  async exportCourseNews(
    courseId: string,
    outDir: string,
    options: { courseTitle?: string } = {},
  ): Promise<NewsWriteResult> {
    const items = await this.course(courseId, { courseTitle: options.courseTitle });
    return writeNewsMarkdown(outDir, items, options);
  }
}
