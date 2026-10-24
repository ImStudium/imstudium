import { firstCreatorFamily, foldGerman, yearOf } from "./csl-util.js";
import type { CslItem } from "./types.js";

/**
 * Citekeys like Google Scholar's: family name, year, first significant
 * title word — `mueller2021digitale`. ASCII only, so they work unchanged in
 * BibLaTeX, Pandoc (`[@mueller2021digitale]`) and Typst (`@mueller2021digitale`).
 * A key never changes once given; imported keys (Better BibTeX, Citavi) are
 * kept when they are valid and free.
 */

const STOPWORDS = new Set(
  (
    "a an the of on in at for to and or with from by about into over under " +
    "der die das den dem des ein eine einer eines einem einen und oder zu zum zur im in am an auf aus bei mit nach von vom über unter fuer für " +
    "le la les un une des du de et l d el los las il lo gli"
  ).split(" "),
);

/** A key BibLaTeX, Pandoc and Typst all accept. */
export const CITEKEY = /^[A-Za-z][A-Za-z0-9_:.+-]*$/;

export function isValidCitekey(key: string): boolean {
  return CITEKEY.test(key) && key.length <= 64;
}

function asciiWord(text: string): string {
  return foldGerman(text).toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** The base key for an item, before collision suffixes. */
export function baseCitekey(item: Pick<CslItem, "author" | "editor" | "container-author" | "issued" | "accessed" | "title" | "container-title" | "publisher">): string {
  const family = firstCreatorFamily(item as CslItem);
  // no person: the website, journal or publisher stands in (wikipedia2026zitat)
  const stand = family ?? item["container-title"] ?? item.publisher ?? "";
  const who = asciiWord(stand.split(/\s+/).find((w) => !STOPWORDS.has(w.toLowerCase())) ?? stand).slice(0, 20);
  const year = yearOf(item.issued) ?? yearOf(item.accessed);
  const words = (item.title ?? "")
    .replace(/<[^>]+>/g, " ")
    .split(/[\s\-–—:;,.!?/()[\]"„“”'«»]+/)
    .map((w) => w.trim())
    .filter(Boolean);
  const significant = words.find((w) => !STOPWORDS.has(w.toLowerCase()) && asciiWord(w).length > 1) ?? words[0] ?? "";
  const word = asciiWord(significant).slice(0, 20);
  const base = `${who || "oa"}${year ?? "oj"}${word}`;
  return /^[a-z]/.test(base) ? base : `q${base}`;
}

/** A key not in `taken`: the base, then base-b, base-c, … */
export function uniqueCitekey(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 1; i < 26 * 26; i++) {
    const suffix = i < 26 ? String.fromCharCode(97 + i) : `${String.fromCharCode(96 + Math.floor(i / 26))}${String.fromCharCode(97 + (i % 26))}`;
    const key = `${base}-${suffix}`;
    if (!taken.has(key)) return key;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/** Keep `preferred` (an imported key) when valid and free; otherwise generate one. */
export function assignCitekey(item: CslItem, taken: ReadonlySet<string>, preferred?: string): string {
  if (preferred && isValidCitekey(preferred) && !taken.has(preferred)) return preferred;
  return uniqueCitekey(baseCitekey(item), taken);
}
