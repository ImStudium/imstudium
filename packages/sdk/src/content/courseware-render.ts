/**
 * Courseware → markdown. Pure: takes normalized content, returns strings.
 * Covers the Stud.IP 6 core block types; anything else renders as
 * `> [block <type>] <title>` so nothing is silently dropped.
 */
import {
  coursewareElementUrl,
  type CoursewareUnitContent,
  type CwBlock,
  type CwContainer,
  type CwElementNode,
  type CwFile,
} from "../resources/courseware.js";
import {
  formatBytes,
  formatLocalDateTime,
  frontmatter,
  htmlToMarkdown,
  safeFileName,
  shortHash,
  contentSlug,
} from "./markdown.js";

export interface BlockRenderContext {
  origin: string;
  courseId: string;
  unitId: string;
  /** Heading level of the page title; blocks nest below it. */
  headingLevel: number;
  /** Element id → path of its markdown file relative to the unit folder. */
  elementPaths: Record<string, string>;
  elementTitles: Record<string, string>;
  /** Element id → child element ids (for table-of-contents blocks). */
  children: Record<string, string[]>;
  files: Record<string, CwFile>;
  /** File id → path relative to the unit folder (e.g. files/slides.pdf). */
  fileNames: Record<string, string>;
  /** Element id of the page being rendered. */
  elementId: string;
}

export interface RenderedBlock {
  markdown: string;
  /** File-ref ids this block wants downloaded. */
  files: string[];
}

function s(v: unknown): string {
  return typeof v === "string" ? v.trim() : v === undefined || v === null ? "" : String(v).trim();
}

function list(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : [];
}

function h(level: number, text: string): string {
  return `${"#".repeat(Math.min(Math.max(level, 1), 6))} ${text}`;
}

function quote(text: string): string {
  return text
    .split("\n")
    .map((l) => (l ? `> ${l}` : ">"))
    .join("\n");
}

function fileLink(ctx: BlockRenderContext, id: string, label?: string): { md: string; file?: string } {
  const file = ctx.files[id];
  const path = ctx.fileNames[id];
  if (!file) return { md: label ? `${label} _(file not available)_` : "_(file not available)_" };
  const text = label || file.name;
  const size = file.size ? ` (${formatBytes(file.size)})` : "";
  if (!file.downloadable || !path) return { md: `${text}${size} _(view in Stud.IP)_` };
  return { md: `[${text}](${encodeURI(path)})${size}`, file: id };
}

function imageLink(ctx: BlockRenderContext, id: string, alt: string): { md: string; file?: string } {
  const file = ctx.files[id];
  const path = ctx.fileNames[id];
  if (!file || !path || !file.downloadable) return { md: `[image: ${alt || file?.name || "unavailable"}]` };
  return { md: `![${alt || file.name}](${encodeURI(path)})`, file: id };
}

function elementLink(ctx: BlockRenderContext, id: string): string {
  const title = ctx.elementTitles[id] ?? "page";
  const path = ctx.elementPaths[id];
  // Every page of a unit lives in the same folder, so a sibling link is enough.
  if (path) return `[${title}](./${encodeURI(path)})`;
  return `[${title}](${coursewareElementUrl(ctx.origin, ctx.courseId, ctx.unitId, id)})`;
}

function media(kind: string, block: CwBlock, ctx: BlockRenderContext): RenderedBlock {
  const p = block.payload;
  const title = s(p.title) || kind;
  if (s(p.source) === "web" || !s(p.file_id)) {
    const url = s(p.web_url) || s(p.url);
    if (url) return { markdown: `**${kind}:** [${title}](${url})`, files: [] };
    if (s(p.folder_id)) return { markdown: `**${kind}:** ${title} _(playlist in Stud.IP)_`, files: [] };
    return { markdown: `**${kind}:** ${title}`, files: [] };
  }
  const link = fileLink(ctx, s(p.file_id), title);
  return { markdown: `**${kind}:** ${link.md}`, files: link.file ? [link.file] : [] };
}

function fromTimestamp(v: unknown): string {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return "";
  // Stud.IP stores milliseconds (time() * 1000); accept seconds too.
  return formatLocalDateTime(new Date(n < 1e12 ? n * 1000 : n).toISOString());
}

type Renderer = (block: CwBlock, ctx: BlockRenderContext) => RenderedBlock;

const RENDERERS: Record<string, Renderer> = {
  text: (b, ctx) => ({ markdown: htmlToMarkdown(b.payload.text, ctx.origin), files: [] }),

  headline: (b, ctx) => {
    const p = b.payload;
    const lines = [h(ctx.headingLevel + 1, s(p.title) || b.title || "Headline")];
    if (s(p.subtitle)) lines.push(`_${s(p.subtitle)}_`);
    if (s(p.second_subtitle)) lines.push(s(p.second_subtitle));
    return { markdown: lines.join("\n\n"), files: [] };
  },

  "key-point": (b) => ({ markdown: quote(`**Key point:** ${s(b.payload.text)}`), files: [] }),

  code: (b) => {
    const content = typeof b.payload.content === "string" ? b.payload.content.replace(/\n+$/, "") : "";
    const fence = content.includes("```") ? "````" : "```";
    return { markdown: `${fence}${s(b.payload.lang)}\n${content}\n${fence}`, files: [] };
  },

  link: (b, ctx) => {
    const p = b.payload;
    const title = s(p.title);
    if (s(p.type) === "internal" && s(p.target)) {
      const link = elementLink(ctx, s(p.target));
      return { markdown: title ? `**Link:** ${title} → ${link}` : `**Link:** ${link}`, files: [] };
    }
    const url = s(p.url);
    return { markdown: url ? `**Link:** [${title || url}](${url})` : `**Link:** ${title || "(empty)"}`, files: [] };
  },

  video: (b, ctx) => media("Video", b, ctx),
  audio: (b, ctx) => media("Audio", b, ctx),

  embed: (b) => {
    const p = b.payload;
    const url = s(p.url);
    const source = s(p.source);
    const label = s(p.title) || source || "Embedded media";
    return { markdown: `**Embed${source ? ` (${source})` : ""}:** ${url ? `[${label}](${url})` : label}`, files: [] };
  },

  iframe: (b) => {
    const url = s(b.payload.url);
    const title = s(b.payload.title) || "Embedded page";
    return { markdown: `**Embedded page:** ${url ? `[${title}](${url})` : title}`, files: [] };
  },

  document: (b, ctx) => {
    const p = b.payload;
    const title = s(p.title) || "Document";
    if (!s(p.file_id)) return { markdown: `**Document:** ${title}`, files: [] };
    if (s(p.downloadable) === "false") {
      const name = ctx.files[s(p.file_id)]?.name;
      return { markdown: `**Document:** ${title}${name ? ` (${name})` : ""} _(view only in Stud.IP)_`, files: [] };
    }
    const link = fileLink(ctx, s(p.file_id), title);
    return { markdown: `**Document:** ${link.md}`, files: link.file ? [link.file] : [] };
  },

  download: (b, ctx) => {
    const p = b.payload;
    const lines: string[] = [];
    const files: string[] = [];
    if (s(p.file_id)) {
      const link = fileLink(ctx, s(p.file_id), s(p.title) || undefined);
      lines.push(`**Download:** ${link.md}`);
      if (link.file) files.push(link.file);
    } else lines.push(`**Download:** ${s(p.title) || "(no file)"}`);
    if (s(p.info)) lines.push(s(p.info));
    return { markdown: lines.join("\n\n"), files };
  },

  // Folder blocks point at course folders that the file sync already mirrors,
  // so list them here instead of downloading every file a second time.
  folder: (b) => {
    const p = b.payload;
    const title = s(p.title) || "Folder";
    if (s(p["folder-type"]) === "HomeworkFolder") {
      return { markdown: `**Folder:** ${title} _(submission folder — upload in Stud.IP)_`, files: [] };
    }
    const entries = list(p.files);
    const lines = [`**Folder:** ${title} _(in the course files)_`];
    for (const e of entries) {
      const a = (e.attributes ?? {}) as Record<string, unknown>;
      const size = typeof a.filesize === "number" ? ` (${formatBytes(a.filesize)})` : "";
      lines.push(`- ${s(a.name) || s(e.id)}${size}`);
    }
    if (!entries.length) lines.push("_(empty or not accessible)_");
    return { markdown: lines.join("\n"), files: [] };
  },

  gallery: (b, ctx) => {
    const files: string[] = [];
    const lines = ["**Gallery:**", ""];
    for (const e of list(b.payload.files)) {
      const name = s((e.attributes as Record<string, unknown> | undefined)?.name);
      const img = imageLink(ctx, s(e.id), name);
      lines.push(img.md);
      if (img.file) files.push(img.file);
    }
    if (lines.length === 2) lines.push("_(no images)_");
    return { markdown: lines.join("\n"), files };
  },

  "image-map": (b, ctx) => {
    const img = imageLink(ctx, s(b.payload.file_id), "Image map");
    const shapes = list(b.payload.shapes)
      .map((sh) => s(sh.title) || s((sh.data as Record<string, unknown> | undefined)?.text))
      .filter(Boolean);
    const md = [img.md, ...shapes.map((t) => `- ${t}`)].join("\n");
    return { markdown: md, files: img.file ? [img.file] : [] };
  },

  "before-after": (b, ctx) => {
    const p = b.payload;
    const files: string[] = [];
    const side = (label: string, source: string, fileId: string, url: string) => {
      if (source === "web" && url) return `![${label}](${url})`;
      const img = imageLink(ctx, fileId, label);
      if (img.file) files.push(img.file);
      return img.md;
    };
    return {
      markdown: [
        "**Before / after:**",
        "",
        side("Before", s(p.before_source), s(p.before_file_id), s(p.before_web_url)),
        side("After", s(p.after_source), s(p.after_file_id), s(p.after_web_url)),
      ].join("\n"),
      files,
    };
  },

  canvas: (b, ctx) => {
    const title = s(b.payload.title) || "Canvas";
    if (!s(b.payload.file_id)) return { markdown: `**Canvas:** ${title} _(drawing area in Stud.IP)_`, files: [] };
    const img = imageLink(ctx, s(b.payload.file_id), title);
    return { markdown: `**Canvas:** ${title}\n\n${img.md}`, files: img.file ? [img.file] : [] };
  },

  typewriter: (b) => ({ markdown: s(b.payload.text), files: [] }),

  confirm: (b) => ({ markdown: `- [ ] ${s(b.payload.text) || "Confirm"}`, files: [] }),

  date: (b) => {
    const when = fromTimestamp(b.payload.timestamp);
    const style = s(b.payload.style) === "countdown" ? " (countdown)" : "";
    return { markdown: `**Date:** ${when || "(not set)"}${style}`, files: [] };
  },

  "table-of-contents": (b, ctx) => {
    const kids = ctx.children[ctx.elementId] ?? [];
    const title = s(b.payload.title);
    const lines = [title ? `**${title}**` : "**Contents**", ""];
    for (const id of kids) lines.push(`- ${elementLink(ctx, id)}`);
    if (!kids.length) lines.push("_(no subpages)_");
    return { markdown: lines.join("\n"), files: [] };
  },

  chart: (b) => {
    const rows = list(b.payload.content);
    const lines = [`**Chart${s(b.payload.type) ? ` (${s(b.payload.type)})` : ""}:** ${s(b.payload.label)}`.trimEnd(), ""];
    if (rows.length) {
      lines.push("| Label | Value |", "| --- | --- |");
      for (const r of rows) lines.push(`| ${s(r.label).replace(/\|/g, "\\|")} | ${s(r.value)} |`);
    }
    return { markdown: lines.join("\n").trim(), files: [] };
  },

  "dialog-cards": (b, ctx) => {
    const files: string[] = [];
    const lines = ["**Flashcards:**", ""];
    list(b.payload.cards).forEach((c, i) => {
      const side = (text: string, fileId: string, label: string) => {
        const parts: string[] = [];
        if (fileId) {
          const img = imageLink(ctx, fileId, label);
          if (img.file) files.push(img.file);
          parts.push(img.md);
        }
        if (text) parts.push(text);
        return parts.join(" ") || "—";
      };
      lines.push(`${i + 1}. **Q:** ${side(s(c.front_text), s(c.front_file_id), "front")}`);
      lines.push(`   **A:** ${side(s(c.back_text), s(c.back_file_id), "back")}`);
    });
    return { markdown: lines.join("\n"), files };
  },

  timeline: (b) => {
    const items = list(b.payload.items);
    const sorted = s(b.payload.sort) === "desc" ? [...items].reverse() : items;
    const lines = ["**Timeline:**", ""];
    for (const it of sorted) {
      const when = [s(it.date), s(it.time)].filter(Boolean).join(" ");
      const desc = s(it.description);
      lines.push(`- ${when ? `**${when}** ` : ""}${s(it.title)}${desc ? ` — ${htmlToMarkdown(desc).replace(/\n+/g, " ")}` : ""}`);
    }
    return { markdown: lines.join("\n"), files: [] };
  },

  test: (_b, ctx) => ({
    markdown: quote(
      `**Exercise sheet** (Vips) — solve it in Stud.IP: ${coursewareElementUrl(ctx.origin, ctx.courseId, ctx.unitId, ctx.elementId)}`,
    ),
    files: [],
  }),

  lti: (b) => ({ markdown: quote(`**External tool (LTI):** ${s(b.payload.title) || b.title || "tool"} — open in Stud.IP`), files: [] }),

  // Discussions belong to people; point at them, never copy them.
  blubber: () => ({ markdown: quote("**Discussion** (Blubber) — read it in Stud.IP"), files: [] }),

  error: () => ({ markdown: "", files: [] }),
};

/** Block types the renderer understands (anything else falls back). */
export const KNOWN_BLOCK_TYPES = Object.keys(RENDERERS);

export function renderBlock(block: CwBlock, ctx: BlockRenderContext): RenderedBlock {
  const fn = RENDERERS[block.type];
  if (fn) {
    try {
      return fn(block, ctx);
    } catch {
      // malformed payload — fall through to the placeholder
    }
  }
  const label = s(block.payload.title) || block.title;
  return { markdown: `> [block ${block.type}]${label ? ` ${label}` : ""}`, files: [] };
}

/** Blocks of a container in display order: sections first (accordion/tabs), then the rest. */
export function containerLayout(container: CwContainer, blocks: Record<string, CwBlock>): Array<{ name: string; blocks: CwBlock[] }> {
  const own = container.blockIds.map((id) => blocks[id]).filter((b): b is CwBlock => !!b);
  const byId = new Map(own.map((b) => [b.id, b]));
  // Blocks that only appear via the included set (container rel not loaded).
  for (const b of Object.values(blocks)) if (b.containerId === container.id && !byId.has(b.id)) byId.set(b.id, b);
  const used = new Set<string>();
  const groups: Array<{ name: string; blocks: CwBlock[] }> = [];
  for (const sec of container.sections) {
    const bs = sec.blockIds.map((id) => byId.get(id)).filter((b): b is CwBlock => !!b);
    bs.forEach((b) => used.add(b.id));
    if (bs.length) groups.push({ name: sec.name, blocks: bs });
  }
  const rest = [...byId.values()].filter((b) => !used.has(b.id)).sort((a, b) => a.position - b.position);
  if (rest.length) groups.push({ name: "", blocks: rest });
  return groups;
}

export function renderContainer(container: CwContainer, blocks: Record<string, CwBlock>, ctx: BlockRenderContext): RenderedBlock {
  if (!container.visible) return { markdown: "", files: [] };
  const named = container.type === "accordion" || container.type === "tabs";
  const parts: string[] = [];
  const files: string[] = [];
  for (const group of containerLayout(container, blocks)) {
    if (named && group.name) parts.push(h(ctx.headingLevel + 1, group.name));
    for (const block of group.blocks) {
      if (!block.visible) continue;
      const r = renderBlock(block, { ...ctx, headingLevel: named && group.name ? ctx.headingLevel + 1 : ctx.headingLevel });
      if (r.markdown) parts.push(r.markdown);
      files.push(...r.files);
    }
  }
  return { markdown: parts.join("\n\n"), files };
}

// ---------------------------------------------------------------------------
// Whole unit → one markdown file per page
// ---------------------------------------------------------------------------

export interface RenderedElement {
  element: CwElementNode;
  /** Path relative to the unit folder, e.g. "03-sql-basics.md". */
  path: string;
  markdown: string;
  /** Hash of the content — the writer skips files whose hash is unchanged. */
  hash: string;
  files: string[];
}

export interface RenderedUnit {
  unit: CoursewareUnitContent["unit"];
  /** Folder name for the unit, e.g. "woche-1-einfuehrung". */
  slug: string;
  elements: RenderedElement[];
  /** File id → path relative to the unit folder. */
  fileNames: Record<string, string>;
  /** Files that should be downloaded (id → metadata). */
  downloads: CwFile[];
}

/** Unique, readable local names for every file of a unit (files/<name>). */
export function assignFileNames(files: Record<string, CwFile>): Record<string, string> {
  const out: Record<string, string> = {};
  const taken = new Set<string>();
  for (const f of Object.values(files).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))) {
    let name = safeFileName(f.name);
    if (taken.has(name.toLowerCase())) {
      const dot = name.lastIndexOf(".");
      const tag = f.id.slice(0, 6);
      name = dot > 0 ? `${name.slice(0, dot)}-${tag}${name.slice(dot)}` : `${name}-${tag}`;
    }
    taken.add(name.toLowerCase());
    out[f.id] = `files/${name}`;
  }
  return out;
}

export function elementFileName(el: CwElementNode, total: number): string {
  const width = Math.max(2, String(total).length);
  return `${String(el.order).padStart(width, "0")}-${contentSlug(el.title)}.md`;
}

export interface RenderUnitOptions {
  origin: string;
}

export function renderUnit(content: CoursewareUnitContent, options: RenderUnitOptions): RenderedUnit {
  const { unit, elements } = content;
  const courseId = content.courseId;
  const elementPaths: Record<string, string> = {};
  const elementTitles: Record<string, string> = {};
  const children: Record<string, string[]> = {};
  for (const el of elements) {
    elementPaths[el.id] = elementFileName(el, elements.length - 1);
    elementTitles[el.id] = el.title;
    children[el.id] = el.childIds;
  }
  const fileNames = assignFileNames(content.files);
  const wanted = new Set<string>();

  const rendered = elements.map((el): RenderedElement => {
    const level = Math.min(el.depth + 1, 6);
    const ctx: BlockRenderContext = {
      origin: options.origin,
      courseId,
      unitId: unit.id,
      headingLevel: level,
      elementPaths,
      elementTitles,
      children,
      files: content.files,
      fileNames,
      elementId: el.id,
    };
    const body: string[] = [h(level, el.number ? `${el.number} ${el.title}` : el.title)];
    if (el.description) body.push(`_${el.description}_`);
    if (!el.canVisit) body.push("> Locked in Stud.IP — finish the previous pages first.");
    const error = content.errors.find((e) => e.elementId === el.id);
    if (error) body.push(`> Content not available: ${error.message}`);
    const files: string[] = [];
    for (const c of content.containers[el.id] ?? []) {
      const r = renderContainer(c, content.blocks, ctx);
      if (r.markdown) body.push(r.markdown);
      files.push(...r.files);
    }
    if (el.childIds.length && !(content.containers[el.id] ?? []).some((c) => c.blockIds.some((id) => content.blocks[id]?.type === "table-of-contents"))) {
      body.push(["**Subpages:**", "", ...el.childIds.map((id) => `- [${elementTitles[id]}](./${encodeURI(elementPaths[id]!)})`)].join("\n"));
    }
    const uniqueFiles = [...new Set(files)];
    uniqueFiles.forEach((f) => wanted.add(f));
    const text = body.join("\n\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
    const hash = shortHash(text + JSON.stringify(uniqueFiles));
    const head = frontmatter({
      source: "studip-courseware",
      course: courseId,
      unit: unit.id,
      element: el.id,
      parent: el.parentId,
      title: el.title,
      outline: el.number || undefined,
      depth: el.depth,
      position: el.position,
      purpose: el.purpose !== "content" ? el.purpose : undefined,
      requiredTime: el.requiredTime ?? undefined,
      chdate: el.chdate,
      url: coursewareElementUrl(options.origin, courseId, unit.id, el.id),
      files: uniqueFiles.length ? uniqueFiles.map((id) => fileNames[id]) : undefined,
      hash,
    });
    return { element: el, path: elementPaths[el.id]!, markdown: `${head}\n${text}`, hash, files: uniqueFiles };
  });

  return {
    unit,
    slug: contentSlug(unit.title),
    elements: rendered,
    fileNames,
    downloads: [...wanted].map((id) => content.files[id]!).filter((f) => f && f.downloadable),
  };
}

/** Outline lines for README/CLI: "  2.1 Title". */
export function outlineLines(elements: CwElementNode[], link?: (el: CwElementNode) => string): string[] {
  return elements.map((el) => {
    const label = el.number ? `${el.number} ${el.title}` : el.title;
    return `${"  ".repeat(el.depth)}- ${link ? link(el) : label}`;
  });
}
