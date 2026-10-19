/**
 * Course wiki: the full page tree as markdown.
 *
 * Stud.IP 6.1 quirks handled here:
 *  - the page title attribute is `name` (older code read `keyword`)
 *  - /courses/{id}/wiki-pages answers 404 when the course has no pages yet
 *  - content is HTML for pages edited since 5.x, legacy wiki markup before
 *  - the hierarchy is the `parent` relationship; siblings sort by name
 */
import { join } from "node:path";
import type { StudIpClient } from "../client.js";
import { ImstudiumError } from "../errors.js";
import { attr, relId } from "../jsonapi.js";
import type { JsonApiResource } from "../types.js";
import { cleanDate } from "./courseware.js";
import { htmlToMarkdown, frontmatter, shortHash, contentSlug, studipMarkupToMarkdown } from "../content/markdown.js";
import { removeStale, writeIfChanged, type WriteOptions } from "../content/courseware-write.js";

export interface WikiPage {
  id: string;
  name: string;
  parentId: string | null;
  chdate: string | null;
  version: number | null;
  /** Raw content as stored in Stud.IP. */
  content: string;
  format: "html" | "markup";
}

export interface WikiNode extends WikiPage {
  depth: number;
  childIds: string[];
  /** File name inside wiki/, e.g. "klausurinfos.md". */
  file: string;
  isStart: boolean;
}

/** The legacy default start page keyword. */
export const WIKI_START = "WikiWikiWeb";

export function wikiFormat(content: string): "html" | "markup" {
  if (content.startsWith("<!--HTML-->")) return "html";
  return /<\/?(p|div|br|h[1-6]|ul|ol|li|table|a|strong|em|span|img|pre)\b/i.test(content) ? "html" : "markup";
}

export function normalizeWikiPage(r: JsonApiResource): WikiPage {
  const content = String(attr(r, "content") ?? "");
  const version = attr<number>(r, "version");
  return {
    id: r.id,
    name: String(attr(r, "name") ?? attr(r, "keyword") ?? r.id),
    parentId: relId(r, "parent"),
    chdate: cleanDate(attr(r, "chdate")),
    version: typeof version === "number" ? version : null,
    content,
    format: wikiFormat(content),
  };
}

/** Pages in reading order: start page first, then depth-first by name. */
export function buildWikiTree(pages: WikiPage[]): WikiNode[] {
  const byId = new Map(pages.map((p) => [p.id, p]));
  const kids = new Map<string | null, WikiPage[]>();
  for (const p of pages) {
    const parent = p.parentId && byId.has(p.parentId) && p.parentId !== p.id ? p.parentId : null;
    const list = kids.get(parent) ?? [];
    list.push(p);
    kids.set(parent, list);
  }
  const cmp = (a: WikiPage, b: WikiPage) =>
    Number(b.name === WIKI_START) - Number(a.name === WIKI_START) || a.name.localeCompare(b.name, "de");
  for (const list of kids.values()) list.sort(cmp);

  const files = new Map<string, number>();
  const fileFor = (p: WikiPage) => {
    const base = p.name === WIKI_START ? "start" : contentSlug(p.name);
    const n = (files.get(base) ?? 0) + 1;
    files.set(base, n);
    return `${n === 1 ? base : `${base}-${n}`}.md`;
  };

  const out: WikiNode[] = [];
  const seen = new Set<string>();
  const visit = (p: WikiPage, depth: number) => {
    if (seen.has(p.id)) return;
    seen.add(p.id);
    const children = kids.get(p.id) ?? [];
    out.push({ ...p, depth, childIds: children.map((c) => c.id), file: fileFor(p), isStart: p.name === WIKI_START });
    children.forEach((c) => visit(c, depth + 1));
  };
  (kids.get(null) ?? []).forEach((p) => visit(p, 0));
  // Parent cycles: anything not reached hangs at the top level.
  for (const p of pages) if (!seen.has(p.id)) visit(p, 0);
  return out;
}

export function wikiPageUrl(origin: string, courseId: string, pageId: string): string {
  return `${origin.replace(/\/+$/, "")}/dispatch.php/course/wiki/page/${pageId}?cid=${courseId}`;
}

export interface RenderedWikiPage {
  node: WikiNode;
  markdown: string;
  hash: string;
}

export interface RenderedWiki {
  pages: RenderedWikiPage[];
  readme: string;
}

/** Page content → markdown, with links between wiki pages pointing at the local files. */
export function wikiContentToMarkdown(node: WikiPage, nodes: WikiNode[], origin: string): string {
  const byName = new Map(nodes.map((n) => [n.name.toLowerCase(), n]));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  if (node.format === "markup") {
    return studipMarkupToMarkdown(node.content, (name) => {
      const hit = byName.get(name.toLowerCase());
      return hit ? `./${encodeURI(hit.file)}` : null;
    });
  }
  return htmlToMarkdown(node.content.replace(/^<!--HTML-->/, ""), origin).replace(
    /\]\(([^)\s]+)\)/g,
    (whole, url: string) => {
      const id = /\/course\/wiki\/page\/(\d+)/.exec(url)?.[1];
      const keyword = /[?&]keyword=([^&#]+)/.exec(url)?.[1];
      const hit = id ? byId.get(id) : keyword ? byName.get(decodeURIComponent(keyword.replace(/\+/g, " ")).toLowerCase()) : undefined;
      return hit ? `](./${encodeURI(hit.file)})` : whole;
    },
  );
}

export function renderWiki(pages: WikiPage[], ctx: { origin: string; courseId: string; courseTitle?: string }): RenderedWiki {
  const nodes = buildWikiTree(pages);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const rendered = nodes.map((node): RenderedWikiPage => {
    const body = [`# ${node.name}`, "", wikiContentToMarkdown(node, nodes, ctx.origin) || "_(empty page)_"];
    if (node.childIds.length) {
      body.push("", "**Subpages:**", "", ...node.childIds.map((id) => `- [${byId.get(id)!.name}](./${encodeURI(byId.get(id)!.file)})`));
    }
    const text = body.join("\n").trimEnd() + "\n";
    const hash = shortHash(text);
    const head = frontmatter({
      source: "studip-wiki",
      course: ctx.courseId,
      page: node.id,
      name: node.name,
      parent: node.parentId,
      chdate: node.chdate,
      version: node.version,
      url: wikiPageUrl(ctx.origin, ctx.courseId, node.id),
      hash,
    });
    return { node, markdown: `${head}\n${text}`, hash };
  });

  const readme = [
    "---",
    "source: studip-wiki-index",
    `course: ${ctx.courseId}`,
    "---",
    "",
    `# Wiki${ctx.courseTitle ? ` — ${ctx.courseTitle}` : ""}`,
    "",
    nodes.length ? `${nodes.length} page${nodes.length === 1 ? "" : "s"}, read-only copy from Stud.IP.` : "_This course has no wiki pages._",
    "",
    ...nodes.map((n) => `${"  ".repeat(n.depth)}- [${n.name}](./${encodeURI(n.file)})${n.isStart ? " (start page)" : ""}`),
    "",
  ].join("\n");
  return { pages: rendered, readme };
}

export interface WriteWikiResult {
  dir: string;
  pages: number;
  written: number;
  skipped: number;
  removed: number;
}

export async function writeWiki(rendered: RenderedWiki, wikiDir: string, options: WriteOptions = {}): Promise<WriteWikiResult> {
  const result: WriteWikiResult = { dir: wikiDir, pages: rendered.pages.length, written: 0, skipped: 0, removed: 0 };
  for (const p of rendered.pages) {
    result[await writeIfChanged(join(wikiDir, p.node.file), p.markdown, p.hash, options)]++;
  }
  await writeIfChanged(join(wikiDir, "README.md"), rendered.readme, null, options);
  result.removed = await removeStale(wikiDir, new Set(rendered.pages.map((p) => p.node.file)), "studip-wiki", options);
  return result;
}

export class WikiResource {
  constructor(private client: StudIpClient) {}

  get origin(): string {
    return this.client.apiBase.replace(/\/jsonapi\.php\/v1$/, "");
  }

  /** Raw JSON:API pages (kept for existing callers). */
  async listCoursePages(courseId: string): Promise<JsonApiResource<"wiki-pages">[]> {
    try {
      return await this.client.paginateAll<JsonApiResource<"wiki-pages">>(`/courses/${courseId}/wiki-pages`);
    } catch (e) {
      // Stud.IP answers 404 for a course without wiki pages, 403 when the wiki is off.
      if (e instanceof ImstudiumError && (e.status === 404 || e.status === 403)) return [];
      throw e;
    }
  }

  async listPages(courseId: string): Promise<WikiPage[]> {
    return (await this.listCoursePages(courseId)).map(normalizeWikiPage);
  }

  /** Writes wiki/<page>.md + wiki/README.md; returns the page count. */
  async exportCourseWiki(courseId: string, outDir: string, options: WriteOptions & { courseTitle?: string } = {}): Promise<number> {
    const pages = await this.listPages(courseId);
    const rendered = renderWiki(pages, { origin: this.origin, courseId, courseTitle: options.courseTitle });
    await writeWiki(rendered, outDir, options);
    return pages.length;
  }
}
