import { formatCslDate, parseCslDate, parseName } from "./csl-util.js";
import { cleanDoi, normalizeIsbn } from "./identifiers.js";
import type { CslItem, CslName } from "./types.js";

/**
 * BibTeX and BibLaTeX: a tolerant parser (what Zotero, Better BibTeX,
 * Citavi, JabRef, Mendeley and Google Scholar export) and a writer for the
 * `quellen.bib` that LaTeX (biber), Typst and Pandoc read. Both go through
 * CSL-JSON, the registry's own format.
 */

export interface BibEntry {
  type: string;
  key: string;
  fields: Record<string, string>;
}

export interface BibParseResult {
  entries: BibEntry[];
  errors: string[];
}

const MONTHS: Record<string, string> = {
  jan: "1", feb: "2", mar: "3", apr: "4", may: "5", jun: "6",
  jul: "7", aug: "8", sep: "9", oct: "10", nov: "11", dec: "12",
};

/** Parse a .bib file. Entries that cannot be read are skipped and named in `errors`. */
export function parseBibtex(text: string): BibParseResult {
  const entries: BibEntry[] = [];
  const errors: string[] = [];
  const strings: Record<string, string> = { ...MONTHS };
  let i = 0;
  const n = text.length;

  const skipWs = () => {
    while (i < n && /\s/.test(text[i]!)) i++;
  };
  const readIdent = () => {
    const start = i;
    while (i < n && /[^\s{}(),=#"]/.test(text[i]!)) i++;
    return text.slice(start, i);
  };
  const readBraced = (): string => {
    // at "{": return the content with inner braces kept
    let depth = 0;
    const start = i + 1;
    for (; i < n; i++) {
      const c = text[i];
      if (c === "\\") {
        i++;
        continue;
      }
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) {
          i++;
          return text.slice(start, i - 1);
        }
      }
    }
    throw new Error("unbalanced braces");
  };
  const readQuoted = (): string => {
    let depth = 0;
    const start = ++i;
    for (; i < n; i++) {
      const c = text[i];
      if (c === "\\") {
        i++;
        continue;
      }
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === '"' && depth === 0) {
        i++;
        return text.slice(start, i - 1);
      }
    }
    throw new Error("unterminated quote");
  };
  const readValue = (): string => {
    const parts: string[] = [];
    for (;;) {
      skipWs();
      const c = text[i];
      if (c === "{") parts.push(readBraced());
      else if (c === '"') parts.push(readQuoted());
      else {
        const id = readIdent();
        if (!id) throw new Error(`expected a value at ${i}`);
        parts.push(/^\d+$/.test(id) ? id : (strings[id.toLowerCase()] ?? id));
      }
      skipWs();
      if (text[i] === "#") {
        i++;
        continue;
      }
      return parts.join("");
    }
  };

  while (i < n) {
    const at = text.indexOf("@", i);
    if (at < 0) break;
    i = at + 1;
    const type = readIdent().toLowerCase();
    skipWs();
    const open = text[i];
    if (open !== "{" && open !== "(") continue;
    const close = open === "{" ? "}" : ")";
    if (type === "comment" || type === "preamble") {
      try {
        if (open === "{") readBraced();
        else i = text.indexOf(")", i) + 1 || n;
      } catch {
        i = n;
      }
      continue;
    }
    i++;
    try {
      if (type === "string") {
        skipWs();
        const name = readIdent().toLowerCase();
        skipWs();
        if (text[i] === "=") i++;
        strings[name] = readValue();
        skipWs();
        if (text[i] === close) i++;
        continue;
      }
      skipWs();
      const keyStart = i;
      while (i < n && text[i] !== "," && text[i] !== close) i++;
      const key = text.slice(keyStart, i).trim();
      const fields: Record<string, string> = {};
      while (i < n && text[i] !== close) {
        if (text[i] === ",") i++;
        skipWs();
        if (text[i] === close) break;
        const name = readIdent().toLowerCase();
        if (!name) throw new Error(`expected a field name in ${key || "an entry"}`);
        skipWs();
        if (text[i] !== "=") throw new Error(`expected "=" after ${name} in ${key || "an entry"}`);
        i++;
        fields[name] = readValue();
        skipWs();
      }
      i++;
      entries.push({ type, key, fields });
    } catch (e) {
      errors.push(`@${type} at character ${at}: ${e instanceof Error ? e.message : String(e)}`);
      // resume at the next line that starts an entry
      const next = text.indexOf("\n@", at + 1);
      i = next < 0 ? n : next + 1;
    }
  }
  return { entries, errors };
}

// ── LaTeX → Unicode ─────────────────────────────────────────────────────────

const ACCENTS: Record<string, string> = {
  '"': "\u0308", "'": "\u0301", "`": "\u0300", "^": "\u0302", "~": "\u0303", "=": "\u0304", ".": "\u0307",
  u: "\u0306", v: "\u030c", H: "\u030b", c: "\u0327", k: "\u0328", r: "\u030a", d: "\u0323", b: "\u0331",
};

const SYMBOLS: Record<string, string> = {
  ss: "ß", o: "ø", O: "Ø", ae: "æ", AE: "Æ", oe: "œ", OE: "Œ", aa: "å", AA: "Å", l: "ł", L: "Ł", i: "ı", j: "ȷ",
  textendash: "–", textemdash: "—", textquoteleft: "‘", textquoteright: "’", textquotedblleft: "“", textquotedblright: "”",
  glqq: "„", grqq: "“", glq: "‚", grq: "‘", dots: "…", ldots: "…", textellipsis: "…", S: "§", P: "¶", copyright: "©",
  textregistered: "®", texttrademark: "™", euro: "€", textdegree: "°", pounds: "£", textasciitilde: "~", textasciicircum: "^",
  textbackslash: "\\", textunderscore: "_", textbar: "|", textless: "<", textgreater: ">", "\\": " ",
};

/**
 * LaTeX in a field value → Unicode text with CSL mini-HTML for emphasis.
 * `keepBraces` leaves top-level protective braces in place (name lists need
 * them to tell an institution from a person).
 */
export function latexToUnicode(value: string, keepBraces = false): string {
  let s = value;
  // \"{u}  \"u  {\"u}  \'{\i}
  s = s.replace(/\{?\\([`'^"~=.])\s*(?:\{\s*\\?([A-Za-z])\s*\}|\\?([A-Za-z]))\}?/g, (_m, acc: string, a?: string, b?: string) => {
    return `${(a ?? b)!}${ACCENTS[acc]}`.normalize("NFC");
  });
  s = s.replace(/\{?\\([uvHckrdb])(?:\s*\{\s*\\?([A-Za-z])\s*\}|\s+\\?([A-Za-z]))\}?/g, (_m, acc: string, a?: string, b?: string) => `${(a ?? b)!}${ACCENTS[acc]}`.normalize("NFC"));
  s = s.replace(/\\(emph|textit|textsl)\s*\{([^{}]*)\}/g, "<i>$2</i>");
  s = s.replace(/\\textbf\s*\{([^{}]*)\}/g, "<b>$1</b>");
  s = s.replace(/\\textsc\s*\{([^{}]*)\}/g, '<span style="font-variant:small-caps;">$1</span>');
  s = s.replace(/\\textsuperscript\s*\{([^{}]*)\}/g, "<sup>$1</sup>");
  s = s.replace(/\\textsubscript\s*\{([^{}]*)\}/g, "<sub>$1</sub>");
  s = s.replace(/\\(url|href)\s*\{([^{}]*)\}(?:\{([^{}]*)\})?/g, (_m, _c, url: string, label?: string) => label ?? url);
  s = s.replace(/\{\\(it|em|sl)\s+([^{}]*)\}/g, "<i>$2</i>");
  s = s.replace(/\{\\bf\s+([^{}]*)\}/g, "<b>$1</b>");
  s = s.replace(/\\([A-Za-z]+|\\)(?:\{\})?/g, (m, name: string) => SYMBOLS[name] ?? m);
  s = s.replace(/\\([&%$#_])/g, "$1").replace(/\\\{/g, "\uE000").replace(/\\\}/g, "\uE001");
  s = s.replace(/---/g, "—").replace(/--/g, "–").replace(/~/g, " ");
  s = s.replace(/``|''/g, (q) => (q === "``" ? "“" : "”"));
  if (!keepBraces) s = s.replace(/[{}]/g, "");
  return s.replace(/\uE000/g, "{").replace(/\uE001/g, "}").replace(/\s+/g, " ").trim();
}

/** Split "A and B and {C and D}" on top-level " and ". */
function splitNames(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (depth === 0 && /\s/.test(c!) && /^\s+and\s+/i.test(value.slice(i))) {
      out.push(value.slice(start, i));
      const m = /^\s+and\s+/i.exec(value.slice(i))!;
      i += m[0].length - 1;
      start = i + 1;
    }
  }
  out.push(value.slice(start));
  return out.map((s) => s.trim()).filter(Boolean);
}

function bibNames(value: string): CslName[] {
  return splitNames(value).map((raw) => {
    const t = latexToUnicode(raw, true);
    if (/^\{[^{}]*\}$/.test(t)) return { literal: t.slice(1, -1).trim() };
    if (/^others$/i.test(t)) return { literal: "et al." };
    return parseName(t.replace(/[{}]/g, ""));
  });
}

// ── BibLaTeX → CSL ──────────────────────────────────────────────────────────

const TYPE_TO_CSL: Record<string, string> = {
  article: "article-journal",
  book: "book",
  mvbook: "book",
  booklet: "book",
  collection: "book",
  mvcollection: "book",
  proceedings: "book",
  mvproceedings: "book",
  reference: "book",
  manual: "book",
  inbook: "chapter",
  incollection: "chapter",
  bookinbook: "chapter",
  suppbook: "chapter",
  suppcollection: "chapter",
  inproceedings: "paper-conference",
  conference: "paper-conference",
  inreference: "entry-encyclopedia",
  report: "report",
  techreport: "report",
  thesis: "thesis",
  phdthesis: "thesis",
  mastersthesis: "thesis",
  online: "webpage",
  electronic: "webpage",
  www: "webpage",
  dataset: "dataset",
  software: "software",
  patent: "patent",
  standard: "standard",
  unpublished: "manuscript",
  periodical: "periodical",
  legislation: "legislation",
  legal: "legal_case",
  jurisdiction: "legal_case",
  commentary: "book",
  misc: "document",
};

const LANGID: Record<string, string> = {
  ngerman: "de-DE", german: "de-DE", naustrian: "de-AT", austrian: "de-AT", nswissgerman: "de-CH", swissgerman: "de-CH",
  english: "en-US", american: "en-US", USenglish: "en-US", british: "en-GB", UKenglish: "en-GB", french: "fr-FR", spanish: "es-ES", italian: "it-IT",
};

/** One BibTeX/BibLaTeX entry → CSL-JSON (id = the entry's key). */
export function bibEntryToCsl(entry: BibEntry): CslItem {
  const f = entry.fields;
  const text = (name: string) => (f[name] !== undefined ? latexToUnicode(f[name]!) : undefined);
  let type = TYPE_TO_CSL[entry.type] ?? "document";
  const sub = text("entrysubtype")?.toLowerCase();
  if (type === "article-journal" && sub === "magazine") type = "article-magazine";
  if (type === "article-journal" && sub === "newspaper") type = "article-newspaper";
  const item: CslItem = { id: entry.key, type };

  if (f.author) item.author = bibNames(f.author);
  if (f.editor) item.editor = bibNames(f.editor);
  if (f.translator) item.translator = bibNames(f.translator);
  if (f.bookauthor) item["container-author"] = bibNames(f.bookauthor);

  const title = text("title");
  const subtitle = text("subtitle");
  if (title) item.title = subtitle ? `${title.replace(/[:.]\s*$/, "")}: ${subtitle}` : title;
  if (text("shorttitle")) item["title-short"] = text("shorttitle");

  const container = text("journaltitle") ?? text("journal") ?? text("booktitle") ?? text("maintitle");
  if (container) item["container-title"] = container;
  if (text("eventtitle")) item["event-title"] = text("eventtitle");
  if (text("series")) item["collection-title"] = text("series");

  const number = text("number");
  if (number) {
    if (type.startsWith("article")) item.issue = number;
    else if (item["collection-title"] && (type === "book" || type === "chapter")) item["collection-number"] = number;
    else item.number = number;
  }
  if (text("issue") && !item.issue) item.issue = text("issue");
  if (text("volume")) item.volume = text("volume");
  if (f.pages) item.page = latexToUnicode(f.pages).replace(/\s*[–—-]+\s*/g, "-");
  if (text("pagetotal")) item["number-of-pages"] = text("pagetotal");
  if (text("edition")) item.edition = text("edition");

  const publisher = text("publisher") ?? (["thesis", "report"].includes(type) ? (text("institution") ?? text("school") ?? text("organization")) : text("organization"));
  if (publisher) item.publisher = publisher;
  if (!item.publisher && (text("institution") || text("school"))) item.publisher = text("institution") ?? text("school");
  const place = text("location") ?? text("address");
  if (place) item["publisher-place"] = place;

  const date = text("date");
  if (date) item.issued = parseCslDate(date);
  else if (text("year")) {
    const month = text("month");
    const m = month ? (MONTHS[month.toLowerCase().slice(0, 3)] ?? (/^\d{1,2}$/.test(month) ? month : undefined)) : undefined;
    item.issued = parseCslDate(`${text("year")}${m ? `-${m}` : ""}`);
  }
  if (text("urldate")) item.accessed = parseCslDate(text("urldate")!);
  if (text("origdate")) item["original-date"] = parseCslDate(text("origdate")!);

  if (f.doi) item.DOI = cleanDoi(f.doi.replace(/[{}]/g, ""));
  if (f.isbn) item.ISBN = latexToUnicode(f.isbn);
  if (f.issn) item.ISSN = latexToUnicode(f.issn);
  const url = f.url ?? (f.howpublished && /\\url|https?:\/\//.test(f.howpublished) ? f.howpublished : undefined);
  if (url) item.URL = url.replace(/^\\url\{|\}$/g, "").replace(/[{}]/g, "").trim();
  if (text("eprinttype")?.toLowerCase() === "arxiv" && text("eprint") && !item.URL) item.URL = `https://arxiv.org/abs/${text("eprint")}`;
  if (text("pmid")) item.PMID = text("pmid");

  const genre = text("type");
  if (genre) item.genre = genre;
  else if (entry.type === "phdthesis") item.genre = "Dissertation";
  else if (entry.type === "mastersthesis") item.genre = "Masterarbeit";

  const lang = text("langid") ?? text("language");
  if (lang) item.language = LANGID[lang] ?? LANGID[lang.toLowerCase()] ?? lang;
  if (text("abstract")) item.abstract = text("abstract");
  const note = [text("note"), text("addendum"), !url && f.howpublished ? text("howpublished") : undefined].filter(Boolean).join(". ");
  if (note) item.note = note;
  return item;
}

// ── CSL → BibLaTeX ──────────────────────────────────────────────────────────

const CSL_TO_TYPE: Record<string, string> = {
  "article-journal": "article",
  "article-magazine": "article",
  "article-newspaper": "article",
  book: "book",
  chapter: "incollection",
  "paper-conference": "inproceedings",
  thesis: "thesis",
  report: "report",
  webpage: "online",
  "post-weblog": "online",
  dataset: "dataset",
  software: "software",
  patent: "patent",
  standard: "standard",
  manuscript: "unpublished",
  "entry-encyclopedia": "inreference",
  "entry-dictionary": "inreference",
  periodical: "periodical",
};

const LANGID_OUT: Record<string, string> = {
  "de-DE": "ngerman", de: "ngerman", "de-AT": "naustrian", "de-CH": "nswissgerman", "en-US": "american", en: "american", "en-GB": "british",
  "fr-FR": "french", fr: "french", "es-ES": "spanish", "it-IT": "italian",
};

const BIB_SPECIAL: Record<string, string> = {
  "\\": "\\textbackslash{}", "{": "\\{", "}": "\\}", "&": "\\&", "%": "\\%", $: "\\$", "#": "\\#", _: "\\_",
  "~": "\\textasciitilde{}", "^": "\\textasciicircum{}",
};

function escapeBib(value: string): string {
  return value
    .replace(/[\\{}&%$#_~^]/g, (ch) => BIB_SPECIAL[ch]!)
    .replace(/<i>(.*?)<\/i>/g, "\\emph{$1}")
    .replace(/<b>(.*?)<\/b>/g, "\\textbf{$1}")
    .replace(/<sup>(.*?)<\/sup>/g, "\\textsuperscript{$1}")
    .replace(/<sub>(.*?)<\/sub>/g, "\\textsubscript{$1}")
    .replace(/<span style="font-variant:\s*small-caps;?">(.*?)<\/span>/g, "\\textsc{$1}")
    .replace(/<span class="nocase">(.*?)<\/span>/g, "{$1}")
    .replace(/<[^>]+>/g, "");
}

function bibName(n: CslName): string {
  if (n.literal) return `{${escapeBib(n.literal)}}`;
  const family = [n["non-dropping-particle"], n.family].filter(Boolean).join(" ");
  const given = [n.given, n["dropping-particle"]].filter(Boolean).join(" ");
  // BibTeX's forms: "family, given" and, with a suffix, "family, suffix, given"
  const parts = n.suffix ? [family, n.suffix, given] : [family, given];
  return parts.filter(Boolean).map(escapeBib).join(", ");
}

function bibNameList(names: CslName[] | undefined): string | undefined {
  return names?.length ? names.map(bibName).join(" and ") : undefined;
}

export type BibDialect = "biblatex" | "bibtex";

/** One CSL item → a BibLaTeX (default) or classic BibTeX entry. */
export function cslToBibEntry(item: CslItem, dialect: BibDialect = "biblatex"): BibEntry {
  const t = item.type;
  let type = CSL_TO_TYPE[t] ?? "misc";
  const fields: Record<string, string> = {};
  const put = (name: string, value: unknown, raw = false) => {
    if (value === undefined || value === null || value === "") return;
    fields[name] = raw ? String(value) : escapeBib(String(value));
  };
  if (t === "book" && !item.author?.length && item.editor?.length) type = "collection";
  if (t === "chapter" && !item.editor?.length) type = "inbook";

  if (dialect === "bibtex") {
    type = ({ thesis: item.genre && /diss|phd|doktor/i.test(item.genre) ? "phdthesis" : "mastersthesis", report: "techreport", online: "misc", collection: "book", dataset: "misc", software: "misc", standard: "misc", inreference: "incollection", periodical: "misc" } as Record<string, string>)[type] ?? type;
  }

  if (bibNameList(item.author)) fields.author = bibNameList(item.author)!;
  if (bibNameList(item.editor)) fields.editor = bibNameList(item.editor)!;
  if (bibNameList(item.translator)) fields.translator = bibNameList(item.translator)!;
  if (dialect === "biblatex" && bibNameList(item["container-author"])) fields.bookauthor = bibNameList(item["container-author"])!;
  put("title", item.title);
  if (dialect === "biblatex") put("shorttitle", item["title-short"]);

  const container = item["container-title"];
  if (container) {
    if (type === "article") put(dialect === "biblatex" ? "journaltitle" : "journal", container);
    else if (type === "online") put(dialect === "biblatex" ? "organization" : "howpublished", container);
    else put("booktitle", container);
  }
  if (dialect === "biblatex" && t === "article-magazine") put("entrysubtype", "magazine");
  if (dialect === "biblatex" && t === "article-newspaper") put("entrysubtype", "newspaper");
  put("eventtitle", dialect === "biblatex" ? item["event-title"] : undefined);
  put("series", item["collection-title"]);
  put("volume", item.volume);
  put("number", type === "article" ? item.issue : (item["collection-number"] ?? item.number));
  if (item.page) put("pages", String(item.page).replace(/\s*[-–—]+\s*/g, "--"));
  if (dialect === "biblatex") put("pagetotal", item["number-of-pages"]);
  put("edition", item.edition);

  if (type === "thesis" || type === "phdthesis" || type === "mastersthesis") {
    put(dialect === "biblatex" ? "institution" : "school", item.publisher);
    put("type", item.genre ?? (type === "thesis" ? "Abschlussarbeit" : undefined));
  } else if (type === "report" || type === "techreport") {
    put("institution", item.publisher);
    if (dialect === "biblatex") put("type", item.genre ?? "Bericht");
  } else {
    put("publisher", item.publisher);
  }
  put(dialect === "biblatex" ? "location" : "address", item["publisher-place"]);

  const issued = formatCslDate(item.issued);
  if (dialect === "biblatex") put("date", issued || undefined, true);
  else {
    const parts = item.issued?.["date-parts"]?.[0];
    if (parts?.[0]) put("year", parts[0], true);
    else if (issued) put("year", issued);
    if (parts?.[1]) put("month", parts[1], true);
  }
  if (dialect === "biblatex") put("urldate", formatCslDate(item.accessed) || undefined, true);
  put("doi", item.DOI, true);
  put("isbn", item.ISBN, true);
  put("issn", item.ISSN, true);
  put("url", item.URL, true);
  if (dialect === "bibtex" && item.URL && type === "misc") put("howpublished", `\\url{${item.URL}}`, true);
  if (dialect === "biblatex" && item.language) put("langid", LANGID_OUT[item.language] ?? undefined);
  put("note", item.note);
  return { type, key: item.id, fields };
}

/** Serialise entries as a .bib file. */
export function writeBibtex(entries: BibEntry[], header?: string): string {
  const out: string[] = [];
  if (header) out.push(...header.split("\n").map((l) => `% ${l}`), "");
  for (const e of entries) {
    const names = Object.keys(e.fields);
    const width = Math.max(0, ...names.map((k) => k.length));
    out.push(`@${e.type}{${e.key},`);
    names.forEach((k, idx) => out.push(`  ${k.padEnd(width)} = {${e.fields[k]}}${idx < names.length - 1 ? "," : ""}`));
    out.push("}", "");
  }
  return out.join("\n");
}

/** Normalised ISBN of a CSL item (first one listed), or null. */
export function itemIsbn(item: CslItem): string | null {
  const first = item.ISBN?.split(/[\s,;]+/).find(Boolean);
  return first ? normalizeIsbn(first) : null;
}
