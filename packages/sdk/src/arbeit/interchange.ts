import { bibEntryToCsl, cslToBibEntry, parseBibtex, writeBibtex, type BibDialect } from "./bibtex.js";
import { formatCslDate, nameToString, parseCslDate, parseName } from "./csl-util.js";
import { cleanDoi } from "./identifiers.js";
import type { CslItem, CslName } from "./types.js";

/**
 * Import and export of whole libraries: BibTeX/BibLaTeX, RIS and CSL-JSON.
 * That covers what Zotero, Citavi, Mendeley, EndNote, JabRef and Paperpile
 * export, and what they import back.
 */

export type ImportFormat = "bibtex" | "ris" | "csl-json";
export type ExportFormat = "biblatex" | "bibtex" | "ris" | "csl-json";

export interface ParsedLibrary {
  format: ImportFormat;
  items: CslItem[];
  errors: string[];
}

/** Guess the format from the file name, then from the content. */
export function detectImportFormat(text: string, fileName = ""): ImportFormat | null {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (ext === "bib" || ext === "bibtex") return "bibtex";
  if (ext === "ris" || ext === "nbib" || ext === "enw") return "ris";
  if (ext === "json") return "csl-json";
  const head = text.trimStart();
  if (head.startsWith("[") || head.startsWith("{")) return "csl-json";
  if (/^TY {2}- /m.test(head)) return "ris";
  if (/@\w+\s*[{(]/.test(head)) return "bibtex";
  return null;
}

export function parseLibrary(text: string, format: ImportFormat): ParsedLibrary {
  if (format === "bibtex") {
    const { entries, errors } = parseBibtex(text);
    return { format, items: entries.map(bibEntryToCsl), errors };
  }
  if (format === "ris") return { format, ...parseRis(text) };
  return { format, ...parseCslJson(text) };
}

// ── CSL-JSON ────────────────────────────────────────────────────────────────

/** A CSL-JSON array (Zotero's export), or `{ items: [...] }`. */
export function parseCslJson(text: string): { items: CslItem[]; errors: string[] } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { items: [], errors: [`not valid JSON: ${e instanceof Error ? e.message : String(e)}`] };
  }
  const list = Array.isArray(data) ? data : data && typeof data === "object" && Array.isArray((data as { items?: unknown }).items) ? (data as { items: unknown[] }).items : [data];
  const items: CslItem[] = [];
  const errors: string[] = [];
  list.forEach((raw, idx) => {
    if (!raw || typeof raw !== "object") {
      errors.push(`item ${idx + 1}: not an object`);
      return;
    }
    // a registry export carries { key, csl }; plain CSL-JSON is the item itself
    const obj = (("csl" in raw && typeof (raw as { csl: unknown }).csl === "object") ? (raw as { csl: CslItem }).csl : raw) as Partial<CslItem>;
    if (!obj.type) {
      errors.push(`item ${idx + 1}: no "type"`);
      return;
    }
    const item = { ...obj, id: String(obj.id ?? (raw as { key?: string }).key ?? "") } as CslItem;
    if (item.DOI) item.DOI = cleanDoi(item.DOI);
    items.push(item);
  });
  return { items, errors };
}

// ── RIS ─────────────────────────────────────────────────────────────────────

const RIS_TO_CSL: Record<string, string> = {
  JOUR: "article-journal", JFULL: "article-journal", EJOUR: "article-journal", MGZN: "article-magazine", NEWS: "article-newspaper",
  BOOK: "book", EBOOK: "book", EDBOOK: "book", CHAP: "chapter", ECHAP: "chapter", CONF: "paper-conference", CPAPER: "paper-conference",
  THES: "thesis", RPRT: "report", ELEC: "webpage", WEB: "webpage", BLOG: "post-weblog", DATA: "dataset", COMP: "software",
  PAT: "patent", STAND: "standard", UNPB: "manuscript", MANSCPT: "manuscript", ENCYC: "entry-encyclopedia", DICT: "entry-dictionary",
  STAT: "legislation", BILL: "legislation", CASE: "legal_case", GEN: "document",
};

const CSL_TO_RIS: Record<string, string> = Object.fromEntries(
  Object.entries({
    "article-journal": "JOUR", "article-magazine": "MGZN", "article-newspaper": "NEWS", book: "BOOK", chapter: "CHAP",
    "paper-conference": "CPAPER", thesis: "THES", report: "RPRT", webpage: "ELEC", "post-weblog": "BLOG", dataset: "DATA",
    software: "COMP", patent: "PAT", standard: "STAND", manuscript: "UNPB", "entry-encyclopedia": "ENCYC",
    "entry-dictionary": "DICT", legislation: "STAT", legal_case: "CASE",
  }),
);

function risName(value: string): CslName {
  // RIS names are "Family, Given" (sometimes "Family,Given,Suffix")
  return parseName(value.replace(/,(?=\S)/g, ", "));
}

export function parseRis(text: string): { items: CslItem[]; errors: string[] } {
  const items: CslItem[] = [];
  const errors: string[] = [];
  let cur: Record<string, string[]> | null = null;
  let last: string | null = null;
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  for (const line of lines) {
    const m = /^([A-Z][A-Z0-9])  -(?: (.*))?$/.exec(line);
    if (!m) {
      if (cur && last && line.trim()) cur[last]![cur[last]!.length - 1] += ` ${line.trim()}`;
      continue;
    }
    const tag = m[1]!;
    const value = (m[2] ?? "").trim();
    if (tag === "TY") {
      cur = { TY: [value] };
      last = "TY";
      continue;
    }
    if (!cur) continue;
    if (tag === "ER") {
      items.push(risRecordToCsl(cur, items.length));
      cur = null;
      last = null;
      continue;
    }
    (cur[tag] ??= []).push(value);
    last = tag;
  }
  if (cur) errors.push("the last record has no ER line; it was read anyway");
  if (cur) items.push(risRecordToCsl(cur, items.length));
  return { items, errors };
}

function risRecordToCsl(r: Record<string, string[]>, idx: number): CslItem {
  const one = (...tags: string[]) => tags.map((t) => r[t]?.[0]).find((v) => v !== undefined && v !== "");
  const item: CslItem = { id: one("ID") ?? `ris${idx + 1}`, type: RIS_TO_CSL[one("TY") ?? "GEN"] ?? "document" };
  const authors = [...(r.AU ?? []), ...(r.A1 ?? [])];
  if (authors.length) item.author = authors.map(risName);
  const editors = [...(r.ED ?? []), ...(r.A2 && item.type !== "article-journal" ? r.A2 : []), ...(r.A3 ?? [])];
  if (editors.length) item.editor = editors.map(risName);
  const title = one("TI", "T1", "CT");
  if (title) item.title = title;
  const container = one("T2", "JO", "JF", "BT", "JA", "J2");
  if (container && container !== title) item["container-title"] = container;
  if (one("T3")) item["collection-title"] = one("T3");
  const date = one("DA", "PY", "Y1");
  if (date) {
    // "2021/03/15/" or "2021///" → 2021-03-15
    const parts = date.split("/").filter(Boolean);
    item.issued = parseCslDate(parts.slice(0, 3).map((p, i) => (i ? p.padStart(2, "0") : p)).join("-"));
  }
  if (one("Y2")) item.accessed = parseCslDate(one("Y2")!.split("/").filter(Boolean).join("-"));
  if (one("VL")) item.volume = one("VL");
  if (one("IS")) item.issue = one("IS");
  const sp = one("SP");
  const ep = one("EP");
  if (sp) item.page = ep ? `${sp}-${ep}` : sp;
  if (one("PB")) item.publisher = one("PB");
  if (one("CY", "PP")) item["publisher-place"] = one("CY", "PP");
  if (one("ET")) item.edition = one("ET");
  const sn = one("SN");
  if (sn) {
    if (/^\d{4}-?\d{3}[\dX]$/i.test(sn.trim())) item.ISSN = sn;
    else item.ISBN = sn;
  }
  if (one("DO")) item.DOI = cleanDoi(one("DO")!);
  const url = one("UR", "L1", "L2");
  if (url) item.URL = url;
  if (one("LA")) item.language = one("LA");
  if (one("AB", "N2")) item.abstract = one("AB", "N2");
  if (one("N1")) item.note = one("N1");
  if (one("M3") && item.type === "thesis") item.genre = one("M3");
  return item;
}

export function writeRis(items: CslItem[]): string {
  const out: string[] = [];
  for (const it of items) {
    const line = (tag: string, value: unknown) => {
      if (value !== undefined && value !== null && value !== "") out.push(`${tag}  - ${String(value).replace(/<[^>]+>/g, "")}`);
    };
    line("TY", CSL_TO_RIS[it.type] ?? "GEN");
    line("ID", it.id);
    for (const a of it.author ?? []) line("AU", nameToString(a));
    for (const e of it.editor ?? []) line("ED", nameToString(e));
    line("TI", it.title);
    line("T2", it["container-title"]);
    line("T3", it["collection-title"]);
    const issued = formatCslDate(it.issued);
    if (issued) {
      line("PY", issued.slice(0, 4));
      line("DA", issued.replace(/-/g, "/"));
    }
    if (it.accessed) line("Y2", formatCslDate(it.accessed).replace(/-/g, "/"));
    line("VL", it.volume);
    line("IS", it.issue);
    if (it.page) {
      const [sp, ep] = String(it.page).split(/\s*[-–]\s*/);
      line("SP", sp);
      line("EP", ep);
    }
    line("ET", it.edition);
    line("PB", it.publisher);
    line("CY", it["publisher-place"]);
    line("SN", it.ISBN ?? it.ISSN);
    line("DO", it.DOI);
    line("UR", it.URL);
    line("LA", it.language);
    line("N1", it.note);
    out.push("ER  - ", "");
  }
  return out.join("\n");
}

/** Export registry items in one of the four formats. */
export function exportLibrary(items: CslItem[], format: ExportFormat, header?: string): string {
  if (format === "csl-json") return `${JSON.stringify(items, null, 2)}\n`;
  if (format === "ris") return writeRis(items);
  return writeBibtex(items.map((it) => cslToBibEntry(it, format as BibDialect)), header);
}
