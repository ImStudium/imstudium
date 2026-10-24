import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { searchWorkspace, type SearchHit } from "../search.js";
import { findDois, findIsbns } from "./identifiers.js";

/**
 * The semester as a research source. A course's own material often names
 * its literature (reading lists, the last slide, a script's references), and
 * the Lehrstuhl's Leitfaden with its Formvorgaben usually sits in the same
 * Stud.IP files. Both are already on the student's machine, extracted.
 */

export interface CourseReference {
  kind: "doi" | "isbn";
  id: string;
  /** Workspace-relative path of the original file. */
  file: string;
  page: number | null;
  /** The line the identifier stands in, trimmed. */
  context: string;
}

/** DOIs and ISBNs in a course's extracted material, with file and page. */
export async function courseReferences(workspace: string, coursePath: string): Promise<CourseReference[]> {
  const dir = join(workspace, coursePath, "extracted");
  if (!existsSync(dir)) return [];
  const out: CourseReference[] = [];
  const seen = new Set<string>();
  for (const slug of (await readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
    const contentPath = join(dir, slug, "content.md");
    if (!existsSync(contentPath)) continue;
    let source = join(coursePath, "files", slug);
    try {
      const manifest = JSON.parse(await readFile(join(dir, slug, "manifest.json"), "utf-8")) as { source?: string };
      if (manifest.source) source = manifest.source.startsWith(workspace) ? relative(workspace, manifest.source) : manifest.source;
    } catch {
      // no manifest: keep the slug
    }
    const text = await readFile(contentPath, "utf-8");
    let page: number | null = null;
    for (const line of text.split("\n")) {
      const h = /^##\s+(?:Page|Slide|Seite|Folie)\s+(\d+)/i.exec(line);
      if (h) {
        page = Number(h[1]);
        continue;
      }
      const ids = [...findDois(line).map((id) => ({ kind: "doi" as const, id })), ...findIsbns(line).map((id) => ({ kind: "isbn" as const, id }))];
      for (const { kind, id } of ids) {
        if (seen.has(`${kind}:${id}`)) continue;
        seen.add(`${kind}:${id}`);
        out.push({ kind, id, file: source, page, context: line.trim().slice(0, 240) });
      }
    }
  }
  return out;
}

export interface LeitfadenHit {
  path: string;
  citation: string;
  page: number | null;
  /** How many of the probe queries found this file. */
  matches: number;
  snippet: string;
  course: string | null;
}

const PROBES = [
  "Leitfaden wissenschaftliches Arbeiten",
  "Formvorgaben Hausarbeit Seitenrand Zeilenabstand",
  "Zitierweise Literaturverzeichnis Fußnoten",
  "Hinweise zur Anfertigung schriftlicher Arbeiten",
  "Eigenständigkeitserklärung Hilfsmittel",
  "Deckblatt Matrikelnummer Abgabe",
];

/**
 * Files in the workspace that look like a Leitfaden or Formvorgaben: every
 * probe query runs through the offline search, and files found by several
 * probes rank first.
 */
export async function findLeitfaden(workspace: string, opts: { course?: string; limit?: number; includeArchive?: boolean } = {}): Promise<LeitfadenHit[]> {
  const byPath = new Map<string, LeitfadenHit & { score: number }>();
  for (const q of PROBES) {
    let hits: SearchHit[] = [];
    try {
      hits = await searchWorkspace(workspace, q, { limit: 15, course: opts.course, kinds: ["material", "courseware", "wiki"], includeArchive: opts.includeArchive ?? true });
    } catch {
      continue;
    }
    for (const h of hits) {
      const prev = byPath.get(h.path);
      if (prev) {
        prev.matches++;
        prev.score += h.score;
      } else {
        byPath.set(h.path, { path: h.path, citation: h.citation, page: h.page ?? null, matches: 1, snippet: h.snippet, course: h.course ?? null, score: h.score });
      }
    }
  }
  const nameBonus = (p: string) => (/leitfaden|richtlinie|formal|hinweise|guide|zitier|wissenschaftlich/i.test(basename(p)) ? 2 : 0);
  return [...byPath.values()]
    .sort((a, b) => b.matches + nameBonus(b.path) - (a.matches + nameBonus(a.path)) || b.score - a.score)
    .slice(0, opts.limit ?? 8)
    .map(({ score: _s, ...h }) => h);
}
