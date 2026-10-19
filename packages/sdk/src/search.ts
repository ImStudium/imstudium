import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

/**
 * Local ranked search (BM25) over everything ImStudium writes: the page
 * corpus of extracted materials plus news, forum, courseware and wiki
 * markdown. No index files, no network — built in memory per query, which
 * is fast enough for a few thousand pages.
 */

export type SearchKind = "material" | "news" | "forum" | "courseware" | "wiki" | "note";

export interface SearchDoc {
  /** Stable reference, e.g. WS2026-27/Statistik#blatt1.pdf:3 */
  ref: string;
  citation: string;
  kind: SearchKind;
  course?: string;
  /** Workspace-relative file to open. */
  path: string;
  page?: number;
  text: string;
}

export interface SearchHit extends SearchDoc {
  score: number;
  snippet: string;
}

export interface SearchOptions {
  limit?: number;
  course?: string;
  kinds?: SearchKind[];
  /** Include archive/ (past semesters). */
  includeArchive?: boolean;
}

const STOP = new Set(
  (
    "der die das und oder ein eine einer eines einem einen ist sind war wird werden mit von zu zur zum im in an auf aus bei für fur " +
    "nicht auch als wie was wer wo sich es er sie wir ihr den dem des dass so the a an and or of to in on for is are was be with by " +
    "this that it as at from"
  ).split(" "),
);

/** Lowercase and fold umlauts/accents (ä→a, ß→ss) so Übung matches Ubung. */
export function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function tokenize(text: string): string[] {
  return fold(text)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

/** Very light stemming so Übungen ≈ Übung and matrices ≈ matrix-ish. */
function stem(term: string): string {
  if (term.length <= 4) return term;
  for (const suffix of ["ungen", "ung", "ern", "en", "er", "es", "ies", "s", "e"]) {
    if (term.endsWith(suffix) && term.length - suffix.length >= 4) return term.slice(0, -suffix.length);
  }
  return term;
}

async function walk(dir: string, match: (path: string) => boolean, out: string[] = [], depth = 0): Promise<string[]> {
  if (depth > 8) return out;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith(".") || e.name === "node_modules" || e.name === "files" || e.name === "pages") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, match, out, depth + 1);
    else if (match(p)) out.push(p);
  }
  return out;
}

function kindForMarkdown(rel: string): SearchKind | null {
  if (/\/news\//.test(rel)) return "news";
  if (/\/forum\//.test(rel)) return "forum";
  if (/\/courseware\//.test(rel)) return "courseware";
  if (/\/wiki\//.test(rel)) return "wiki";
  if (/\/notes?\//.test(rel)) return "note";
  return null;
}

/** Split markdown into ~1,500-char chunks at headings so hits point somewhere useful. */
export function chunkMarkdown(md: string, max = 1500): string[] {
  const body = md.replace(/^---\n[\s\S]*?\n---\n/, "");
  const sections = body.split(/\n(?=#{1,4} )/);
  const chunks: string[] = [];
  for (const section of sections) {
    if (section.length <= max) {
      if (section.trim()) chunks.push(section.trim());
      continue;
    }
    let buf = "";
    for (const para of section.split(/\n{2,}/)) {
      if (buf && buf.length + para.length > max) {
        chunks.push(buf.trim());
        buf = "";
      }
      buf += `${para}\n\n`;
    }
    if (buf.trim()) chunks.push(buf.trim());
  }
  return chunks;
}

/** Load every searchable document under the workspace. */
export async function loadSearchDocs(workspacePath: string, options: SearchOptions = {}): Promise<SearchDoc[]> {
  const docs: SearchDoc[] = [];
  const inScope = (rel: string) =>
    (options.includeArchive || !rel.startsWith("archive/")) &&
    (!options.course || rel.toLowerCase().includes(options.course.toLowerCase()));

  const corpora = await walk(workspacePath, (p) => p.endsWith("/search/corpus.jsonl"));
  for (const file of corpora) {
    const rel = relative(workspacePath, file);
    if (!inScope(rel)) continue;
    const raw = await readFile(file, "utf-8").catch(() => "");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const c = JSON.parse(line) as {
          ref: string;
          citation: string;
          coursePath?: string;
          courseTitle?: string;
          extractSlug?: string;
          page?: number;
          text?: string;
        };
        if (!c.text) continue;
        docs.push({
          ref: c.ref,
          citation: c.citation,
          kind: "material",
          course: c.courseTitle,
          path: c.coursePath && c.extractSlug ? `${c.coursePath}/extracted/${c.extractSlug}/content.md` : rel,
          page: c.page,
          text: c.text,
        });
      } catch {
        // skip a bad line
      }
    }
  }

  const markdown = await walk(workspacePath, (p) => p.endsWith(".md") && !p.endsWith("README.md"));
  for (const file of markdown) {
    const rel = relative(workspacePath, file);
    const kind = kindForMarkdown(`/${rel}`);
    if (!kind || !inScope(rel)) continue;
    const md = await readFile(file, "utf-8").catch(() => "");
    const courseFolder = rel.split("/").slice(0, rel.startsWith("archive/") ? 3 : 2).join("/");
    const course = courseFolder.split("/").pop()?.replace(/-/g, " ");
    const title = md.match(/^#\s+(.+)$/m)?.[1] ?? rel.split("/").pop()!;
    chunkMarkdown(md).forEach((text, i) => {
      docs.push({
        ref: `${rel}#${i + 1}`,
        citation: `${course ?? ""} · ${kind} · ${title}`.replace(/^ · /, ""),
        kind,
        course,
        path: rel,
        text,
      });
    });
  }

  return options.kinds?.length ? docs.filter((d) => options.kinds!.includes(d.kind)) : docs;
}

/** BM25 over the loaded docs; phrase matches and title-ish hits get a bonus. */
export function rankDocs(docs: SearchDoc[], query: string, limit = 10): SearchHit[] {
  const qTerms = [...new Set(tokenize(query).map(stem))];
  if (!qTerms.length) return [];
  const k1 = 1.4;
  const b = 0.75;
  const tokenized = docs.map((d) => tokenize(`${d.citation} ${d.text}`).map(stem));
  const avgLen = tokenized.reduce((n, t) => n + t.length, 0) / Math.max(1, tokenized.length);
  const df = new Map<string, number>();
  for (const terms of tokenized) {
    for (const t of new Set(terms)) if (qTerms.includes(t)) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const N = docs.length;
  const phrase = query.trim().toLowerCase();

  const hits: SearchHit[] = [];
  tokenized.forEach((terms, i) => {
    let score = 0;
    const tf = new Map<string, number>();
    for (const t of terms) if (qTerms.includes(t)) tf.set(t, (tf.get(t) ?? 0) + 1);
    if (!tf.size) return;
    for (const [t, f] of tf) {
      const n = df.get(t) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * terms.length) / avgLen)));
    }
    score *= 0.6 + 0.4 * (tf.size / qTerms.length); // reward covering every term
    const doc = docs[i]!;
    if (phrase.includes(" ") && doc.text.toLowerCase().includes(phrase)) score *= 1.5;
    hits.push({ ...doc, score, snippet: snippet(doc.text, qTerms) });
  });
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** ~220 chars around the densest cluster of query terms. */
export function snippet(text: string, qTerms: string[], width = 220): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const lower = fold(flat);
  let best = 0;
  let bestScore = -1;
  for (let i = 0; i < flat.length; i += 40) {
    const window = lower.slice(i, i + width);
    const s = qTerms.reduce((n, t) => n + (window.includes(t.slice(0, Math.max(4, t.length - 1))) ? 1 : 0), 0);
    if (s > bestScore) {
      bestScore = s;
      best = i;
    }
  }
  const start = Math.max(0, best - 20);
  const cut = flat.slice(start, start + width);
  return `${start > 0 ? "…" : ""}${cut}${start + width < flat.length ? "…" : ""}`;
}

export async function searchWorkspace(workspacePath: string, query: string, options: SearchOptions = {}): Promise<SearchHit[]> {
  const docs = await loadSearchDocs(workspacePath, options);
  return rankDocs(docs, query, options.limit ?? 10);
}
