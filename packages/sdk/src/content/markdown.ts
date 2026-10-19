/**
 * Pure markdown helpers shared by the courseware and wiki writers:
 * Stud.IP HTML → markdown, frontmatter, slugs, stable hashes.
 */
import { createHash } from "node:crypto";
import { htmlToText } from "../jsonapi.js";

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

/** Text of an HTML fragment with whitespace kept (for code). */
function rawText(html: string): string {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, ""));
}

function absolutize(url: string, origin?: string): string {
  if (!origin || /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("#")) return url;
  const base = origin.replace(/\/+$/, "");
  return url.startsWith("/") ? `${base}${url}` : `${base}/${url}`;
}

function cellText(html: string, origin?: string): string {
  return htmlToMarkdown(html, origin).replace(/\s*\n+\s*/g, " ").replace(/\|/g, "\\|").trim();
}

function tableToMarkdown(table: string, origin?: string): string {
  const rows = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) =>
    [...m[1]!.matchAll(/<t([hd])[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) => cellText(c[2]!, origin)),
  );
  const width = Math.max(0, ...rows.map((r) => r.length));
  if (!width) return "";
  const pad = (r: string[]) => [...r, ...Array(width - r.length).fill("")];
  const [head, ...body] = rows.map(pad);
  return [
    `| ${head!.join(" | ")} |`,
    `| ${Array(width).fill("---").join(" | ")} |`,
    ...body.map((r) => `| ${r.join(" | ")} |`),
  ].join("\n");
}

/**
 * Stud.IP HTML (courseware text, wiki, news) → readable markdown.
 * Builds on htmlToText and adds tables, code blocks, images, absolute links
 * and TeX ($…$) so agents can read the material verbatim.
 */
export function htmlToMarkdown(html: unknown, origin?: string): string {
  if (typeof html !== "string" || !html.trim()) return "";
  const keep: string[] = [];
  const stash = (md: string) => `\n\u0000${keep.push(md) - 1}\u0000\n`;

  let s = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, inner: string) => {
      const lang = /class="[^"]*language-([\w+-]+)/i.exec(inner)?.[1] ?? "";
      return stash("```" + lang + "\n" + rawText(inner).replace(/\n+$/, "") + "\n```");
    })
    .replace(/<table[\s\S]*?<\/table>/gi, (t) => stash(tableToMarkdown(t, origin)))
    .replace(/<img\b[^>]*>/gi, (tag) => {
      const src = /\ssrc="([^"]*)"/i.exec(tag)?.[1];
      const alt = /\salt="([^"]*)"/i.exec(tag)?.[1] ?? "";
      if (!src) return alt ? `[image: ${alt}]` : "";
      return `\u0001${keep.push(`![${decodeEntities(alt)}](${absolutize(decodeEntities(src), origin)})`) - 1}\u0001`;
    })
    .replace(/(<a\s[^>]*href=")([^"]+)(")/gi, (_, a: string, href: string, b: string) => `${a}${absolutize(href, origin)}${b}`)
    .replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, inner: string) => {
      let n = 0;
      return inner.replace(/<\/li>/gi, "").replace(/<li[^>]*>/gi, () => `\n${++n}. `);
    });

  s = htmlToText(s)
    // TeX from the WYSIWYG math plugin
    .replace(/\\\((.+?)\\\)/g, (_, tex: string) => `$${tex.trim()}$`)
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, tex: string) => `$$${tex.trim()}$$`);

  s = s
    .replace(/\u0000(\d+)\u0000/g, (_, i: string) => keep[Number(i)] ?? "")
    .replace(/\u0001(\d+)\u0001/g, (_, i: string) => keep[Number(i)] ?? "");
  return s.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Legacy Stud.IP wiki markup (pre-WYSIWYG pages) → markdown.
 * `!!!!Title`, `**bold**`, `%%italic%%`, `[[Page]]`, `[text]url`, `-`/`=` lists.
 */
export function studipMarkupToMarkdown(text: string, linkPage?: (name: string) => string | null): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => {
      const h = /^(!{1,4})\s*(.*)$/.exec(line);
      if (h) return `${"#".repeat(Math.max(1, 5 - h[1]!.length))} ${h[2]}`;
      const ol = /^(=+)\s*(.*)$/.exec(line);
      if (ol) return `${"  ".repeat(ol[1]!.length - 1)}1. ${ol[2]}`;
      const ul = /^(-+)\s+(.*)$/.exec(line);
      if (ul) return `${"  ".repeat(ul[1]!.length - 1)}- ${ul[2]}`;
      return line;
    })
    .join("\n")
    .replace(/%%(.+?)%%/g, "_$1_")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, page: string, label?: string) => {
      const target = linkPage?.(page.trim());
      const text = (label ?? page).trim();
      return target ? `[${text}](${target})` : `**${text}**`;
    })
    .replace(/\[([^\]]+)\](https?:\/\/\S+)/g, "[$1]($2)")
    .trim();
}

/** Slug for file names: ASCII, lowercase, dashes, never empty. */
export function contentSlug(text: string, max = 60): string {
  const s = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/, "");
  return s || "page";
}

/** File name safe on macOS/Windows/Linux, keeps the extension readable. */
export function safeFileName(name: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/^\.+/, "_")
    .trim();
  return cleaned.slice(0, 180) || "file";
}

export function shortHash(text: string, len = 12): string {
  return createHash("sha1").update(text).digest("hex").slice(0, len);
}

function yamlValue(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return `[${v.map(yamlValue).join(", ")}]`;
  const s = String(v);
  return /^[\w./:@+-]+$/.test(s) && !/^(true|false|null|yes|no|~|\d.*)$/i.test(s) ? s : JSON.stringify(s);
}

/** Flat YAML frontmatter (strings, numbers, booleans, string arrays). */
export function frontmatter(fields: Record<string, unknown>): string {
  const lines = Object.entries(fields)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${yamlValue(v)}`);
  return `---\n${lines.join("\n")}\n---\n`;
}

/** Read the flat frontmatter written by `frontmatter()` (enough to compare hashes). */
export function parseFrontmatter(text: string): Record<string, string> {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const line of m[1]!.split("\n")) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    let v = line.slice(i + 1).trim();
    if (v.startsWith('"')) {
      try {
        v = JSON.parse(v) as string;
      } catch {
        // keep raw
      }
    }
    out[line.slice(0, i).trim()] = v;
  }
  return out;
}

export function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

/** "2026-10-24 23:59" in local time; "" for null. */
export function formatLocalDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function formatLocalDate(iso: string | null | undefined): string {
  return formatLocalDateTime(iso).slice(0, 10);
}
