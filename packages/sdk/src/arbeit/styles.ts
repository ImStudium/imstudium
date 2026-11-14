import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";
import { cslAssetsDir } from "../csl-assets.js";
import { ImstudiumError } from "../errors.js";
import type { FetchLike, MetadataOptions } from "./resolve.js";

/**
 * Citation styles. A curated set of CSL styles ships with ImStudium (the
 * ones German faculties ask for most); any of the ~10,000 styles in the CSL
 * repository, including many Lehrstuhl and institute styles, can be added to
 * an Arbeit, which keeps its own copy in `stil/` so it formats the same
 * offline and in five years.
 */

export interface StyleInfo {
  id: string;
  title: string;
  class: "in-text" | "note";
  locale: string | null;
  /** Where the CSL text comes from. */
  source: "bundled" | "arbeit" | "file";
  path: string;
  /** For a dependent style: the id of the independent style that formats it. */
  parent?: string | null;
}

/** What each bundled style is for, in German, for `imstudium stile`. */
export const BUNDLED_STYLE_NOTES: Record<string, string> = {
  apa: "APA 7: Psychologie, Bildung, Sozial- und Wirtschaftswissenschaften (Autor-Jahr)",
  "deutsche-gesellschaft-fur-psychologie": "DGPs 5: die deutsche APA-Fassung der Psychologie (Autor-Jahr)",
  "harvard-cite-them-right": "Harvard (Cite Them Right): Wirtschaft, viele englischsprachige Studiengänge (Autor-Jahr)",
  "chicago-author-date-de": "Chicago, Autor-Jahr, deutsch: Geschichte, Sozialwissenschaften",
  "chicago-notes-bibliography": "Chicago 18, Fußnoten: Geisteswissenschaften, deutsche Zitierweise mit Fußnoten",
  "iso690-author-date-de": "ISO 690, Autor-Jahr, deutsch: die Norm, die DIN 1505-2 ersetzt",
  "din-1505-2": "DIN 1505-2, Autor-Jahr: in Ingenieur- und Wirtschaftsfächern noch verbreitet",
  "din-1505-2-numeric": "DIN 1505-2, numerisch",
  ieee: "IEEE: Informatik, Elektrotechnik, Ingenieurwissenschaften (numerisch [1])",
  "modern-language-association": "MLA 9: Anglistik, Amerikanistik, Literaturwissenschaft",
  "juristische-zitierweise": "Juristische Zitierweise (Stüber): Rechtswissenschaft, Fußnoten",
  "elsevier-vancouver": "Vancouver: Medizin, Gesundheitswissenschaften (numerisch)",
};

const REPO_RAW = "https://raw.githubusercontent.com/citation-style-language/styles/master";

/** Read a CSL file's title, class, default locale and parent link. */
export function describeCsl(xml: string, id: string, source: StyleInfo["source"], path: string): StyleInfo {
  const info = /<info>([\s\S]*?)<\/info>/.exec(xml)?.[1] ?? "";
  const title = /<title>([\s\S]*?)<\/title>/.exec(info)?.[1]?.replace(/&amp;/g, "&").trim() ?? id;
  const cls = /<style\b[^>]*\bclass="(in-text|note)"/.exec(xml)?.[1] as StyleInfo["class"] | undefined;
  const locale = /<style\b[^>]*\bdefault-locale="([^"]+)"/.exec(xml)?.[1] ?? null;
  const parentHref = /<link\b[^>]*rel="independent-parent"[^>]*>/.exec(info)?.[0];
  const parent = parentHref ? (/href="[^"]*\/([^"/]+)"/.exec(parentHref)?.[1] ?? null) : null;
  return { id, title, class: cls ?? "in-text", locale, source, path, ...(parent ? { parent } : {}) };
}

export async function bundledStyles(): Promise<StyleInfo[]> {
  const dir = join(cslAssetsDir(), "styles");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".csl")).sort();
  return Promise.all(files.map(async (f) => describeCsl(await readFile(join(dir, f), "utf-8"), f.replace(/\.csl$/, ""), "bundled", join(dir, f))));
}

/** Styles vendored into an Arbeit's `stil/` folder. */
export async function arbeitStyles(arbeitDir: string): Promise<StyleInfo[]> {
  const dir = join(arbeitDir, "stil");
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((f) => f.endsWith(".csl")).sort();
  return Promise.all(files.map(async (f) => describeCsl(await readFile(join(dir, f), "utf-8"), f.replace(/\.csl$/, ""), "arbeit", join(dir, f))));
}

export interface LoadedStyle {
  info: StyleInfo;
  /** The CSL that actually formats: the style itself, or its independent parent. */
  xml: string;
}

/**
 * Find a style by id or path: a .csl file path, the Arbeit's `stil/`, then
 * the bundled set. Dependent styles are swapped for their parent (looked up
 * the same way), keeping the dependent's locale.
 */
export async function loadStyle(idOrPath: string, arbeitDir?: string | null): Promise<LoadedStyle> {
  const tryFile = async (path: string, source: StyleInfo["source"], id: string): Promise<LoadedStyle | null> => {
    if (!existsSync(path)) return null;
    const xml = await readFile(path, "utf-8");
    return { info: describeCsl(xml, id, source, path), xml };
  };
  let found: LoadedStyle | null = null;
  if (idOrPath.endsWith(".csl") || idOrPath.includes("/")) {
    const path = isAbsolute(idOrPath) ? idOrPath : resolve(arbeitDir ?? process.cwd(), idOrPath);
    found = await tryFile(path, arbeitDir && path.startsWith(join(arbeitDir, "stil")) ? "arbeit" : "file", basename(idOrPath, ".csl"));
  }
  if (!found && arbeitDir) found = await tryFile(join(arbeitDir, "stil", `${idOrPath}.csl`), "arbeit", idOrPath);
  if (!found) found = await tryFile(join(cslAssetsDir(), "styles", `${idOrPath}.csl`), "bundled", idOrPath);
  if (!found) {
    throw new ImstudiumError(`No citation style "${idOrPath}"`, "STYLE_NOT_FOUND", undefined, `imstudium stile lists what is here; imstudium stile add ${idOrPath} fetches it from the CSL repository`, { style: idOrPath });
  }
  if (found.info.parent) {
    const parent = await loadStyle(found.info.parent, arbeitDir).catch(() => null);
    if (!parent) {
      throw new ImstudiumError(`Style "${found.info.id}" depends on "${found.info.parent}", which is not here`, "STYLE_NOT_FOUND", undefined, `imstudium stile add ${found.info.parent}`, { style: found.info.parent });
    }
    const xml = found.info.locale && !/default-locale=/.test(parent.xml) ? parent.xml.replace(/<style\b/, `<style default-locale="${found.info.locale}"`) : parent.xml;
    return { info: { ...found.info, class: parent.info.class }, xml };
  }
  return found;
}

export interface FetchedStyle {
  id: string;
  xml: string;
  /** The independent parent, fetched too when the style is dependent. */
  parent?: { id: string; xml: string };
}

async function fetchText(url: string, opts: MetadataOptions): Promise<string | null> {
  const f: FetchLike = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
  let res;
  try {
    res = await f(url, { headers: { "User-Agent": opts.userAgent ?? "imstudium" } });
  } catch (e) {
    throw new ImstudiumError(`The CSL repository could not be reached: ${e instanceof Error ? e.message : String(e)}`, "METADATA_UNAVAILABLE", undefined, "Check the connection, or pass a .csl file you downloaded", { service: "raw.githubusercontent.com" });
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new ImstudiumError(`The CSL repository answered ${res.status}`, "METADATA_UNAVAILABLE", res.status);
  return res.text();
}

/**
 * Fetch a style from the CSL repository (independent styles at the top,
 * dependent ones under dependent/), or from a URL. Zotero style URLs
 * (zotero.org/styles/<id>) map to the same repository.
 */
export async function fetchStyle(idOrUrl: string, opts: MetadataOptions = {}): Promise<FetchedStyle> {
  const zotero = /zotero\.org\/styles\/([\w-]+)/.exec(idOrUrl)?.[1];
  let id = zotero ?? idOrUrl.replace(/\.csl$/, "");
  let xml: string | null = null;
  if (!zotero && /^https?:\/\//.test(idOrUrl)) {
    xml = await fetchText(idOrUrl, opts);
    id = basename(new URL(idOrUrl).pathname, ".csl");
  } else {
    if (!/^[a-z0-9-]+$/.test(id)) throw new ImstudiumError(`"${idOrUrl}" is not a CSL style id`, "BAD_ARGS", undefined, "Style ids look like apa or technische-universitat-dresden-linguistik (imstudium stile find <words>)");
    xml = (await fetchText(`${REPO_RAW}/${id}.csl`, opts)) ?? (await fetchText(`${REPO_RAW}/dependent/${id}.csl`, opts));
  }
  if (!xml || !/<style\b/.test(xml)) throw new ImstudiumError(`No CSL style "${id}" in the CSL repository`, "STYLE_NOT_FOUND", undefined, "imstudium stile find <words> searches the repository", { style: id });
  const info = describeCsl(xml, id, "file", "");
  if (info.parent) {
    const parentXml = await fetchText(`${REPO_RAW}/${info.parent}.csl`, opts);
    if (!parentXml) throw new ImstudiumError(`Style "${id}" depends on "${info.parent}", which the repository does not have`, "STYLE_NOT_FOUND");
    return { id, xml, parent: { id: info.parent, xml: parentXml } };
  }
  return { id, xml };
}

export interface StyleSearchHit {
  id: string;
  dependent: boolean;
}

/**
 * Search the CSL repository's file names (one GitHub tree listing,
 * ~10,000 names). Every word must appear; umlauts fold the way the
 * repository spells them (Universität → universitat).
 */
export async function searchStyles(words: string[], opts: MetadataOptions & { limit?: number; listing?: string[] } = {}): Promise<StyleSearchHit[]> {
  let names = opts.listing;
  if (!names) {
    const text = await fetchText("https://api.github.com/repos/citation-style-language/styles/git/trees/master?recursive=1", opts);
    if (!text) return [];
    const tree = (JSON.parse(text) as { tree?: Array<{ path: string }> }).tree ?? [];
    names = tree.map((t) => t.path).filter((p) => p.endsWith(".csl"));
  }
  const fold = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/ß/g, "ss")
      .replace(/[^a-z0-9]+/g, "-");
  const needles = words.map(fold).flatMap((w) => w.split("-")).filter(Boolean);
  const hits = names
    .map((p) => ({ id: basename(p, ".csl"), dependent: p.startsWith("dependent/") }))
    .filter((h) => needles.every((n) => h.id.includes(n)));
  hits.sort((a, b) => Number(a.dependent) - Number(b.dependent) || a.id.length - b.id.length || a.id.localeCompare(b.id));
  return hits.slice(0, opts.limit ?? 20);
}

/** The CSL locale XML for a language tag (de-DE, en-US, de-AT, de-CH), falling back to de-DE. */
export async function loadLocale(lang: string): Promise<string> {
  const dir = join(cslAssetsDir(), "locales");
  const tag = lang.includes("-") ? lang : ({ de: "de-DE", en: "en-US" } as Record<string, string>)[lang] ?? lang;
  for (const t of [tag, tag.startsWith("en") ? "en-US" : "de-DE"]) {
    const p = join(dir, `locales-${t}.xml`);
    if (existsSync(p)) return readFile(p, "utf-8");
  }
  return readFile(join(dir, "locales-en-US.xml"), "utf-8");
}
