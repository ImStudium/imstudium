import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { cslAssetsDir } from "../csl-assets.js";
import { ImstudiumError } from "../errors.js";
import { loadStyle, type LoadedStyle, type StyleInfo } from "./styles.js";
import type { CslItem } from "./types.js";

/**
 * Formatting through citeproc-js, the CSL processor Zotero and Mendeley use,
 * so a reference looks exactly as it would there. citeproc-js is loaded only
 * when something is formatted (CPAL-1.0 or AGPL-3.0, used unmodified as a
 * separate package).
 */

export type CiteFormat = "text" | "html" | "rtf" | "markdown";

/** One cite in a cluster: the key, an optional locator (S. 12, Kap. 3, Rn. 4) and prefix/suffix. */
export interface CiteRequest {
  key: string;
  locator?: string;
  label?: string;
  prefix?: string;
  suffix?: string;
  suppressAuthor?: boolean;
}

/** Where the cite sits in the text: first mention, a later one, or right after the same source (ebd./ibid.). */
export type CitePosition = "first" | "subsequent" | "ibid";

export interface Bibliography {
  entries: Array<{ key: string; text: string }>;
  /** The whole list as one string in the requested format. */
  text: string;
  hangingIndent: boolean;
  lineSpacing: number;
  entrySpacing: number;
}

interface CiteprocEngine {
  setOutputFormat(f: string): void;
  updateItems(ids: string[]): void;
  makeBibliography(): false | [{ hangingindent?: number | boolean; linespacing?: number; entryspacing?: number; entry_ids: string[][] }, string[]];
  makeCitationCluster(items: Array<Record<string, unknown>>): string;
  processCitationCluster(
    citation: { citationID: string; citationItems: Array<Record<string, unknown>>; properties: { noteIndex: number } },
    pre: Array<[string, number]>,
    post: Array<[string, number]>,
  ): [{ bibchange: boolean }, Array<[number, string, string]>];
}

let citeproc: { Engine: new (sys: unknown, style: string, lang?: string, forceLang?: boolean) => CiteprocEngine } | null = null;

function loadCiteproc() {
  if (!citeproc) {
    const require = createRequire(import.meta.url);
    citeproc = require("citeproc") as typeof citeproc;
  }
  return citeproc!;
}

/** citeproc locator labels for the abbreviations German and English texts use. */
const LABELS: Array<[RegExp, string]> = [
  [/^(?:S\.|Seite[n]?|p\.|pp\.|page[s]?)\s*/i, "page"],
  [/^(?:Kap\.|Kapitel|ch\.|chap\.|chapter)\s*/i, "chapter"],
  [/^(?:Abschn\.|Abschnitt|sec\.|section)\s*/i, "section"],
  [/^(?:Rn\.|Rdnr\.|Randnummer|Rz\.)\s*/i, "paragraph"],
  [/^§+\s*/, "section"],
  [/^(?:Abs\.|para\.|paragraph)\s*/i, "paragraph"],
  [/^(?:Bd\.|Band|vol\.|volume)\s*/i, "volume"],
  [/^(?:Fn\.|Anm\.|n\.|note)\s*/i, "note"],
  [/^(?:Sp\.|Spalte|col\.|column)\s*/i, "column"],
  [/^(?:Z\.|Zeile|l\.|line)\s*/i, "line"],
  [/^(?:Abb\.|fig\.|figure)\s*/i, "figure"],
  [/^(?:Tab\.|table)\s*/i, "table"],
];

/** "S. 12", "12-14", "Kap. 3", "Rn. 7" → citeproc locator and label (page when none is given). */
export function parseLocator(raw: string): { locator: string; label: string } {
  const s = raw.trim();
  for (const [re, label] of LABELS) {
    if (re.test(s)) return { locator: s.replace(re, "").trim(), label };
  }
  return { locator: s, label: "page" };
}

/** citeproc HTML → markdown (emphasis, small caps as plain text, entities decoded). */
export function htmlToMarkdown(html: string): string {
  return html
    .replace(/<div class="csl-left-margin">(.*?)<\/div>\s*<div class="csl-right-inline">(.*?)<\/div>/gs, "$1 $2")
    .replace(/<\/?div[^>]*>/g, "")
    .replace(/<i>(.*?)<\/i>/gs, "*$1*")
    .replace(/<b>(.*?)<\/b>/gs, "**$1**")
    .replace(/<sup>(.*?)<\/sup>/gs, "^$1^")
    .replace(/<sub>(.*?)<\/sub>/gs, "~$1~")
    .replace(/<a href="([^"]*)">(.*?)<\/a>/gs, "$2")
    .replace(/<[^>]+>/g, "")
    .replace(/&#38;|&amp;/g, "&")
    .replace(/&#60;|&lt;/g, "<")
    .replace(/&#62;|&gt;/g, ">")
    .replace(/&#160;|&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

const DUMMY_ID = "__imstudium_other__";

export class CitationFormatter {
  private engine: CiteprocEngine;
  private readonly makeEngine: () => CiteprocEngine;
  private readonly items = new Map<string, CslItem>();
  readonly style: StyleInfo;
  readonly lang: string;
  private format: CiteFormat;

  private constructor(style: LoadedStyle, items: CslItem[], lang: string, format: CiteFormat, forceLang: boolean) {
    for (const it of items) this.items.set(it.id, it);
    this.items.set(DUMMY_ID, { id: DUMMY_ID, type: "book", title: "Andere Quelle", author: [{ family: "Andere", given: "A." }], issued: { "date-parts": [[2000]] } });
    this.style = style.info;
    this.lang = lang;
    this.format = format;
    const locales = new Map<string, string>();
    const localeDir = join(cslAssetsDir(), "locales");
    const sys = {
      retrieveLocale: (l: string) => {
        if (!locales.has(l)) {
          const p = join(localeDir, `locales-${l}.xml`);
          locales.set(l, existsSync(p) ? readFileSync(p, "utf-8") : (null as unknown as string));
        }
        return locales.get(l)!;
      },
      retrieveItem: (id: string) => structuredClone(this.items.get(id)),
    };
    const { Engine } = loadCiteproc();
    this.makeEngine = () => {
      let engine: CiteprocEngine;
      try {
        engine = new Engine(sys, style.xml, lang, forceLang);
      } catch (e) {
        throw new ImstudiumError(`The style "${style.info.id}" could not be read: ${e instanceof Error ? e.message : String(e)}`, "STYLE_NOT_FOUND", undefined, "Check the .csl file, or pick another style (imstudium stile)", { style: style.info.id });
      }
      engine.setOutputFormat(format === "markdown" ? "html" : format);
      return engine;
    };
    this.engine = this.makeEngine();
    // numeric styles number by registration order: the registry's order unless a manuscript says otherwise
    this.engine.updateItems(items.map((it) => it.id));
  }

  /** A formatter for a style id or .csl path; `lang` is the Arbeit's language (style locale wins unless `forceLang`). */
  static async create(opts: { style: string; items: CslItem[]; arbeitDir?: string | null; lang?: string; format?: CiteFormat; forceLang?: boolean }): Promise<CitationFormatter> {
    const style = await loadStyle(opts.style, opts.arbeitDir);
    return new CitationFormatter(style, opts.items, opts.lang ?? "de-DE", opts.format ?? "text", opts.forceLang ?? false);
  }

  private out(s: string): string {
    return this.format === "markdown" ? htmlToMarkdown(s) : s;
  }

  private citeItems(cites: CiteRequest[]): Array<Record<string, unknown>> {
    return cites.map((c) => {
      if (!this.items.has(c.key)) throw new ImstudiumError(`No source "${c.key}" in this Arbeit`, "SOURCE_NOT_FOUND", undefined, "imstudium quellen lists the keys", { key: c.key });
      const loc = c.locator ? (c.label ? { locator: c.locator, label: c.label } : parseLocator(c.locator)) : null;
      return {
        id: c.key,
        ...(loc ? { locator: loc.locator, label: loc.label } : {}),
        ...(c.prefix ? { prefix: c.prefix } : {}),
        ...(c.suffix ? { suffix: c.suffix } : {}),
        ...(c.suppressAuthor ? { "suppress-author": true } : {}),
      };
    });
  }

  /**
   * One citation cluster as it appears in the text (author-date: "(Müller, 2021, S. 12)")
   * or in a footnote (note styles). `position` renders a later mention or ebd./ibid.
   */
  cite(cites: CiteRequest[], position: CitePosition = "first"): string {
    const citationItems = this.citeItems(cites);
    if (position === "first") return this.out(this.engine.makeCitationCluster(citationItems));
    // a fresh engine walks a short synthetic document: the cite, (another source,) the cite again
    const engine = this.makeEngine();
    engine.updateItems([...new Set([...this.items.keys()].filter((k) => k !== DUMMY_ID).concat(DUMMY_ID))]);
    const steps = position === "ibid" ? [citationItems, citationItems] : [citationItems, [{ id: DUMMY_ID }], citationItems];
    const pre: Array<[string, number]> = [];
    let last = "";
    steps.forEach((items, i) => {
      const id = `c${i}`;
      const [, updates] = engine.processCitationCluster({ citationID: id, citationItems: items, properties: { noteIndex: i + 1 } }, [...pre], []);
      pre.push([id, i + 1]);
      const mine = updates.find(([idx]) => idx === i);
      if (mine) last = mine[1];
    });
    return this.out(last);
  }

  /** The bibliography for `keys` (default: every item), sorted and numbered by the style. */
  bibliography(keys?: string[]): Bibliography {
    const ids = (keys ?? [...this.items.keys()]).filter((k) => k !== DUMMY_ID && this.items.has(k));
    this.engine.updateItems(ids);
    const result = ids.length ? this.engine.makeBibliography() : false;
    if (!result) return { entries: [], text: "", hangingIndent: false, lineSpacing: 1, entrySpacing: 1 };
    const [meta, strings] = result;
    const entries = strings.map((s, i) => ({ key: meta.entry_ids[i]?.[0] ?? ids[i]!, text: this.out(s).trim() }));
    const sep = this.format === "rtf" ? "" : this.format === "html" ? "\n" : "\n\n";
    const body = this.format === "markdown" || this.format === "text" ? entries.map((e) => e.text).join(sep) : strings.join(sep);
    return {
      entries,
      text: this.format === "rtf" ? `{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 ${"Times New Roman"};}}\\fs24\n${body}\n}` : body,
      hangingIndent: !!meta.hangingindent,
      lineSpacing: meta.linespacing ?? 1,
      entrySpacing: meta.entryspacing ?? 1,
    };
  }
}
