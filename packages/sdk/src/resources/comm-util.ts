import { readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import type { JsonApiQuery, StudIpClient } from "../client.js";
import { ensureDir, slugify } from "../config.js";
import { ImstudiumError } from "../errors.js";
import { attr, type Included } from "../jsonapi.js";
import type { JsonApiResource } from "../types.js";

/** Someone who wrote, sent or did something. `id` is null for Stud.IP itself or anonymous posts. */
export interface Person {
  id: string | null;
  name: string;
  username?: string;
}

export const UNKNOWN_PERSON = "(unknown)";

/** Normalise a Stud.IP date (ISO string with offset, or epoch seconds) to ISO 8601. */
export function toIso(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value < 1e12 ? value * 1000 : value).toISOString();
  }
  if (typeof value === "string") {
    if (/^\d+$/.test(value)) return toIso(Number(value));
    // Keep the instance's own offset (+01:00/+02:00): the date part then matches what students saw.
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) && Number.isFinite(Date.parse(value))) return value;
    const t = Date.parse(value);
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
  }
  return null;
}

export function toMs(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

/** YYYY-MM-DD in the instance's local time (the date part of the ISO string). */
export function isoDay(iso: string | null | undefined): string {
  if (!iso) return "0000-00-00";
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(iso);
  return m ? m[1]! : new Date(toMs(iso)).toISOString().slice(0, 10);
}

/** "2026-10-12 14:03" from an ISO string with offset — no timezone conversion. */
export function isoMinute(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
  return m ? `${m[1]} ${m[2]}` : iso;
}

/** ISO 8601 with "+00:00" and no milliseconds — the DATE_ATOM form Stud.IP filters accept. */
export function toAtom(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

/** Name of a related user-ish resource (users, forum-members, …) if it was included. */
export function personName(resource: JsonApiResource | undefined): string | undefined {
  if (!resource) return undefined;
  const formatted = attr<string>(resource, "formatted-name") ?? attr<string>(resource, "name");
  if (formatted && formatted.trim()) return formatted.trim();
  const given = attr<string>(resource, "given-name") ?? "";
  const family = attr<string>(resource, "family-name") ?? "";
  const joined = `${given} ${family}`.trim();
  if (joined) return joined;
  return attr<string>(resource, "username") || undefined;
}

/** Resolve a to-one person relationship (author, sender, actor, user) through `included`. */
export function personFrom(
  included: Included,
  resource: JsonApiResource,
  relationship: string,
): Person | null {
  const data = resource.relationships?.[relationship]?.data;
  if (!data || Array.isArray(data)) return null;
  return personRef(included, data.type, data.id);
}

export function personRef(included: Included, type: string, id: string | null | undefined): Person {
  const inc = id ? included.get(type, id) : undefined;
  const username = attr<string>(inc, "username") || undefined;
  return {
    id: id || null,
    name: personName(inc) ?? UNKNOWN_PERSON,
    ...(username ? { username } : {}),
  };
}

export function displayName(person: Person | null | undefined, fallback = UNKNOWN_PERSON): string {
  return person?.name || fallback;
}

/** First non-empty lines of a text, collapsed to at most `max` characters. */
export function excerpt(text: string, max = 160, lines = 2): string {
  const parts = text
    .split("\n")
    .map((l) => l.replace(/^[#>\-*\s]+/, "").trim())
    .filter(Boolean)
    .slice(0, lines);
  const joined = parts.join(" · ");
  return joined.length > max ? `${joined.slice(0, max - 1).trimEnd()}…` : joined;
}

export interface FetchedPages {
  data: JsonApiResource[];
  included: JsonApiResource[];
  total?: number;
}

/**
 * Page through a Stud.IP list route by offset. Unlike `client.paginate` this does
 * not depend on `links.next` — some 6.1 routes (blubber comments) report no total
 * and therefore no next link.
 */
export async function fetchPages(
  client: Pick<StudIpClient, "get">,
  path: string,
  query: JsonApiQuery = {},
  options: { max?: number; pageSize?: number; maxPages?: number } = {},
): Promise<FetchedPages> {
  const pageSize = Math.max(1, Math.min(options.pageSize ?? 100, 100));
  const max = options.max && options.max > 0 ? options.max : Infinity;
  const maxPages = options.maxPages ?? 50;
  const data: JsonApiResource[] = [];
  const included: JsonApiResource[] = [];
  const seen = new Set<string>();
  let total: number | undefined;

  for (let page = 0, offset = 0; page < maxPages; page++) {
    const limit = Math.min(pageSize, max - data.length);
    if (limit <= 0) break;
    const doc = await client.get(path, { ...query, page: { limit, offset } });
    const batch = Array.isArray(doc.data) ? doc.data : doc.data ? [doc.data] : [];
    data.push(...batch);
    for (const inc of doc.included ?? []) {
      const key = `${inc.type}:${inc.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        included.push(inc);
      }
    }
    const t = doc.meta?.page?.total;
    if (typeof t === "number") total = t;
    offset += batch.length;
    if (batch.length < limit) break;
    if (total !== undefined && offset >= total) break;
  }
  return { data: data.slice(0, Number.isFinite(max) ? max : undefined), included, total };
}

/** True for "not there / not allowed" — a course without forum or blubber answers like this. */
export function isUnavailable(err: unknown): boolean {
  return err instanceof ImstudiumError && (err.status === 403 || err.status === 404);
}

// ── Markdown workspace helpers ────────────────────────────────────────────────

export type FrontmatterValue = string | number | boolean | null | undefined;

function yamlScalar(value: Exclude<FrontmatterValue, undefined>): string {
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return /^[A-Za-z0-9_.\-+/@][A-Za-z0-9_.\-+/@ :]*$/.test(value) && !/: |\s$/.test(value)
    ? value
    : JSON.stringify(value);
}

export function frontmatter(fields: Record<string, FrontmatterValue>): string {
  const lines = Object.entries(fields)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${yamlScalar(v as Exclude<FrontmatterValue, undefined>)}`);
  return `---\n${lines.join("\n")}\n---\n`;
}

/** Parse the simple `key: value` frontmatter written by `frontmatter()`. */
export function parseFrontmatter(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!text.startsWith("---\n")) return out;
  const end = text.indexOf("\n---", 4);
  if (end < 0) return out;
  for (const line of text.slice(4, end).split("\n")) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (value.startsWith('"')) {
      try {
        value = JSON.parse(value) as string;
      } catch {
        // keep raw
      }
    }
    out[key] = value;
  }
  return out;
}

/** Write only when the content differs — keeps mtimes (and file watchers) quiet on re-sync. */
export async function writeIfChanged(path: string, content: string): Promise<boolean> {
  try {
    if ((await readFile(path, "utf-8")) === content) return false;
  } catch {
    // new file
  }
  await ensureDir(dirname(path));
  await writeFile(path, content);
  return true;
}

export interface MarkdownEntry {
  path: string;
  /** Path relative to the scanned root, with forward slashes. */
  rel: string;
  fm: Record<string, string>;
}

/** Every *.md (except README.md) under `root` that carries an `id` in its frontmatter. */
export async function scanMarkdown(root: string, depth = 1): Promise<Map<string, MarkdownEntry>> {
  const out = new Map<string, MarkdownEntry>();
  const walk = async (dir: string, level: number) => {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (level < depth) await walk(p, level + 1);
        continue;
      }
      if (!e.name.endsWith(".md") || e.name === "README.md") continue;
      try {
        const fm = parseFrontmatter(await readFile(p, "utf-8"));
        if (fm.id) out.set(fm.id, { path: p, rel: relative(root, p).split("\\").join("/"), fm });
      } catch {
        // unreadable file — ignore
      }
    }
  };
  await walk(root, 1);
  return out;
}

/** Move a previously written file to its new name (title changed) instead of duplicating it. */
export async function moveIfRenamed(from: string | undefined, to: string): Promise<void> {
  if (!from || from === to) return;
  try {
    await ensureDir(dirname(to));
    await rename(from, to);
  } catch {
    await unlink(from).catch(() => undefined);
  }
}

/** Filesystem-safe slug for titles; never empty. */
export function titleSlug(title: string, fallback: string, max = 60): string {
  if (!/[a-zA-Z0-9]/.test(title.normalize("NFKD"))) return fallback;
  return slugify(title).toLowerCase().slice(0, max).replace(/-+$/g, "") || fallback;
}

/** Markdown link target with spaces/parentheses escaped. */
export function mdLink(path: string): string {
  return path.replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29");
}

/** Escape characters that would break a markdown link label. */
export function mdLabel(text: string): string {
  return text.replace(/([[\]])/g, "\\$1").replace(/\s+/g, " ").trim();
}
