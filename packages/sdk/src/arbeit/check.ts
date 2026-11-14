import { ImstudiumError } from "../errors.js";
import { creatorsShort, firstCreatorFamily, foldGerman, normalizeForCompare, similarity, yearOf } from "./csl-util.js";
import { normalizeIsbn } from "./identifiers.js";
import { isBibliographyHeading, type ManuscriptScan } from "./manuscript.js";
import { crossrefWork, resolveDoi, resolveIsbn, searchCrossref, type MetadataOptions } from "./resolve.js";
import { daysUntil, findDuplicate } from "./store.js";
import type { Arbeit, CslItem, Quelle, QuelleCheck, QuelleDifference, QuellenFile } from "./types.js";

/**
 * Correct research, checked: every source exists, matches what the
 * authority says, is not retracted and has the fields its style needs; the
 * manuscript cites only what the registry holds, with page numbers, at the
 * length and with the parts the Formvorgaben ask for.
 */

// ── Completeness (offline) ─────────────────────────────────────────────────

const FIELD_LABEL: Record<string, string> = {
  author: "Autor:in",
  editor: "Herausgeber:in",
  title: "Titel",
  "container-title": "Zeitschrift oder Sammelband",
  "event-title": "Tagung",
  issued: "Jahr",
  volume: "Jahrgang/Band",
  page: "Seiten",
  publisher: "Verlag bzw. Hochschule",
  "publisher-place": "Verlagsort",
  URL: "URL",
  accessed: "Abrufdatum",
  genre: "Art der Arbeit (z. B. Masterarbeit)",
};

/** Fields each CSL type needs for a complete reference (an array means: any one of them). */
const REQUIRED: Record<string, Array<string | string[]>> = {
  "article-journal": [["author", "editor"], "title", "container-title", "issued", "volume", "page"],
  "article-magazine": [["author", "editor"], "title", "container-title", "issued"],
  "article-newspaper": ["title", "container-title", "issued"],
  book: [["author", "editor"], "title", "issued", "publisher", "publisher-place"],
  chapter: ["author", "title", "container-title", "editor", "issued", "publisher", "page"],
  "paper-conference": ["author", "title", ["container-title", "event-title"], "issued"],
  thesis: ["author", "title", "issued", "publisher", "genre"],
  report: [["author", "publisher"], "title", "issued"],
  webpage: ["title", "URL", "accessed"],
  "post-weblog": ["title", "URL", "accessed"],
  dataset: [["author", "publisher"], "title", "issued"],
  software: ["title", ["URL", "publisher"]],
  legislation: ["title"],
  legal_case: ["title"],
  "entry-encyclopedia": ["title", "container-title", "issued"],
};

const present = (item: CslItem, f: string) => {
  const v = item[f];
  if (Array.isArray(v)) return v.length > 0;
  if (v && typeof v === "object") return Object.keys(v).length > 0;
  return v !== undefined && v !== null && String(v).trim() !== "";
};

/** Missing fields as German labels ("Verlagsort", "Seiten"). */
export function missingFields(item: CslItem): string[] {
  const req = REQUIRED[item.type] ?? ["title", "issued"];
  const out: string[] = [];
  for (const r of req) {
    const any = Array.isArray(r) ? r : [r];
    if (!any.some((f) => present(item, f))) out.push(any.map((f) => FIELD_LABEL[f] ?? f).join(" oder "));
  }
  return out;
}

// ── Verification (online) ──────────────────────────────────────────────────

function compare(ours: CslItem, theirs: Partial<CslItem>): { differences: QuelleDifference[]; yearOffByOne: boolean } {
  const differences: QuelleDifference[] = [];
  let yearOffByOne = false;
  if (ours.title && theirs.title && similarity(ours.title, theirs.title) < 0.85) {
    // a title that only adds or drops a subtitle is the same work
    const a = normalizeForCompare(ours.title);
    const b = normalizeForCompare(theirs.title);
    if (!a.startsWith(b) && !b.startsWith(a)) differences.push({ field: "title", ours: ours.title, theirs: theirs.title });
  }
  const fa = firstCreatorFamily(ours);
  const fb = firstCreatorFamily(theirs as CslItem);
  if (fa && fb && normalizeForCompare(foldGerman(fa)) !== normalizeForCompare(foldGerman(fb)) && normalizeForCompare(fa) !== normalizeForCompare(fb)) {
    differences.push({ field: "author", ours: fa, theirs: fb });
  }
  const ya = yearOf(ours.issued);
  const yb = yearOf(theirs.issued);
  if (ya && yb && ya !== yb) {
    if (Math.abs(ya - yb) === 1) yearOffByOne = true;
    else differences.push({ field: "issued", ours: String(ya), theirs: String(yb) });
  }
  return { differences, yearOffByOne };
}

/**
 * Check one source against the authorities: DOI → doi.org and Crossref's
 * update notices (retractions, corrections); ISBN → DNB / Open Library;
 * neither → a Crossref search by title, author and year.
 */
export async function verifyQuelle(q: Quelle, opts: MetadataOptions = {}): Promise<QuelleCheck> {
  const at = (opts.now ?? new Date()).toISOString();
  const item = q.csl;
  if (item.DOI) {
    let theirs: Partial<CslItem>;
    try {
      theirs = (await resolveDoi(item.DOI, opts)).item;
    } catch (e) {
      if (e instanceof ImstudiumError && e.code === "METADATA_NOT_FOUND") {
        return { status: "not-found", at, service: "doi.org", detail: `doi.org kennt die DOI ${item.DOI} nicht. Tippfehler, oder die Quelle gibt es so nicht.` };
      }
      throw e;
    }
    const { differences, yearOffByOne } = compare(item, theirs);
    const work = await crossrefWork(item.DOI, opts).catch((e) => {
      if (e instanceof ImstudiumError && e.code === "METADATA_UNAVAILABLE") return null;
      throw e;
    });
    const notices = work?.notices ?? [];
    const retraction = notices.find((n) => /retract|withdraw|removal/.test(n.type));
    if (retraction) {
      return { status: "retracted", at, service: "crossref", detail: `Zurückgezogen${retraction.date ? ` am ${retraction.date}` : ""}${retraction.doi ? ` (Mitteilung ${retraction.doi})` : ""}${retraction.source === "retraction-watch" ? ", laut Retraction Watch" : ""}. Nicht als Beleg verwenden.`, notices, ...(differences.length ? { differences } : {}) };
    }
    const isNotice = work?.updates.length ? `Diese DOI ist selbst eine ${work.updates[0]!.type}-Mitteilung zu ${work.updates[0]!.doi ?? "einer anderen Arbeit"}.` : "";
    const other = notices.length ? `Hinweise: ${notices.map((n) => n.type).join(", ")}.` : "";
    if (differences.length) {
      return { status: "mismatch", at, service: "doi.org", detail: `Die DOI gehört zu „${theirs.title ?? "?"}“ (${creatorsShort(theirs as CslItem)}, ${yearOf(theirs.issued) ?? "o. J."}). ${isNotice} ${other}`.trim(), differences, ...(notices.length ? { notices } : {}) };
    }
    return { status: "verified", at, service: "doi.org", detail: [yearOffByOne ? "Jahr weicht um eins ab (Online-First oder Druckjahr)." : "", isNotice, other].filter(Boolean).join(" ") || undefined, ...(notices.length ? { notices } : {}) } as QuelleCheck;
  }
  const rawIsbn = item.ISBN?.split(/[\s,;]+/).find(Boolean);
  if (rawIsbn) {
    const isbn = normalizeIsbn(rawIsbn);
    if (!isbn) return { status: "not-found", at, detail: `Die ISBN ${rawIsbn} hat eine falsche Prüfziffer.` };
    try {
      const r = await resolveIsbn(isbn, opts);
      const { differences, yearOffByOne } = compare(item, r.item);
      // another edition of the same book differs in year: say so, but it is the book
      const editionOnly = differences.length === 1 && differences[0]!.field === "issued";
      if (differences.length && !editionOnly) return { status: "mismatch", at, service: r.origin.service ?? undefined, detail: `Die ISBN gehört zu „${r.item.title}“ (${creatorsShort(r.item as CslItem)}).`, differences };
      return { status: "verified", at, service: r.origin.service ?? undefined, ...(editionOnly || yearOffByOne ? { detail: "Jahr weicht ab: andere Auflage? Zitiere die Auflage, die du gelesen hast." } : {}) };
    } catch (e) {
      if (e instanceof ImstudiumError && e.code === "METADATA_NOT_FOUND") return { status: "unverified", at, detail: "Weder DNB noch Open Library kennen die ISBN (kleine Verlage fehlen dort oft). Prüfe sie im Impressum." };
      throw e;
    }
  }
  if (item.type === "webpage" || item.type === "post-weblog" || item.type === "legislation" || item.type === "legal_case" || !item.title) {
    return { status: "unverified", at, detail: item.type === "webpage" || item.type === "post-weblog" ? "Webseiten prüft keine Normdatei. Abrufdatum angeben und eine Kopie sichern (z. B. web.archive.org)." : "Ohne DOI oder ISBN nicht automatisch prüfbar." };
  }
  const query = [item.title, firstCreatorFamily(item), yearOf(item.issued)].filter(Boolean).join(" ");
  const hits = await searchCrossref(query, { ...opts, rows: 3 });
  const best = hits.find((h) => {
    const { differences } = compare(item, h.item);
    return differences.length === 0 && similarity(item.title ?? "", h.item.title ?? "") >= 0.9;
  });
  if (best) return { status: "verified", at, service: "crossref", detail: `Bei Crossref gefunden: DOI ${best.doi}. Mit imstudium quellen edit ${q.key} DOI=${best.doi} eintragen.`, suggestedDoi: best.doi };
  return { status: "unverified", at, service: "crossref", detail: "Keine DOI oder ISBN und kein passender Treffer bei Crossref. Bücher ohne ISBN und graue Literatur prüft niemand automatisch: im Katalog der Bibliothek nachsehen." };
}

export interface QuelleCheckResult {
  key: string;
  short: string;
  check: QuelleCheck | null;
  missing: string[];
  duplicateOf: string | null;
}

/** Duplicates inside the registry: later entries that are the same work as an earlier one. */
export function registryDuplicates(file: QuellenFile): Map<string, string> {
  const out = new Map<string, string>();
  file.items.forEach((q, i) => {
    const earlier: QuellenFile = { ...file, items: file.items.slice(0, i) };
    const dup = findDuplicate(earlier, q.csl);
    if (dup) out.set(q.key, dup.key);
  });
  return out;
}

/** Check every entry (or `keys`): completeness and duplicates offline, plus the authorities unless `offline`. */
export async function checkQuellen(file: QuellenFile, opts: MetadataOptions & { keys?: string[]; offline?: boolean; onProgress?: (done: number, total: number) => void } = {}): Promise<QuelleCheckResult[]> {
  const dups = registryDuplicates(file);
  const selected = opts.keys?.length ? file.items.filter((q) => opts.keys!.includes(q.key)) : file.items;
  const out: QuelleCheckResult[] = [];
  let done = 0;
  for (const q of selected) {
    let check: QuelleCheck | null = q.check ?? null;
    if (!opts.offline) check = await verifyQuelle(q, opts);
    out.push({ key: q.key, short: `${creatorsShort(q.csl)} (${yearOf(q.csl.issued) ?? "o. J."})`, check, missing: missingFields(q.csl), duplicateOf: dups.get(q.key) ?? null });
    opts.onProgress?.(++done, selected.length);
  }
  return out;
}

// ── The manuscript against registry and Formvorgaben ───────────────────────

export type CheckStatus = "ok" | "warn" | "fail" | "skip";

export interface ArbeitCheck {
  id: string;
  title: string;
  status: CheckStatus;
  detail: string;
  fix: string | null;
  data?: Record<string, unknown>;
}

export interface ManuscriptCitationReport {
  count: number;
  /** Registry keys the manuscript cites. */
  cited: string[];
  /** Keys in the manuscript that are not in the registry. */
  unknown: string[];
  /** Registry keys the manuscript never cites. */
  uncited: string[];
  /** Cites of printed works without a page or other locator. */
  withoutLocator: Array<{ key: string; line: number | null }>;
  /** How cited keys were found: by key in the text, by Word field, or by author and year in the running text. */
  matchedBy: Record<string, "key" | "field" | "heuristic">;
}

const PRINTED = new Set(["book", "chapter", "article-journal", "article-magazine", "article-newspaper", "paper-conference", "thesis", "report", "entry-encyclopedia", "legal_case", "legislation"]);

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Match manuscript citations to registry entries (by key, Word field data, or author + year in the text). */
export function matchCitations(file: QuellenFile, scan: ManuscriptScan): ManuscriptCitationReport {
  const byKey = new Map(file.items.map((q) => [q.key, q]));
  const matchedBy: ManuscriptCitationReport["matchedBy"] = {};
  const unknown = new Set<string>();
  const withoutLocator: ManuscriptCitationReport["withoutLocator"] = [];
  for (const c of scan.citations) {
    let q: Quelle | undefined;
    if (c.key) {
      q = byKey.get(c.key);
      if (!q) {
        unknown.add(c.key);
        continue;
      }
      matchedBy[q.key] ??= "key";
    } else if (c.item) {
      q = (c.item.DOI && file.items.find((x) => x.csl.DOI?.toLowerCase() === String(c.item!.DOI).toLowerCase())) || findDuplicate(file, { type: "document", ...c.item } as CslItem);
      if (!q) {
        unknown.add(c.item.title ? `„${String(c.item.title).slice(0, 60)}“` : "(Word-Feld ohne Titel)");
        continue;
      }
      matchedBy[q.key] ??= "field";
    } else if (c.tag) {
      q = byKey.get(c.tag);
      if (!q) continue;
      matchedBy[q.key] ??= "field";
    }
    if (q && !c.locator && PRINTED.has(q.csl.type)) withoutLocator.push({ key: q.key, line: c.line ?? null });
  }
  // Word without citation fields, plain text: author and year near each other count as a cite
  if (scan.format === "docx" || scan.format === "text") {
    for (const q of file.items) {
      if (matchedBy[q.key]) continue;
      const fam = firstCreatorFamily(q.csl);
      const year = yearOf(q.csl.issued);
      if (!fam || !year) continue;
      const re = new RegExp(`${escapeRe(fam.split(/\s+/)[0]!)}[^\\n]{0,80}?${year}|${year}[^\\n]{0,10}?${escapeRe(fam.split(/\s+/)[0]!)}`, "i");
      if (re.test(scan.text)) matchedBy[q.key] = "heuristic";
    }
  }
  const cited = scan.citesAll ? file.items.map((q) => q.key) : Object.keys(matchedBy);
  return {
    count: scan.citations.length,
    cited,
    unknown: [...unknown],
    uncited: file.items.map((q) => q.key).filter((k) => !cited.includes(k)),
    withoutLocator,
    matchedBy,
  };
}

/** Pages a text of `words` words fills under these Formvorgaben (about 330 words at 12 pt, 1.5 lines, 15 cm text width). */
export function estimatePages(words: number, f: Arbeit["formvorgaben"]): number {
  const width = Math.max(8, 21 - f.rand.links - f.rand.rechts);
  const height = Math.max(15, 29.7 - f.rand.oben - f.rand.unten);
  const perPage = 330 * (width / 15) * (height / 24.2) * (1.5 / Math.max(1, f.zeilenabstand)) * Math.pow(12 / Math.max(8, f.schrift.groesse), 2);
  return Math.round((words / perPage) * 10) / 10;
}

/** The full check of an Arbeit: registry state, and with a scan the manuscript against registry and Formvorgaben. */
export function checkArbeit(arbeit: Arbeit, file: QuellenFile, scan: ManuscriptScan | null, now = new Date()): { checks: ArbeitCheck[]; citations: ManuscriptCitationReport | null; pages: number | null } {
  const checks: ArbeitCheck[] = [];
  const add = (c: ArbeitCheck) => checks.push(c);
  const report = scan ? matchCitations(file, scan) : null;
  const relevant = report ? file.items.filter((q) => report.cited.includes(q.key)) : file.items;
  const scope = report ? "zitierte Quellen" : "Quellen";
  const scopeAll = report ? "zitierten Quellen" : "Quellen";

  add(
    file.items.length
      ? { id: "quellen.register", title: "Quellenregister", status: "ok", detail: `${file.items.length} Quellen im Register`, fix: null }
      : { id: "quellen.register", title: "Quellenregister", status: "warn", detail: "Das Register ist leer", fix: "imstudium quellen add <DOI|ISBN|URL> (oder quellen import <datei.bib>)" },
  );

  const problems = relevant.filter((q) => q.check && ["mismatch", "not-found", "retracted"].includes(q.check.status));
  add({
    id: "quellen.probleme",
    title: "Quellen existieren und stimmen",
    status: problems.length ? "fail" : "ok",
    detail: problems.length ? problems.map((q) => `${q.key}: ${q.check!.status === "retracted" ? "zurückgezogen" : q.check!.status === "not-found" ? "nicht gefunden" : "weicht ab"}`).join("; ") : `keine Probleme bei den geprüften ${scopeAll}`,
    fix: problems.length ? `imstudium quellen show ${problems[0]!.key}, dann korrigieren (quellen edit) oder entfernen (quellen rm)` : null,
    ...(problems.length ? { data: { keys: problems.map((q) => q.key) } } : {}),
  });

  const unchecked = relevant.filter((q) => !q.check || q.check.status === "unverified");
  add({
    id: "quellen.ungeprueft",
    title: "Quellen geprüft",
    status: unchecked.length ? "warn" : "ok",
    detail: unchecked.length ? `${unchecked.length} ${unchecked.length === 1 ? scope.replace(/Quellen$/, "Quelle") : scope} ungeprüft: ${unchecked.slice(0, 8).map((q) => q.key).join(", ")}${unchecked.length > 8 ? " …" : ""}` : `alle ${scopeAll} geprüft`,
    fix: unchecked.length ? "imstudium quellen check --save" : null,
  });

  const incomplete = relevant.map((q) => ({ key: q.key, missing: missingFields(q.csl) })).filter((x) => x.missing.length);
  add({
    id: "quellen.vollstaendig",
    title: "Angaben vollständig",
    status: incomplete.length ? "warn" : "ok",
    detail: incomplete.length ? incomplete.slice(0, 6).map((x) => `${x.key}: ${x.missing.join(", ")}`).join("; ") + (incomplete.length > 6 ? " …" : "") : `alle ${scopeAll} vollständig`,
    fix: incomplete.length ? `imstudium quellen edit ${incomplete[0]!.key} <feld>=<wert>` : null,
  });

  const dups = registryDuplicates(file);
  if (dups.size) {
    add({ id: "quellen.doppelt", title: "Keine Dubletten", status: "warn", detail: [...dups].map(([a, b]) => `${a} = ${b}`).join("; "), fix: `imstudium quellen rm ${[...dups.keys()][0]}` });
  }

  if (scan && report) {
    add({
      id: "zitate.unbekannt",
      title: "Jeder Beleg steht im Register",
      status: report.unknown.length ? "fail" : "ok",
      detail: report.unknown.length ? `nicht im Register: ${report.unknown.slice(0, 10).join(", ")}` : `${report.count} Belege, alle im Register`,
      fix: report.unknown.length ? "imstudium quellen add <DOI|ISBN> für jede fehlende Quelle (oder den Key im Manuskript korrigieren)" : null,
    });
    add({
      id: "zitate.unzitiert",
      title: "Jede Quelle wird zitiert",
      status: report.uncited.length ? "warn" : "ok",
      detail: report.uncited.length ? `im Register, aber nicht zitiert: ${report.uncited.slice(0, 10).join(", ")}${report.uncited.length > 10 ? " …" : ""}. Ins Literaturverzeichnis gehört nur, was zitiert wird.` : "jede Quelle im Register wird zitiert",
      fix: report.uncited.length ? "zitieren oder aus dem Register nehmen (imstudium quellen rm <key>)" : null,
    });
    if (scan.format !== "docx" || report.count) {
      add({
        id: "zitate.seitenangabe",
        title: "Belege mit Seitenangabe",
        status: report.withoutLocator.length ? "warn" : "ok",
        detail: report.withoutLocator.length ? `${report.withoutLocator.length} ${report.withoutLocator.length === 1 ? "Beleg" : "Belege"} gedruckter Werke ohne Seite: ${report.withoutLocator.slice(0, 8).map((w) => `${w.key}${w.line ? ` (Zeile ${w.line})` : ""}`).join(", ")}` : "jeder Beleg gedruckter Werke hat eine Seite",
        fix: report.withoutLocator.length ? (scan.format === "latex" ? "\\autocite[S.~12]{key}" : scan.format === "typst" ? "@key[S. 12]" : "[@key, S. 12]") : null,
      });
    }
    if (Object.values(report.matchedBy).includes("heuristic")) {
      add({ id: "zitate.erkennung", title: "Belege erkannt", status: "ok", detail: "Ohne Zitierfelder erkannt (Autor und Jahr im Text). Mit Zotero in Word, oder Pandoc, LaTeX oder Typst prüft ImStudium genau.", fix: null });
    }
    const f = arbeit.formvorgaben;
    const pages = estimatePages(scan.words, f);
    if (arbeit.umfang) {
      const u = arbeit.umfang;
      const actual = u.unit === "woerter" ? scan.words : u.unit === "zeichen" ? scan.chars : pages;
      const tol = (u.toleranz ?? 10) / 100;
      const low = u.value * (1 - tol);
      const high = u.value * (1 + tol);
      const unit = u.unit === "woerter" ? "Wörter" : u.unit === "zeichen" ? "Zeichen" : "Seiten (geschätzt)";
      add({
        id: "umfang",
        title: "Umfang",
        status: actual < low || actual > high ? "warn" : "ok",
        detail: `${u.unit === "seiten" ? `ca. ${pages}` : actual} ${unit}, verlangt ${u.value} ± ${Math.round(tol * 100)} %`,
        fix: actual > high ? "kürzen" : actual < low ? "ausbauen" : null,
        data: { words: scan.words, chars: scan.chars, pages },
      });
    } else {
      add({ id: "umfang", title: "Umfang", status: "ok", detail: `${scan.words} Wörter, ca. ${pages} Seiten Text`, fix: null, data: { words: scan.words, chars: scan.chars, pages } });
    }
    const normHeadings = scan.headings.map((h) => normalizeForCompare(h));
    const missingSections = f.pflichtabschnitte.filter((alt) => !alt.split("|").some((a) => normHeadings.some((h) => h.includes(normalizeForCompare(a)))));
    if (f.pflichtabschnitte.length) {
      add({
        id: "abschnitte",
        title: "Pflichtabschnitte",
        status: missingSections.length ? "warn" : "ok",
        detail: missingSections.length ? `keine Überschrift für: ${missingSections.map((m) => m.replace(/\|/g, "/")).join(", ")}` : "alle Pflichtabschnitte da",
        fix: missingSections.length ? "Überschrift ergänzen (oder imstudium arbeit formvorgaben set pflichtabschnitte=…)" : null,
      });
    }
    add({
      id: "literaturverzeichnis",
      title: "Literaturverzeichnis",
      status: scan.hasBibliography || scan.headings.some(isBibliographyHeading) ? "ok" : "warn",
      detail: scan.hasBibliography || scan.headings.some(isBibliographyHeading) ? "vorhanden" : "nicht gefunden",
      fix: scan.hasBibliography ? null : scan.format === "latex" ? "\\printbibliography" : scan.format === "typst" ? '#bibliography("quellen.bib")' : "imstudium literatur --format rtf (in Word einfügen) oder Zotero-Literaturverzeichnis",
    });
    if (f.erklaerung.erforderlich) {
      const has = /eigenst(ä|ae)ndigkeit|selbst(st)?(ä|ae)ndig verfasst|eidesstattlich|versicher(e|ung)/i.test(scan.text) || scan.headings.some((h) => /erkl(ä|ae)rung/i.test(h));
      add({ id: "erklaerung", title: "Eigenständigkeitserklärung", status: has ? "ok" : "warn", detail: has ? "gefunden" : "nicht gefunden (Wortlaut aus deiner Prüfungsordnung übernehmen)", fix: has ? null : "Erklärung am Ende einfügen; den Wortlaut gibt deine Prüfungsordnung vor" });
    }
  }

  if (arbeit.abgabe) {
    const d = daysUntil(arbeit.abgabe, now);
    const de = arbeit.abgabe.split("-").reverse().join(".");
    add({ id: "abgabe", title: "Abgabe", status: d < 0 ? "warn" : "ok", detail: d < 0 ? `Abgabe war vor ${-d} Tagen (${de})` : d === 0 ? "Abgabe ist heute" : `noch ${d} ${d === 1 ? "Tag" : "Tage"} bis ${de}`, fix: null });
  }
  if (arbeit.formvorgaben.erklaerung.kiAngabe) {
    add({
      id: "hilfsmittel",
      title: "Hilfsmittel angegeben",
      status: "ok",
      detail: arbeit.hilfsmittel.length ? `${arbeit.hilfsmittel.length} Hilfsmittel eingetragen` : "keine eingetragen. Falls du KI-Werkzeuge genutzt hast: eintragen, viele Prüfungsordnungen verlangen die Angabe",
      fix: arbeit.hilfsmittel.length ? null : 'imstudium arbeit hilfsmittel add "<Werkzeug>" --zweck "<wofür>"',
    });
  }
  return { checks, citations: report, pages: scan ? estimatePages(scan.words, arbeit.formvorgaben) : null };
}

