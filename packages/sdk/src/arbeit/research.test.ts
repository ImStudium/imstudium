import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ARTICLE, BOOK, CROSSREF_RETRACTED, DNB_SRU, DOI_CSL, PAGE_HTML, fakeFetch } from "../test/arbeit-fixtures.js";
import { checkArbeit, checkQuellen, estimatePages, missingFields, verifyQuelle } from "./check.js";
import { courseReferences } from "./course.js";
import { applyFormvorgaben, formvorgabenLines, formvorgabenPreset } from "./formvorgaben.js";
import { CitationFormatter, htmlToMarkdown, parseLocator } from "./format.js";
import { scanDocxBuffer, scanLatexSource, scanMarkdown, scanTypst } from "./manuscript.js";
import { crossrefWork, marcToCsl, resolveArxiv, resolveDoi, resolveIsbn, resolveUrl, searchCrossref } from "./resolve.js";
import { bundledStyles, describeCsl, fetchStyle, loadStyle, searchStyles } from "./styles.js";
import type { Arbeit, Quelle, QuellenFile } from "./types.js";
import { docxTemplate, latexTemplate, markdownSkeleton, typstTemplate } from "./vorlage.js";
import { readZipEntries, writeZip } from "./zip.js";

const quelle = (csl: Quelle["csl"], check?: Quelle["check"]): Quelle => ({ key: csl.id, csl, origin: { via: "manual", at: "2026-10-24T00:00:00Z" }, ...(check ? { check } : {}), added: "", updated: "" });
const file = (...items: Quelle[]): QuellenFile => ({ schema: "imstudium/quellen/v1", updatedAt: "", items });

const arbeit = (patch: Partial<Arbeit> = {}): Arbeit => ({
  schema: "imstudium/arbeit/v1",
  slug: "test",
  title: "Digitale Lehre im Vergleich",
  typ: "hausarbeit",
  sprache: "de-DE",
  course: null,
  betreuung: null,
  abgabe: "2027-03-15",
  umfang: { value: 12, unit: "seiten", toleranz: 10 },
  stil: { id: "apa", title: "APA", file: null, class: "in-text" },
  formvorgaben: formvorgabenPreset("standard"),
  manuskript: null,
  hilfsmittel: [],
  created: "",
  updated: "",
  ...patch,
});

describe("metadata services (fake fetch, no network)", () => {
  it("resolves a DOI through doi.org content negotiation and tidies the record", async () => {
    const fetch = fakeFetch({ "https://doi.org/10.5555/beispiel.2020.12": [200, JSON.stringify(DOI_CSL)] });
    const r = await resolveDoi("https://doi.org/10.5555/BEISPIEL.2020.12", { fetch });
    expect(r.origin).toEqual({ via: "doi", ref: "10.5555/beispiel.2020.12", service: "doi.org" });
    expect(r.item).toMatchObject({ type: "article-journal", title: "Lernen im <i>Netz</i>", DOI: "10.5555/beispiel.2020.12" });
    expect(r.item.reference).toBeUndefined();
    expect(r.item.author).toEqual([{ family: "Schmidt", given: "Bert" }, { family: "Weber", given: "Clara" }]);
  });

  it("says METADATA_NOT_FOUND for an unknown DOI and METADATA_UNAVAILABLE offline", async () => {
    await expect(resolveDoi("10.5555/gibtsnicht", { fetch: fakeFetch({}) })).rejects.toMatchObject({ code: "METADATA_NOT_FOUND" });
    await expect(resolveDoi("10.5555/x", { fetch: fakeFetch({ "https://doi.org/": new TypeError("fetch failed") }) })).rejects.toMatchObject({ code: "METADATA_UNAVAILABLE" });
  });

  it("maps arXiv ids to their DataCite DOI", async () => {
    const fetch = fakeFetch({ "https://doi.org/10.48550/arxiv.2101.01234": [200, JSON.stringify({ type: "article", title: "Ein Preprint", author: [{ family: "Kaya", given: "Deniz" }] })] });
    const r = await resolveArxiv("2101.01234", { fetch });
    expect(r).toMatchObject({ origin: { via: "arxiv", ref: "2101.01234" }, item: { URL: "https://arxiv.org/abs/2101.01234" } });
  });

  it("reads Crossref retraction notices (updated-by)", async () => {
    const fetch = fakeFetch({ "https://api.crossref.org/works/10.5555%2Fzurueck.2019.1": [200, JSON.stringify(CROSSREF_RETRACTED)] });
    const w = await crossrefWork("10.5555/zurueck.2019.1", { fetch });
    expect(w?.notices).toEqual([{ type: "retraction", doi: "10.5555/zurueck.notice", date: "2024-05-02", source: "retraction-watch" }]);
    expect(await crossrefWork("10.5555/datacite", { fetch })).toBeNull();
  });

  it("reads an ISBN from the DNB's MARC 21 and falls back to Open Library", async () => {
    const item = marcToCsl(DNB_SRU)!;
    expect(item).toMatchObject({ type: "book", title: "Die digitale Lehre: ein Handbuch", author: [{ family: "Müller", given: "Anna" }], editor: [{ family: "Weber", given: "Clara" }], publisher: "Synthetik Verlag", "publisher-place": "Augsburg", edition: "2. Auflage", "number-of-pages": "345", "collection-title": "Beispielreihe", "collection-number": "7", language: "de-DE", issued: { "date-parts": [[2021]] } });
    const dnb = fakeFetch({ "https://services.dnb.de/sru/dnb": [200, DNB_SRU] });
    expect((await resolveIsbn("9783161484100", { fetch: dnb })).origin.service).toBe("dnb");
    expect(dnb.calls[0]).toContain("query=isbn%3D9783161484100");
    const ol = fakeFetch({
      "https://services.dnb.de/sru/dnb": [200, "<searchRetrieveResponse><numberOfRecords>0</numberOfRecords></searchRetrieveResponse>"],
      "https://openlibrary.org/api/books": [200, JSON.stringify({ "ISBN:9783161484100": { title: "Digital Teaching", authors: [{ name: "Anna Müller" }], publishers: [{ name: "Example Press" }], publish_date: "March 2021" } })],
    });
    expect(await resolveIsbn("9783161484100", { fetch: ol })).toMatchObject({ origin: { service: "openlibrary" }, item: { title: "Digital Teaching", author: [{ family: "Müller", given: "Anna" }] } });
    await expect(resolveIsbn("9783161484100", { fetch: fakeFetch({}) })).rejects.toMatchObject({ code: "METADATA_NOT_FOUND" });
  });

  it("builds a webpage from meta tags with today as the access date", async () => {
    const fetch = fakeFetch({ "https://blog.example/": [200, PAGE_HTML] });
    const r = await resolveUrl("https://blog.example/beitrag", { fetch, now: new Date(2026, 9, 24) });
    expect(r.item).toMatchObject({ type: "webpage", title: "Warum Quellen zählen", "container-title": "Beispielblog", author: [{ family: "Kaya", given: "Deniz" }], issued: { "date-parts": [[2025, 11, 3]] }, accessed: { "date-parts": [[2026, 10, 24]] } });
  });

  it("follows a page's citation_doi to doi.org", async () => {
    const fetch = fakeFetch({
      "https://journal.example/": [200, '<meta name="citation_doi" content="10.5555/beispiel.2020.12">'],
      "https://doi.org/10.5555/beispiel.2020.12": [200, JSON.stringify(DOI_CSL)],
    });
    const r = await resolveUrl("https://journal.example/a/1", { fetch });
    expect(r.origin.service).toBe("doi.org");
    expect(r.item.URL).toBe("https://journal.example/a/1");
  });

  it("searches Crossref and maps its work types to CSL", async () => {
    const fetch = fakeFetch({ "https://api.crossref.org/works?": [200, JSON.stringify({ message: { items: [{ DOI: "10.5555/beispiel.2020.12", type: "journal-article", title: ["Lernen im Netz"], author: [{ family: "Schmidt", given: "Bert" }], issued: { "date-parts": [[2020]] }, score: 42 }] } })] });
    const hits = await searchCrossref("Schmidt Lernen im Netz 2020", { fetch, mailto: "student@example.org" });
    expect(hits[0]).toMatchObject({ doi: "10.5555/beispiel.2020.12", score: 42, item: { type: "article-journal", title: "Lernen im Netz" } });
    expect(fetch.calls[0]).toContain("query.bibliographic=");
    expect(fetch.calls[0]).toContain("mailto=student%40example.org");
  });
});

describe("verification", () => {
  const routes = {
    "https://doi.org/10.5555/beispiel.2020.12": [200, JSON.stringify(DOI_CSL)] as [number, string],
    "https://api.crossref.org/works/10.5555%2Fbeispiel.2020.12": [200, JSON.stringify({ message: { "updated-by": [{ type: "correction", DOI: "10.5555/korr" }] } })] as [number, string],
    "https://doi.org/10.5555/zurueck.2019.1": [200, JSON.stringify({ ...DOI_CSL, title: "Zurückgezogene Studie", DOI: "10.5555/zurueck.2019.1" })] as [number, string],
    "https://api.crossref.org/works/10.5555%2Fzurueck.2019.1": [200, JSON.stringify(CROSSREF_RETRACTED)] as [number, string],
    "https://services.dnb.de/sru/dnb": [200, DNB_SRU] as [number, string],
  };
  const opts = { fetch: fakeFetch(routes), now: new Date("2026-10-24T10:00:00Z") };

  it("verifies a matching DOI and notes a correction", async () => {
    const c = await verifyQuelle(quelle(ARTICLE), opts);
    expect(c).toMatchObject({ status: "verified", service: "doi.org" });
    expect(c.notices?.[0]?.type).toBe("correction");
  });
  it("flags a DOI that belongs to another work", async () => {
    const c = await verifyQuelle(quelle({ ...ARTICLE, title: "Ein ganz anderer Titel über Statistik", author: [{ family: "Erfunden" }] }), opts);
    expect(c.status).toBe("mismatch");
    expect(c.differences?.map((d) => d.field)).toEqual(["title", "author"]);
  });
  it("flags an invented DOI and a retracted paper", async () => {
    expect((await verifyQuelle(quelle({ ...ARTICLE, DOI: "10.5555/erfunden.2023" }), opts)).status).toBe("not-found");
    const r = await verifyQuelle(quelle({ ...ARTICLE, title: "Zurückgezogene Studie", DOI: "10.5555/zurueck.2019.1" }), opts);
    expect(r.status).toBe("retracted");
    expect(r.detail).toContain("Retraction Watch");
  });
  it("checks a book by ISBN and a bad checksum offline", async () => {
    expect((await verifyQuelle(quelle({ ...BOOK, title: "Die digitale Lehre: ein Handbuch" }), opts)).status).toBe("verified");
    expect((await verifyQuelle(quelle({ ...BOOK, ISBN: "978-3-16-148410-1" }), opts)).status).toBe("not-found");
  });
  it("lists missing fields per type and finds registry duplicates offline", async () => {
    expect(missingFields({ id: "w", type: "webpage", title: "Seite", URL: "https://example.org" })).toEqual(["Abrufdatum"]);
    expect(missingFields({ id: "b", type: "book", title: "Buch", author: [{ family: "A" }], issued: { "date-parts": [[2020]] } })).toEqual(["Verlag bzw. Hochschule", "Verlagsort"]);
    const results = await checkQuellen(file(quelle(ARTICLE), quelle({ ...ARTICLE, id: "dup" })), { offline: true });
    expect(results[1]).toMatchObject({ key: "dup", duplicateOf: "schmidt2020lernen", check: null });
  });
});

describe("CSL formatting", () => {
  it("ships the curated styles with titles and classes", async () => {
    const styles = await bundledStyles();
    expect(styles.map((s) => s.id)).toEqual(expect.arrayContaining(["apa", "chicago-notes-bibliography", "deutsche-gesellschaft-fur-psychologie", "ieee", "juristische-zitierweise"]));
    expect(styles.find((s) => s.id === "juristische-zitierweise")).toMatchObject({ class: "note", locale: "de-DE" });
    await expect(loadStyle("gibts-nicht")).rejects.toMatchObject({ code: "STYLE_NOT_FOUND" });
  });

  it("formats in-text citations and a German APA bibliography", async () => {
    const f = await CitationFormatter.create({ style: "apa", items: [BOOK, ARTICLE] });
    expect(f.cite([{ key: "schmidt2020lernen", locator: "S. 50" }])).toBe("(Schmidt & Weber, 2020, S. 50)");
    expect(f.cite([{ key: "mueller2021digitale" }, { key: "schmidt2020lernen", locator: "12-14" }])).toBe("(Müller, 2021; Schmidt & Weber, 2020, S. 12–14)");
    const bib = f.bibliography();
    expect(bib.entries.map((e) => e.key)).toEqual(["mueller2021digitale", "schmidt2020lernen"]);
    expect(bib.text).toContain("Müller, A. (2021). Digitale Lehre: Ein Handbuch (2. Aufl.). Synthetik Verlag.");
    expect(() => f.cite([{ key: "fehlt" }])).toThrow(/No source/);
  });

  it("renders footnote styles with first, later and ebd. positions", async () => {
    const f = await CitationFormatter.create({ style: "chicago-notes-bibliography", items: [BOOK, ARTICLE] });
    expect(f.style.class).toBe("note");
    const first = f.cite([{ key: "schmidt2020lernen", locator: "50" }]);
    expect(first).toContain("„Lernen im Netz“");
    expect(f.cite([{ key: "schmidt2020lernen", locator: "51" }], "subsequent").length).toBeLessThan(first.length);
  });

  it("numbers IEEE references and writes markdown and RTF", async () => {
    const f = await CitationFormatter.create({ style: "ieee", items: [BOOK, ARTICLE], format: "markdown" });
    expect(f.cite([{ key: "schmidt2020lernen" }])).toBe("[2]");
    expect(f.bibliography().text).toMatch(/^\[1\] A\. Müller, \*Digitale Lehre: Ein Handbuch\*/);
    const rtf = (await CitationFormatter.create({ style: "apa", items: [BOOK], format: "rtf" })).bibliography().text;
    expect(rtf.startsWith("{\\rtf1")).toBe(true);
  });

  it("reads locators the way German texts write them", () => {
    expect(parseLocator("S. 12-14")).toEqual({ locator: "12-14", label: "page" });
    expect(parseLocator("Rn. 7")).toEqual({ locator: "7", label: "paragraph" });
    expect(parseLocator("Kap. 3")).toEqual({ locator: "3", label: "chapter" });
    expect(parseLocator("§ 823")).toEqual({ locator: "823", label: "section" });
    expect(htmlToMarkdown('<div class="csl-entry">A &#38; B, <i>T</i></div>')).toBe("A & B, *T*");
  });

  it("swaps a dependent style for its parent and finds styles by words", async () => {
    const dep = `<?xml version="1.0"?><style xmlns="http://purl.org/net/xbiblio/csl" version="1.0" default-locale="de-DE"><info><title>Beispiel-Lehrstuhl</title><link href="http://www.zotero.org/styles/beispiel-lehrstuhl" rel="self"/><link href="http://www.zotero.org/styles/apa" rel="independent-parent"/></info></style>`;
    expect(describeCsl(dep, "beispiel-lehrstuhl", "file", "")).toMatchObject({ parent: "apa", locale: "de-DE", title: "Beispiel-Lehrstuhl" });
    const dir = await mkdtemp(join(tmpdir(), "imstudium-stil-"));
    await mkdir(join(dir, "stil"));
    await writeFile(join(dir, "stil", "beispiel-lehrstuhl.csl"), dep);
    const loaded = await loadStyle("beispiel-lehrstuhl", dir);
    expect(loaded.info).toMatchObject({ id: "beispiel-lehrstuhl", source: "arbeit", class: "in-text" });
    expect(loaded.xml).toContain("APA Style");
    const fetched = await fetchStyle("beispiel-lehrstuhl", { fetch: fakeFetch({ "https://raw.githubusercontent.com/citation-style-language/styles/master/dependent/beispiel-lehrstuhl.csl": [200, dep], "https://raw.githubusercontent.com/citation-style-language/styles/master/apa.csl": [200, "<style class=\"in-text\"><info><title>APA</title></info></style>"] }) });
    expect(fetched.parent?.id).toBe("apa");
    const hits = await searchStyles(["Technische Universität", "Dresden"], { listing: ["technische-universitat-dresden-linguistik.csl", "dependent/technische-universitat-dresden-medizin.csl", "apa.csl"] });
    expect(hits).toEqual([{ id: "technische-universitat-dresden-linguistik", dependent: false }, { id: "technische-universitat-dresden-medizin", dependent: true }]);
  });
});

describe("manuscripts", () => {
  it("reads Pandoc citations with locators, headings and length", () => {
    const md = ["---", "title: Test", "---", "# Einleitung", "", "Wie [@schmidt2020lernen, S. 50; vgl. @mueller2021digitale] zeigen,", "und @schmidt2020lernen [S. 51] betont. Mail: a@b.de", "", "```", "@nichtzitiert", "```", "", "# Fazit", "", "Ende.[^1]", "", "[^1]: Eine Fußnote.", "", "# Literatur", ""].join("\n");
    const s = scanMarkdown(md);
    expect(s.citations.map((c) => [c.key, c.locator ?? null, c.line])).toEqual([
      ["schmidt2020lernen", "S. 50", 6],
      ["mueller2021digitale", null, 6],
      ["schmidt2020lernen", "S. 51", 7],
    ]);
    expect(s.headings).toEqual(["Einleitung", "Fazit", "Literatur"]);
    expect(s.hasBibliography).toBe(true);
    expect(s.footnoteWords).toBe(2);
  });

  it("reads biblatex cite commands with pre- and postnotes", () => {
    const tex = "\\begin{document}\n\\section{Einleitung}\nText \\autocite[S.~50]{schmidt2020lernen} und \\textcite[vgl.][12]{mueller2021digitale}.\n% \\cite{auskommentiert}\n\\autocites[3]{a}[4]{b}\n\\nocite{*}\n\\printbibliography\n\\end{document}";
    const s = scanLatexSource(tex);
    expect(s.citations.map((c) => [c.key, c.locator ?? null])).toEqual([["schmidt2020lernen", "S. 50"], ["mueller2021digitale", "12"], ["a", "3"], ["b", "4"]]);
    expect(s).toMatchObject({ citesAll: true, hasBibliography: true, headings: ["Einleitung"] });
  });

  it("reads Typst citations", () => {
    const typ = '= Einleitung\nWie @schmidt2020lernen[S. 50] und #cite(<mueller2021digitale>) zeigen. // @kommentar\n#bibliography("quellen.bib")\n';
    const s = scanTypst(typ);
    expect(s.citations.map((c) => [c.key, c.locator ?? null])).toEqual([["schmidt2020lernen", "S. 50"], ["mueller2021digitale", null]]);
    expect(s.hasBibliography).toBe(true);
  });

  it("reads a .docx with a Zotero field and footnotes", () => {
    const field = `ADDIN ZOTERO_ITEM CSL_CITATION {"citationID":"x","citationItems":[{"id":1,"itemData":${JSON.stringify({ ...ARTICLE, id: 1 })},"locator":"50","label":"page"}]}`.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
    const doc = `<?xml version="1.0"?><w:document xmlns:w="w"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Einleitung</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">Lernen ist wichtig </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve">${field.slice(0, 40)}</w:instrText></w:r><w:r><w:instrText>${field.slice(40)}</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>(Schmidt &amp; Weber, 2020, S. 50)</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:t>, sagt Müller (2021).</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="berschrift1"/></w:pPr><w:r><w:t>Literaturverzeichnis</w:t></w:r></w:p></w:body></w:document>`;
    const foot = `<w:footnotes xmlns:w="w"><w:footnote w:id="1"><w:p><w:r><w:t>Vgl. Kaya 2019, S. 3.</w:t></w:r></w:p></w:footnote></w:footnotes>`;
    const buf = writeZip([{ name: "word/document.xml", data: doc }, { name: "word/footnotes.xml", data: foot }]);
    const s = scanDocxBuffer(buf);
    expect(s.headings).toEqual(["Einleitung", "Literaturverzeichnis"]);
    expect(s.citations).toHaveLength(1);
    expect(s.citations[0]).toMatchObject({ via: "field", locator: "50", item: { DOI: "10.5555/beispiel.2020.12" } });
    expect(s.text).toContain("Vgl. Kaya 2019");
    expect(s.footnoteWords).toBe(5);
  });
});

describe("checking an Arbeit", () => {
  const verified = { status: "verified" as const, at: "" };
  it("matches citations to the registry and reports what is missing", () => {
    const md = "# Einleitung\n\nText [@schmidt2020lernen] und [@erfunden2023, S. 3].\n\n# Hauptteil\n\nMehr.\n\n# Literatur\n";
    const reg = file(quelle(ARTICLE, verified), quelle(BOOK));
    const { checks, citations } = checkArbeit(arbeit(), reg, scanMarkdown(md), new Date("2026-10-24T10:00:00Z"));
    expect(citations).toMatchObject({ cited: ["schmidt2020lernen"], unknown: ["erfunden2023"], uncited: ["mueller2021digitale"], withoutLocator: [{ key: "schmidt2020lernen", line: 3 }] });
    const by = Object.fromEntries(checks.map((c) => [c.id, c.status]));
    expect(by).toMatchObject({ "zitate.unbekannt": "fail", "zitate.unzitiert": "warn", "zitate.seitenangabe": "warn", "quellen.ungeprueft": "ok", abschnitte: "warn", literaturverzeichnis: "ok", erklaerung: "warn", umfang: "warn", abgabe: "ok" });
    expect(checks.find((c) => c.id === "abschnitte")!.detail).toContain("Fazit");
  });

  it("fails on a retracted cited source and recognises plain-text cites in Word", () => {
    const reg = file(quelle(ARTICLE, { status: "retracted", at: "" }), quelle(BOOK, verified));
    const text = { path: "a.docx", format: "docx" as const, words: 4000, chars: 20000, footnoteWords: 0, headings: ["Einleitung", "Fazit", "Literaturverzeichnis", "Eigenständigkeitserklärung"], citations: [], citesAll: false, hasBibliography: true, text: "Wie Müller (2021, S. 4) und Schmidt und Weber (2020) zeigen. Ich versichere, die Arbeit selbstständig verfasst zu haben." };
    const { checks, citations } = checkArbeit(arbeit(), reg, text);
    expect(citations?.matchedBy).toEqual({ mueller2021digitale: "heuristic", schmidt2020lernen: "heuristic" });
    const by = Object.fromEntries(checks.map((c) => [c.id, c.status]));
    expect(by).toMatchObject({ "quellen.probleme": "fail", erklaerung: "ok", abschnitte: "ok", umfang: "ok" });
  });

  it("estimates pages from the Formvorgaben", () => {
    expect(estimatePages(3300, formvorgabenPreset("standard"))).toBeCloseTo(9.6, 0);
    expect(estimatePages(3300, formvorgabenPreset("apa7"))).toBeGreaterThan(estimatePages(3300, formvorgabenPreset("standard")));
    expect(estimatePages(3300, formvorgabenPreset("juristisch"))).toBeGreaterThan(estimatePages(3300, formvorgabenPreset("standard")));
  });
});

describe("Formvorgaben and templates", () => {
  it("applies key=value changes with types and refuses unknown fields", () => {
    const f = applyFormvorgaben(formvorgabenPreset("standard"), ["rand.links=4", "schrift.familie=Arial", "zeilenabstand=1,5", "silbentrennung=nein", "hinweise+=Internetquellen max. 20 %", "nummerierung=juristisch"]);
    expect(f).toMatchObject({ rand: { links: 4 }, schrift: { familie: "Arial" }, zeilenabstand: 1.5, silbentrennung: false, nummerierung: "juristisch", hinweise: ["Internetquellen max. 20 %"] });
    expect(() => applyFormvorgaben(f, ["rand.mitte=3"])).toThrow(/Unknown Formvorgaben field/);
    expect(() => applyFormvorgaben(f, ["nummerierung=roemisch"])).toThrow(/expects one of/);
    expect(formvorgabenLines(f)[0]).toBe("Ränder: oben 2,5 cm · unten 2 cm · links 4 cm · rechts 3,5 cm");
  });

  it("writes a Word template that reads back with margins, styles and the bibliography", () => {
    const ref = { dir: "/tmp/x", inWorkspace: true, arbeit: arbeit({ hilfsmittel: [{ werkzeug: "DeepL Write", zweck: "Rechtschreibung", teile: "Kapitel 2", at: "2026-10-24T00:00:00Z" }] }) };
    const buf = docxTemplate({ ref, bibliographyHtml: ['<div class="csl-entry">Müller, A. (2021). <i>Digitale Lehre</i>. Synthetik Verlag.</div>'], exampleCite: "(Müller, 2021, S. 12)" });
    const files = readZipEntries(buf);
    expect([...files.keys()]).toEqual(expect.arrayContaining(["[Content_Types].xml", "word/document.xml", "word/styles.xml", "word/numbering.xml", "word/footnotes.xml"]));
    const doc = files.get("word/document.xml")!.toString("utf8");
    expect(doc).toContain('w:left="1418"'); // 2.5 cm
    expect(doc).toContain('w:right="1985"'); // 3.5 cm
    expect(doc).toContain('w:fmt="upperRoman"');
    expect(doc).toContain("<w:i/>");
    expect(doc).toContain("DeepL Write");
    const styles = files.get("word/styles.xml")!.toString("utf8");
    expect(styles).toContain('w:line="360"'); // 1.5 lines
    expect(styles).toContain('w:ascii="Times New Roman"');
    const scan = scanDocxBuffer(buf);
    expect(scan.headings).toEqual(expect.arrayContaining(["Einleitung", "Hauptteil", "Fazit"]));
  });

  it("writes LaTeX, Typst and Markdown skeletons from the same rules", () => {
    const ref = { dir: "/tmp/x", inWorkspace: true, arbeit: arbeit({ formvorgaben: formvorgabenPreset("juristisch"), stil: { id: "juristische-zitierweise", title: "Juristische Zitierweise", file: null, class: "note" } }) };
    const tex = latexTemplate({ ref, exampleKey: "mueller2021digitale" });
    expect(tex).toContain("left=7cm");
    expect(tex).toContain("\\addbibresource{../quellen.bib}");
    expect(tex).toContain("\\renewcommand*{\\thesection}{\\Alph{section}.}");
    expect(tex.indexOf("\\printbibliography")).toBeLessThan(tex.indexOf("\\section{"));
    const typ = typstTemplate({ ref, exampleKey: "mueller2021digitale" });
    expect(typ).toContain("left: 7cm");
    expect(typ).toContain('style: "../stil/juristische-zitierweise.csl"');
    expect(typ).toContain("#set heading(numbering: jura)");
    expect(markdownSkeleton({ ref, exampleKey: "k" })).toContain("[@k, S. 12]");
  });
});

describe("the course as a source", () => {
  it("finds DOIs and ISBNs in a course's extracted material with page numbers", async () => {
    const ws = await mkdtemp(join(tmpdir(), "imstudium-kurs-"));
    const dir = join(ws, "WS2026-27", "statistik-i", "extracted", "Literatur-pdf");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "manifest.json"), JSON.stringify({ source: join(ws, "WS2026-27", "statistik-i", "files", "Literatur.pdf") }));
    await writeFile(join(dir, "content.md"), "## Page 1\n\nEinführung\n\n## Page 2\n\nSchmidt, B. (2020): Lernen im Netz. https://doi.org/10.5555/beispiel.2020.12.\nMüller, A. (2021): Digitale Lehre. ISBN 978-3-16-148410-0\n");
    const refs = await courseReferences(ws, "WS2026-27/statistik-i");
    expect(refs).toEqual([
      { kind: "doi", id: "10.5555/beispiel.2020.12", file: "WS2026-27/statistik-i/files/Literatur.pdf", page: 2, context: "Schmidt, B. (2020): Lernen im Netz. https://doi.org/10.5555/beispiel.2020.12." },
      { kind: "isbn", id: "9783161484100", file: "WS2026-27/statistik-i/files/Literatur.pdf", page: 2, context: "Müller, A. (2021): Digitale Lehre. ISBN 978-3-16-148410-0" },
    ]);
    expect(await courseReferences(ws, "WS2026-27/fehlt")).toEqual([]);
  });
});
