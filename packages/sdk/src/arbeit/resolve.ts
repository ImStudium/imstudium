import { ImstudiumError } from "../errors.js";
import { parseCslDate, parseName } from "./csl-util.js";
import { arxivDoi, cleanDoi, type Identifier } from "./identifiers.js";
import type { CslFields, CslItem, CslName, QuelleNotice, QuelleOrigin } from "./types.js";

/**
 * Metadata from the authorities: doi.org content negotiation (Crossref,
 * DataCite, mEDRA), the Crossref REST API (search, retractions), the
 * Deutsche Nationalbibliothek's SRU for ISBNs, Open Library as the ISBN
 * fallback, and a web page's own citation meta tags. Only the identifier or
 * the search words leave the machine. `fetch` is injectable; tests never
 * touch the network.
 */

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  url?: string;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal; method?: string; redirect?: "follow" }) => Promise<FetchResponseLike>;

export interface MetadataOptions {
  fetch?: FetchLike;
  /** Per request, default 10 s. */
  timeoutMs?: number;
  /** Shown to the services (Crossref's polite pool asks for a contact). */
  userAgent?: string;
  /** Contact address for Crossref's polite pool, when the student set one. */
  mailto?: string;
  /** "Today" for `accessed` on web pages (tests pin it). */
  now?: Date;
}

export interface Resolved {
  item: CslFields;
  origin: Omit<QuelleOrigin, "at">;
}

const DEFAULT_UA = "imstudium (+https://github.com/ImStudium/imstudium)";

function ua(opts: MetadataOptions): string {
  const base = opts.userAgent ?? DEFAULT_UA;
  return opts.mailto ? `${base} mailto:${opts.mailto}` : base;
}

async function get(url: string, opts: MetadataOptions, headers: Record<string, string> = {}, service = new URL(url).host): Promise<FetchResponseLike> {
  const f: FetchLike = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 10_000);
  try {
    return await f(url, { headers: { "User-Agent": ua(opts), ...headers }, signal: ctl.signal, redirect: "follow" });
  } catch (e) {
    throw new ImstudiumError(`${service} could not be reached: ${e instanceof Error ? e.message : String(e)}`, "METADATA_UNAVAILABLE", undefined, undefined, { service });
  } finally {
    clearTimeout(timer);
  }
}

function upstream(res: FetchResponseLike, service: string): never {
  throw new ImstudiumError(`${service} answered ${res.status}`, res.status >= 500 || res.status === 429 ? "METADATA_UNAVAILABLE" : "METADATA_NOT_FOUND", res.status, undefined, { service });
}

/** Crossref and DataCite titles carry JATS/MathML; keep CSL's mini-HTML, drop the rest. */
export function cleanMarkup(text: string): string {
  return text
    .replace(/<\/?(?:jats:)?italic>/g, (t) => (t.startsWith("</") ? "</i>" : "<i>"))
    .replace(/<\/?(?:jats:)?bold>/g, (t) => (t.startsWith("</") ? "</b>" : "<b>"))
    .replace(/<\/?(?:jats:)?sup>/g, (t) => (t.startsWith("</") ? "</sup>" : "<sup>"))
    .replace(/<\/?(?:jats:)?sub>/g, (t) => (t.startsWith("</") ? "</sub>" : "<sub>"))
    .replace(/<(?:jats:)?sc>(.*?)<\/(?:jats:)?sc>/g, '<span style="font-variant:small-caps;">$1</span>')
    .replace(/<(?!\/?(?:i|b|sup|sub|span)\b)[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Tidy a CSL item from a service: one title string, clean DOI, no service-specific noise. */
export function tidyServiceItem(raw: Record<string, unknown>): CslFields {
  const item = { ...raw } as Record<string, unknown>;
  if (!item.issued) item.issued = item["published-print"] ?? item["published-online"] ?? item.published;
  for (const k of ["id", "source", "score", "indexed", "deposited", "created", "content-domain", "reference", "reference-count", "is-referenced-by-count", "references-count", "link", "license", "member", "prefix", "relation", "funder", "assertion", "resource", "subject", "journal-issue", "short-container-title", "original-title", "update-policy", "published", "published-print", "published-online", "_graph", "categories"]) {
    delete item[k];
  }
  for (const k of ["title", "container-title", "collection-title", "subtitle"]) {
    const v = item[k];
    if (Array.isArray(v)) item[k] = v[0];
    if (typeof item[k] === "string") item[k] = cleanMarkup(item[k] as string);
    else delete item[k];
  }
  if (typeof item.subtitle === "string" && typeof item.title === "string" && item.subtitle && !String(item.title).includes(String(item.subtitle))) {
    item.title = `${String(item.title).replace(/[:.]\s*$/, "")}: ${item.subtitle}`;
  }
  delete item.subtitle;
  if (typeof item.DOI === "string") item.DOI = cleanDoi(item.DOI);
  if (Array.isArray(item.ISBN)) item.ISBN = (item.ISBN as string[])[0];
  if (Array.isArray(item.ISSN)) item.ISSN = (item.ISSN as string[])[0];
  if (typeof item.abstract === "string") item.abstract = cleanMarkup(item.abstract as string);
  for (const k of ["author", "editor", "translator", "container-author"]) {
    const names = item[k];
    if (Array.isArray(names)) {
      item[k] = names.map((n: Record<string, unknown>) => {
        const out: CslName = {};
        for (const f of ["family", "given", "literal", "non-dropping-particle", "dropping-particle", "suffix"] as const) {
          if (typeof n[f] === "string" && n[f]) out[f] = n[f] as string;
        }
        if (!out.family && !out.literal && typeof n.name === "string") out.literal = n.name;
        return out;
      });
    }
  }
  if (typeof item.type === "string") item.type = CROSSREF_TYPE[item.type as string] ?? item.type;
  return item as CslFields;
}

/** Crossref's own work types → CSL (search results use them). */
const CROSSREF_TYPE: Record<string, string> = {
  "journal-article": "article-journal",
  "book-chapter": "chapter",
  "book-section": "chapter",
  "book-part": "chapter",
  "proceedings-article": "paper-conference",
  book: "book",
  monograph: "book",
  "edited-book": "book",
  "reference-book": "book",
  "book-set": "book",
  report: "report",
  "report-component": "report",
  dissertation: "thesis",
  "posted-content": "article",
  dataset: "dataset",
  "reference-entry": "entry-encyclopedia",
  standard: "standard",
  "peer-review": "review",
  component: "document",
  other: "document",
};

/** DOI → CSL-JSON through doi.org content negotiation (works for Crossref, DataCite and mEDRA DOIs). */
export async function resolveDoi(doi: string, opts: MetadataOptions = {}): Promise<Resolved> {
  const clean = cleanDoi(doi);
  const res = await get(`https://doi.org/${encodeURI(clean)}`, opts, { Accept: "application/vnd.citationstyles.csl+json" }, "doi.org");
  if (res.status === 404) throw new ImstudiumError(`doi.org knows no DOI ${clean}`, "METADATA_NOT_FOUND", 404, "Check the DOI for typos. A DOI that doi.org does not know usually does not exist.", { service: "doi.org", doi: clean });
  if (!res.ok) upstream(res, "doi.org");
  const body = await res.text();
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(body) as Record<string, unknown>;
  } catch {
    throw new ImstudiumError(`doi.org returned no CSL record for ${clean}`, "METADATA_NOT_FOUND", res.status, undefined, { service: "doi.org", doi: clean });
  }
  const item = tidyServiceItem(data);
  item.DOI = clean;
  return { item, origin: { via: "doi", ref: clean, service: "doi.org" } };
}

/** arXiv id → CSL through the DataCite DOI arXiv registers (10.48550/arXiv.<id>). */
export async function resolveArxiv(id: string, opts: MetadataOptions = {}): Promise<Resolved> {
  const r = await resolveDoi(arxivDoi(id), opts);
  if (!r.item.URL) r.item.URL = `https://arxiv.org/abs/${id}`;
  return { item: r.item, origin: { via: "arxiv", ref: id, service: "doi.org" } };
}

// ── Crossref: notices (retractions, corrections) and search ────────────────

export interface CrossrefWork {
  doi: string;
  type: string | null;
  notices: QuelleNotice[];
  /** The work itself is a retraction or correction notice (it updates another DOI). */
  updates: QuelleNotice[];
}

const NOTICE_TYPES = /retract|withdraw|removal|concern|correct|erratum|corrigendum/i;

function noticeFrom(raw: Record<string, unknown>): QuelleNotice {
  const updated = raw.updated as { "date-parts"?: number[][] } | undefined;
  const parts = updated?.["date-parts"]?.[0];
  return {
    type: String(raw.type ?? "update").toLowerCase().replace(/\s+/g, "_"),
    ...(typeof raw.DOI === "string" ? { doi: cleanDoi(raw.DOI) } : {}),
    ...(parts?.length ? { date: parts.map((p, i) => (i ? String(p).padStart(2, "0") : String(p))).join("-") } : {}),
    ...(typeof raw.source === "string" ? { source: raw.source } : {}),
  };
}

/**
 * A DOI's update notices from the Crossref REST API: `updated-by` lists the
 * retractions, corrections and expressions of concern that point at this
 * work (publisher-deposited, and since 2025 Retraction Watch's too).
 * Returns null for a DOI Crossref does not hold (e.g. DataCite).
 */
export async function crossrefWork(doi: string, opts: MetadataOptions = {}): Promise<CrossrefWork | null> {
  const clean = cleanDoi(doi);
  const q = opts.mailto ? `?mailto=${encodeURIComponent(opts.mailto)}` : "";
  const res = await get(`https://api.crossref.org/works/${encodeURIComponent(clean)}${q}`, opts, { Accept: "application/json" }, "api.crossref.org");
  if (res.status === 404) return null;
  if (!res.ok) upstream(res, "api.crossref.org");
  const msg = (JSON.parse(await res.text()) as { message?: Record<string, unknown> }).message ?? {};
  const list = (k: string) => (Array.isArray(msg[k]) ? (msg[k] as Record<string, unknown>[]) : []);
  return {
    doi: clean,
    type: typeof msg.type === "string" ? msg.type : null,
    notices: list("updated-by").map(noticeFrom).filter((n) => NOTICE_TYPES.test(n.type)),
    updates: list("update-to").map(noticeFrom),
  };
}

export interface SearchCandidate {
  doi: string;
  item: CslFields;
  score: number;
}

/** Crossref bibliographic search: a reference string → candidate works with DOIs. */
export async function searchCrossref(query: string, opts: MetadataOptions & { rows?: number } = {}): Promise<SearchCandidate[]> {
  const params = new URLSearchParams({
    "query.bibliographic": query,
    rows: String(opts.rows ?? 5),
    select: "DOI,title,subtitle,author,editor,issued,container-title,type,publisher,page,volume,issue,score,ISBN",
  });
  if (opts.mailto) params.set("mailto", opts.mailto);
  const res = await get(`https://api.crossref.org/works?${params}`, opts, { Accept: "application/json" }, "api.crossref.org");
  if (!res.ok) upstream(res, "api.crossref.org");
  const data = JSON.parse(await res.text()) as { message?: { items?: Array<Record<string, unknown>> } };
  return (data.message?.items ?? []).map((raw) => ({
    doi: cleanDoi(String(raw.DOI ?? "")),
    score: typeof raw.score === "number" ? raw.score : 0,
    item: tidyServiceItem(raw),
  }));
}

// ── ISBN: Deutsche Nationalbibliothek, then Open Library ───────────────────

const HTML_ENTITIES: Record<string, string> = {
  auml: "ä", ouml: "ö", uuml: "ü", Auml: "Ä", Ouml: "Ö", Uuml: "Ü", szlig: "ß", nbsp: " ", eacute: "é", egrave: "è", agrave: "à",
  ccedil: "ç", ndash: "–", mdash: "—", laquo: "«", raquo: "»", bdquo: "„", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", hellip: "…", sect: "§",
};

function xmlText(s: string): string {
  return s
    .replace(/&([A-Za-z]+);/g, (m, name: string) => HTML_ENTITIES[name] ?? m)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&")
    // MARC non-sorting markers around leading articles ("¬Die¬ Kunst")
    .replace(/[\u0098\u009c]/g, "")
    .trim();
}

interface MarcField {
  tag: string;
  ind2: string;
  sub: Array<[string, string]>;
}

function marcFields(record: string): MarcField[] {
  const out: MarcField[] = [];
  for (const m of record.matchAll(/<(?:\w+:)?datafield\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?datafield>/g)) {
    const attrs = m[1]!;
    const tag = /tag="(\d+)"/.exec(attrs)?.[1] ?? "";
    const ind2 = /ind2="(.)"/.exec(attrs)?.[1] ?? " ";
    const sub: Array<[string, string]> = [];
    for (const s of m[2]!.matchAll(/<(?:\w+:)?subfield\b[^>]*code="(.)"[^>]*>([\s\S]*?)<\/(?:\w+:)?subfield>/g)) sub.push([s[1]!, xmlText(s[2]!)]);
    out.push({ tag, ind2, sub });
  }
  return out;
}

const trimIsbd = (s: string) => s.replace(/^[\s[]+|[\s\]/:;,.=]+$/g, "").replace(/\s*\[|\]\s*/g, "").trim();

/** One MARC 21 record (as the DNB sends it) → CSL-JSON. Exported for tests. */
export function marcToCsl(record: string): CslFields | null {
  const fields = marcFields(record);
  if (!fields.length) return null;
  const all = (tag: string) => fields.filter((f) => f.tag === tag);
  const first = (tag: string) => all(tag)[0];
  const sub = (f: MarcField | undefined, code: string) => f?.sub.filter(([c]) => c === code).map(([, v]) => v) ?? [];
  const item: CslFields = { type: "book" };

  const t = first("245");
  if (t) {
    const main = trimIsbd(sub(t, "a")[0] ?? "");
    const rest = trimIsbd(sub(t, "b")[0] ?? "");
    const part = [sub(t, "n")[0], sub(t, "p")[0]].filter(Boolean).map((p) => trimIsbd(p!)).join(" ");
    item.title = [main, rest].filter(Boolean).join(": ") + (part ? `. ${part}` : "");
  }
  const authors: CslName[] = [];
  const editors: CslName[] = [];
  const translators: CslName[] = [];
  const person = (f: MarcField) => {
    const name = trimIsbd(sub(f, "a")[0] ?? "");
    if (!name) return;
    const roles = [...sub(f, "4"), ...sub(f, "e")].join(" ").toLowerCase();
    const n = f.tag.endsWith("10") ? { literal: name } : parseName(name);
    if (/edt|hrsg|herausgeber|editor/.test(roles)) editors.push(n);
    else if (/trl|übers|translator/.test(roles)) translators.push(n);
    else if (f.tag.startsWith("1") || /aut|verfasser|author/.test(roles)) authors.push(n);
  };
  for (const f of [...all("100"), ...all("110"), ...all("700"), ...all("710")]) person(f);
  if (authors.length) item.author = authors;
  if (editors.length) item.editor = editors;
  if (translators.length) item.translator = translators;

  const pub = all("264").find((f) => f.ind2 === "1") ?? first("264") ?? first("260");
  if (pub) {
    const places = sub(pub, "a").map(trimIsbd).filter(Boolean);
    const publishers = sub(pub, "b").map(trimIsbd).filter(Boolean);
    const year = /(\d{4})/.exec(sub(pub, "c").join(" "))?.[1];
    if (places.length) item["publisher-place"] = places.join("; ");
    if (publishers.length) item.publisher = publishers.join("; ");
    if (year) item.issued = parseCslDate(year);
  }
  const ed = sub(first("250"), "a")[0];
  if (ed) item.edition = trimIsbd(ed);
  const pages = /(\d+)\s*(?:S\.|Seiten|p\.|pages)/i.exec(sub(first("300"), "a").join(" "))?.[1];
  if (pages) item["number-of-pages"] = pages;
  const series = first("490") ?? first("830");
  if (series) {
    const s = trimIsbd(sub(series, "a")[0] ?? "");
    if (s) item["collection-title"] = s;
    const v = sub(series, "v")[0];
    if (v) item["collection-number"] = trimIsbd(v).replace(/^(?:Bd\.|Band|Vol\.)\s*/i, "");
  }
  const isbn = all("020").flatMap((f) => sub(f, "a")).map((s) => s.replace(/[^\dX]/gi, "")).find((s) => s.length === 13 || s.length === 10);
  if (isbn) item.ISBN = isbn;
  const lang = sub(first("041"), "a")[0];
  if (lang) item.language = ({ ger: "de-DE", eng: "en-US", fre: "fr-FR", spa: "es-ES", ita: "it-IT" } as Record<string, string>)[lang] ?? lang;
  return item.title ? item : null;
}

/** ISBN → CSL: the DNB first (authoritative for German books), Open Library second. */
export async function resolveIsbn(isbn: string, opts: MetadataOptions = {}): Promise<Resolved> {
  let dnbReached = false;
  try {
    const params = new URLSearchParams({ version: "1.1", operation: "searchRetrieve", query: `isbn=${isbn}`, recordSchema: "MARC21-xml", maximumRecords: "1" });
    const res = await get(`https://services.dnb.de/sru/dnb?${params}`, opts, { Accept: "application/xml" }, "services.dnb.de");
    dnbReached = true;
    if (res.ok) {
      const xml = await res.text();
      const n = Number(/<(?:\w+:)?numberOfRecords>(\d+)</.exec(xml)?.[1] ?? "0");
      const record = /<(?:\w+:)?recordData>([\s\S]*?)<\/(?:\w+:)?recordData>/.exec(xml)?.[1];
      const item = n > 0 && record ? marcToCsl(record) : null;
      if (item) {
        item.ISBN = isbn;
        return { item, origin: { via: "isbn", ref: isbn, service: "dnb" } };
      }
    }
  } catch (e) {
    if (!(e instanceof ImstudiumError) || e.code !== "METADATA_UNAVAILABLE") throw e;
  }
  let olReached = false;
  try {
    const res = await get(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`, opts, { Accept: "application/json" }, "openlibrary.org");
    olReached = true;
    if (res.ok) {
      const data = JSON.parse(await res.text()) as Record<string, Record<string, unknown>>;
      const book = data[`ISBN:${isbn}`];
      if (book) {
        const names = (k: string) => (Array.isArray(book[k]) ? (book[k] as Array<{ name?: string }>).map((x) => x.name).filter((x): x is string => !!x) : []);
        const item: CslFields = { type: "book", ISBN: isbn };
        const title = typeof book.title === "string" ? book.title : undefined;
        const subtitle = typeof book.subtitle === "string" ? book.subtitle : undefined;
        if (title) item.title = subtitle ? `${title}: ${subtitle}` : title;
        if (names("authors").length) item.author = names("authors").map(parseName);
        if (names("publishers").length) item.publisher = names("publishers").join("; ");
        if (names("publish_places").length) item["publisher-place"] = names("publish_places").join("; ");
        const year = /(\d{4})/.exec(String(book.publish_date ?? ""))?.[1];
        if (year) item.issued = parseCslDate(year);
        if (typeof book.number_of_pages === "number") item["number-of-pages"] = String(book.number_of_pages);
        if (item.title) return { item, origin: { via: "isbn", ref: isbn, service: "openlibrary" } };
      }
    }
  } catch (e) {
    if (!(e instanceof ImstudiumError) || e.code !== "METADATA_UNAVAILABLE") throw e;
  }
  if (!dnbReached && !olReached) {
    throw new ImstudiumError("Neither the DNB nor Open Library could be reached", "METADATA_UNAVAILABLE", undefined, undefined, { services: ["services.dnb.de", "openlibrary.org"] });
  }
  throw new ImstudiumError(`Neither the DNB nor Open Library know ISBN ${isbn}`, "METADATA_NOT_FOUND", undefined, "Check the ISBN on the book's imprint page, or add it with imstudium quellen add --manual", { isbn });
}

// ── Web pages ───────────────────────────────────────────────────────────────

function metaTags(html: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const name = /\b(?:name|property|itemprop)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    const content = /\bcontent\s*=\s*"([^"]*)"|\bcontent\s*=\s*'([^']*)'/i.exec(tag);
    if (name && content) out.push([name.toLowerCase(), xmlText(content[1] ?? content[2] ?? "")]);
  }
  return out;
}

/**
 * URL → CSL. A page that names its DOI (citation_doi, dc.identifier) resolves
 * through doi.org; otherwise the Highwire/Dublin Core/Open Graph tags give a
 * webpage (or journal article) with today as the access date.
 */
export async function resolveUrl(url: string, opts: MetadataOptions = {}): Promise<Resolved> {
  const res = await get(url, opts, { Accept: "text/html,application/xhtml+xml" }, new URL(url).host);
  if (!res.ok) upstream(res, new URL(url).host);
  const html = (await res.text()).slice(0, 2_000_000);
  const tags = metaTags(html);
  const one = (...names: string[]) => names.map((n) => tags.find(([k]) => k === n)?.[1]).find((v) => v);
  const many = (name: string) => tags.filter(([k]) => k === name).map(([, v]) => v);

  const doi = one("citation_doi", "dc.identifier.doi", "prism.doi", "bepress_citation_doi") ?? tags.find(([k, v]) => k === "dc.identifier" && /10\.\d{4,9}\//.test(v))?.[1];
  if (doi) {
    try {
      const r = await resolveDoi(doi, opts);
      if (!r.item.URL) r.item.URL = url;
      return { item: r.item, origin: { via: "url", ref: url, service: "doi.org" } };
    } catch (e) {
      if (!(e instanceof ImstudiumError) || e.code !== "METADATA_NOT_FOUND") throw e;
    }
  }
  const site = one("og:site_name", "citation_publisher", "dc.publisher");
  const rawTitle = one("citation_title", "dc.title", "og:title", "twitter:title") ?? xmlText(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "");
  // "Zitat – Wikipedia" → "Zitat" when the suffix is the site's name
  const title = site ? rawTitle.replace(new RegExp(`\\s+[-–—|·:]\\s+${site.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`), "") : rawTitle;
  const authors = [...many("citation_author"), ...many("dc.creator")].filter(Boolean);
  const journal = one("citation_journal_title");
  const date = one("citation_publication_date", "citation_date", "citation_online_date", "dc.date", "article:published_time", "date");
  const now = opts.now ?? new Date();
  const item: CslFields = {
    type: journal ? "article-journal" : "webpage",
    title: title || url,
    URL: url,
    accessed: { "date-parts": [[now.getFullYear(), now.getMonth() + 1, now.getDate()]] },
  };
  if (authors.length) item.author = authors.map((a) => parseName(a));
  if (journal) item["container-title"] = journal;
  else if (site) item["container-title"] = site;
  if (date) item.issued = parseCslDate(date.replace(/\//g, "-").slice(0, 10));
  const vol = one("citation_volume");
  const iss = one("citation_issue");
  const fp = one("citation_firstpage");
  const lp = one("citation_lastpage");
  if (vol) item.volume = vol;
  if (iss) item.issue = iss;
  if (fp) item.page = lp ? `${fp}-${lp}` : fp;
  const isbn = one("citation_isbn");
  if (isbn) item.ISBN = isbn;
  return { item, origin: { via: "url", ref: url, service: "web" } };
}

/** Resolve any recognised identifier. */
export async function resolveIdentifier(id: Identifier, opts: MetadataOptions = {}): Promise<Resolved> {
  switch (id.kind) {
    case "doi":
      return resolveDoi(id.value, opts);
    case "isbn":
      return resolveIsbn(id.value, opts);
    case "arxiv":
      return resolveArxiv(id.value, opts);
    case "url":
      return resolveUrl(id.value, opts);
  }
}
