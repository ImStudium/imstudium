import type { JsonApiIdentifier, JsonApiResource } from "./types.js";

/** A JSON:API resource with attributes lifted to the top and relationships as ids. */
export interface Flat {
  id: string;
  type: string;
  /** Relationship name → related id (to-one) or ids (to-many); null when empty. */
  rel: Record<string, string | string[] | null>;
  [attribute: string]: unknown;
}

const RESERVED = new Set(["id", "type", "rel"]);

function camel(key: string): string {
  return key.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/**
 * Flatten one resource: kebab-case attributes become camelCase fields,
 * relationships become `rel.<name>` ids. Agents read this far more easily
 * than raw JSON:API envelopes.
 */
export function flatten(resource: JsonApiResource): Flat {
  const out: Flat = { id: resource.id, type: resource.type, rel: {} };
  for (const [key, value] of Object.entries(resource.attributes ?? {})) {
    const name = camel(key);
    out[RESERVED.has(name) ? `attr_${name}` : name] = value;
  }
  for (const [key, rel] of Object.entries(resource.relationships ?? {})) {
    const data = rel?.data;
    out.rel[camel(key)] = Array.isArray(data)
      ? data.map((d) => d.id)
      : data
        ? (data as JsonApiIdentifier).id
        : null;
  }
  return out;
}

export function flattenAll(resources: JsonApiResource[]): Flat[] {
  return resources.map(flatten);
}

/** Index included resources by `type:id` for relationship lookups. */
export class Included {
  private readonly map = new Map<string, JsonApiResource>();

  constructor(resources: JsonApiResource[] = []) {
    for (const r of resources) this.map.set(`${r.type}:${r.id}`, r);
  }

  get(type: string, id: string | null | undefined): JsonApiResource | undefined {
    return id ? this.map.get(`${type}:${id}`) : undefined;
  }

  /** Follow a to-one relationship of `resource` into the included set. */
  one(resource: JsonApiResource, relationship: string): JsonApiResource | undefined {
    const data = resource.relationships?.[relationship]?.data;
    if (!data || Array.isArray(data)) return undefined;
    return this.get(data.type, data.id);
  }

  /** Follow a to-many relationship of `resource` into the included set. */
  many(resource: JsonApiResource, relationship: string): JsonApiResource[] {
    const data = resource.relationships?.[relationship]?.data;
    if (!Array.isArray(data)) return [];
    return data.map((d) => this.get(d.type, d.id)).filter((r): r is JsonApiResource => !!r);
  }
}

/** Related id of a to-one relationship, without needing `included`. */
export function relId(resource: JsonApiResource, relationship: string): string | null {
  const data = resource.relationships?.[relationship]?.data;
  if (!data || Array.isArray(data)) return null;
  return data.id;
}

/** Related ids of a to-many relationship. */
export function relIds(resource: JsonApiResource, relationship: string): string[] {
  const data = resource.relationships?.[relationship]?.data;
  return Array.isArray(data) ? data.map((d) => d.id) : [];
}

export function attr<T = string>(resource: JsonApiResource | undefined, key: string): T | undefined {
  return resource?.attributes?.[key] as T | undefined;
}

/** Stud.IP sends HTML in news, forum, wiki and courseware text. Make it readable markdown-ish text. */
export function htmlToText(html: unknown): string {
  if (typeof html !== "string" || !html) return "";
  let s = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote|pre)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<h([1-6])[^>]*>/gi, (_, n: string) => `${"#".repeat(Math.min(Number(n) + 1, 6))} `)
    .replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**")
    .replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, "_$2_")
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`")
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, text: string) =>
      text.trim() && text.trim() !== href ? `[${text.trim()}](${href})` : href,
    )
    .replace(/<img [^>]*alt="([^"]*)"[^>]*>/gi, (_, alt: string) => (alt ? `[Bild: ${alt}]` : "[Bild]"))
    .replace(/<[^>]+>/g, "");
  s = s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)));
  return s
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
