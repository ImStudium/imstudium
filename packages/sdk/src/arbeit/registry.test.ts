import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ARTICLE, BOOK } from "../test/arbeit-fixtures.js";
import { bibEntryToCsl, cslToBibEntry, latexToUnicode, parseBibtex, writeBibtex } from "./bibtex.js";
import { assignCitekey, baseCitekey, isValidCitekey, uniqueCitekey } from "./citekey.js";
import { parseName, parseNameList, similarity } from "./csl-util.js";
import { findDois, findIsbns, normalizeIsbn, parseIdentifier } from "./identifiers.js";
import { detectImportFormat, exportLibrary, parseCslJson, parseLibrary, parseRis } from "./interchange.js";
import { addQuelle, createArbeit, findDuplicate, getQuelle, listArbeiten, loadQuellen, parseAbgabe, parseUmfang, readArbeit, removeQuelle, renameQuelle, resolveArbeit, saveArbeit, setCurrentArbeit } from "./store.js";
import type { QuellenFile } from "./types.js";

const empty = (): QuellenFile => ({ schema: "imstudium/quellen/v1", updatedAt: "", items: [] });

describe("identifiers", () => {
  it("recognises DOIs in every common spelling", () => {
    for (const s of ["10.5555/abc.123", "doi:10.5555/ABC.123", "https://doi.org/10.5555/abc.123", "https://dx.doi.org/10.5555/abc.123."]) {
      expect(parseIdentifier(s), s).toMatchObject({ kind: "doi", value: "10.5555/abc.123" });
    }
  });
  it("keeps balanced brackets inside a DOI and drops trailing ones", () => {
    expect(parseIdentifier("10.5555/0002-9343(97)00135-4")?.value).toBe("10.5555/0002-9343(97)00135-4");
    expect(findDois("(siehe 10.5555/abc.1).")).toEqual(["10.5555/abc.1"]);
  });
  it("checks ISBN checksums and converts ISBN-10", () => {
    expect(normalizeIsbn("978-3-16-148410-0")).toBe("9783161484100");
    expect(normalizeIsbn("3-16-148410-X")).toBe("9783161484100");
    expect(normalizeIsbn("978-3-16-148410-1")).toBeNull();
    expect(parseIdentifier("ISBN 978-3-16-148410-0")).toMatchObject({ kind: "isbn", value: "9783161484100" });
    expect(findIsbns("Literatur: Müller (2021), ISBN 978-3-16-148410-0, und ISBN 978-3-16-148410-1")).toEqual(["9783161484100"]);
  });
  it("recognises arXiv ids and URLs", () => {
    expect(parseIdentifier("arXiv:2101.01234v2")).toMatchObject({ kind: "arxiv", value: "2101.01234" });
    expect(parseIdentifier("https://arxiv.org/abs/2101.01234")).toMatchObject({ kind: "arxiv", value: "2101.01234" });
    expect(parseIdentifier("https://example.org/artikel")).toMatchObject({ kind: "url" });
    expect(parseIdentifier("Müller 2021")).toBeNull();
  });
});

describe("citekeys and names", () => {
  it("builds Scholar-style ASCII keys with German folding", () => {
    expect(baseCitekey(BOOK)).toBe("mueller2021digitale");
    expect(baseCitekey({ title: "Der Einfluss von Lernen", author: [{ family: "Özdemir" }], issued: { "date-parts": [[2019]] } })).toBe("oezdemir2019einfluss");
    expect(baseCitekey({ title: "Ohne Autor" })).toBe("oaojohne");
    expect(isValidCitekey("mueller2021digitale")).toBe(true);
    expect(isValidCitekey("2021x")).toBe(false);
  });
  it("adds -b, -c on collisions and keeps a valid imported key", () => {
    expect(uniqueCitekey("a2020x", new Set(["a2020x"]))).toBe("a2020x-b");
    expect(uniqueCitekey("a2020x", new Set(["a2020x", "a2020x-b"]))).toBe("a2020x-c");
    expect(assignCitekey(BOOK, new Set(), "MuellerHandbuch2021")).toBe("MuellerHandbuch2021");
    expect(assignCitekey(BOOK, new Set(["MuellerHandbuch2021"]), "MuellerHandbuch2021")).toBe("mueller2021digitale");
  });
  it("parses names with particles and institutions", () => {
    expect(parseName("von Goethe, Johann Wolfgang")).toEqual({ "non-dropping-particle": "von", family: "Goethe", given: "Johann Wolfgang" });
    expect(parseName("Anna Maria von Müller")).toEqual({ family: "Müller", given: "Anna Maria", "non-dropping-particle": "von" });
    expect(parseName("{Deutsche Forschungsgemeinschaft}")).toEqual({ literal: "Deutsche Forschungsgemeinschaft" });
    expect(parseNameList("Müller, Anna; Schmidt, Bert")).toHaveLength(2);
  });
  it("scores similar titles high and different ones low", () => {
    expect(similarity("Digitale Lehre: Ein Handbuch", "Digitale Lehre. Ein Handbuch")).toBeGreaterThan(0.9);
    expect(similarity("Digitale Lehre", "Statistik für Einsteiger")).toBeLessThan(0.4);
  });
});

describe("BibTeX and BibLaTeX", () => {
  const bib = `@string{zfb = "Zeitschrift f{\\"u}r Beispiele"}
@comment{exported by a reference manager}
@article{SchmidtWeber2020,
  author = {Schmidt, Bert and Weber, Clara},
  title = {Lernen im {Netz}},
  journal = zfb,
  year = 2020, month = mar,
  volume = {12}, number = {3}, pages = {45--67},
  doi = {https://doi.org/10.5555/beispiel.2020.12},
}
@book{mueller2021,
  author = {M\\"uller, Anna and {Deutsche Forschungsgemeinschaft}},
  title = {Digitale Lehre},
  subtitle = {Ein Handbuch},
  date = {2021},
  location = {Augsburg}, publisher = {Synthetik Verlag},
  edition = {2}, isbn = {978-3-16-148410-0}, langid = {ngerman}
}
@phdthesis{kaya2019, author = "Kaya, Deniz", title = "Quellen \\& Belege", school = "Universit{\\"a}t Beispielstadt", year = "2019"}
@online{blog, title = {Ein Beitrag}, url = {https://example.org/a_b}, urldate = {2026-10-01}}
@misc{broken, title = {unterminated`;

  it("reads strings, macros, nested braces, accents, names and types", () => {
    const { entries, errors } = parseBibtex(bib);
    expect(entries.map((e) => e.key)).toEqual(["SchmidtWeber2020", "mueller2021", "kaya2019", "blog"]);
    expect(errors).toHaveLength(1);
    const [art, book, thesis, web] = entries.map(bibEntryToCsl);
    expect(art).toMatchObject({ type: "article-journal", title: "Lernen im Netz", "container-title": "Zeitschrift für Beispiele", issue: "3", page: "45-67", DOI: "10.5555/beispiel.2020.12", issued: { "date-parts": [[2020, 3]] } });
    expect(book!.author).toEqual([{ family: "Müller", given: "Anna" }, { literal: "Deutsche Forschungsgemeinschaft" }]);
    expect(book).toMatchObject({ title: "Digitale Lehre: Ein Handbuch", "publisher-place": "Augsburg", language: "de-DE" });
    expect(thesis).toMatchObject({ type: "thesis", genre: "Dissertation", publisher: "Universität Beispielstadt", title: "Quellen & Belege" });
    expect(web).toMatchObject({ type: "webpage", URL: "https://example.org/a_b", accessed: { "date-parts": [[2026, 10, 1]] } });
  });

  it("decodes common LaTeX into Unicode and CSL markup", () => {
    expect(latexToUnicode('Stra{\\ss}e, \\"{O}l, {\\\'e}t{\\\'e}, \\emph{kursiv}, 5--7, \\&')).toBe("Straße, Öl, été, <i>kursiv</i>, 5–7, &");
  });

  it("writes BibLaTeX that reads back to the same item", () => {
    const text = writeBibtex([cslToBibEntry(ARTICLE), cslToBibEntry({ ...BOOK, title: "50 % & mehr_über {Klammern}" })], "Kopfzeile");
    expect(text).toContain("% Kopfzeile");
    expect(text).toContain("journaltitle = {Zeitschrift für Beispiele}");
    expect(text).toContain("pages        = {45--67}");
    expect(text).toContain("50 \\% \\& mehr\\_über \\{Klammern\\}");
    const back = parseBibtex(text).entries.map(bibEntryToCsl);
    expect(back[0]).toMatchObject({ id: "schmidt2020lernen", type: "article-journal", title: "Lernen im Netz", issue: "3", page: "45-67", DOI: "10.5555/beispiel.2020.12" });
    expect(back[1]).toMatchObject({ title: "50 % & mehr_über {Klammern}", "publisher-place": "Augsburg" });
  });

  it("writes classic BibTeX on request", () => {
    const e = cslToBibEntry(ARTICLE, "bibtex");
    expect(e.fields).toMatchObject({ journal: "Zeitschrift für Beispiele", year: "2020", month: "3" });
    expect(e.fields.date).toBeUndefined();
  });
});

describe("RIS and CSL-JSON", () => {
  const ris = ["TY  - JOUR", "AU  - Schmidt, Bert", "AU  - Weber, Clara", "TI  - Lernen im Netz", "T2  - Zeitschrift für Beispiele", "PY  - 2020", "DA  - 2020/03/15/", "VL  - 12", "IS  - 3", "SP  - 45", "EP  - 67", "DO  - 10.5555/beispiel.2020.12", "ER  - ", "TY  - BOOK", "AU  - Müller,Anna", "TI  - Digitale Lehre", "PB  - Synthetik Verlag", "CY  - Augsburg", "SN  - 978-3-16-148410-0", "PY  - 2021", "ER  - "].join("\r\n");

  it("parses RIS from Citavi, EndNote or Mendeley", () => {
    const { items, errors } = parseRis(ris);
    expect(errors).toEqual([]);
    expect(items[0]).toMatchObject({ type: "article-journal", page: "45-67", issued: { "date-parts": [[2020, 3, 15]] }, DOI: "10.5555/beispiel.2020.12" });
    expect(items[1]).toMatchObject({ type: "book", author: [{ family: "Müller", given: "Anna" }], ISBN: "978-3-16-148410-0" });
  });

  it("detects formats and round-trips through every export", () => {
    expect(detectImportFormat(ris)).toBe("ris");
    expect(detectImportFormat("@book{a, title={x}}")).toBe("bibtex");
    expect(detectImportFormat("[]", "zotero.json")).toBe("csl-json");
    for (const format of ["biblatex", "bibtex", "ris", "csl-json"] as const) {
      const text = exportLibrary([ARTICLE, BOOK], format);
      const parsed = parseLibrary(text, format === "biblatex" || format === "bibtex" ? "bibtex" : format);
      expect(parsed.items.map((i) => i.title), format).toEqual(["Lernen im Netz", "Digitale Lehre: Ein Handbuch"]);
    }
  });

  it("accepts Zotero's CSL-JSON array and a registry export", () => {
    expect(parseCslJson(JSON.stringify([ARTICLE])).items[0]!.id).toBe("schmidt2020lernen");
    expect(parseCslJson(JSON.stringify([{ key: "k1", csl: { ...BOOK, id: "x" } }])).items[0]!.title).toBe(BOOK.title);
    expect(parseCslJson("{nope").errors[0]).toMatch(/not valid JSON/);
    expect(parseCslJson(JSON.stringify([{ title: "no type" }])).errors[0]).toMatch(/no "type"/);
  });
});

describe("registry store", () => {
  async function workspace() {
    const ws = await mkdtemp(join(tmpdir(), "imstudium-arbeit-"));
    await mkdir(join(ws, ".imstudium"), { recursive: true });
    return ws;
  }

  it("creates an Arbeit with registry, bib file and brief, and finds it again", async () => {
    const ws = await workspace();
    const ref = await createArbeit(ws, { title: "Digitale Lehre im Vergleich", typ: "seminararbeit", abgabe: "2027-03-15", umfang: parseUmfang("15 Seiten") });
    expect(ref.dir).toBe(join(ws, "arbeiten", "digitale-lehre-im-vergleich"));
    expect(ref.arbeit).toMatchObject({ typ: "seminararbeit", stil: { id: "apa", file: null, class: "in-text" }, sprache: "de-DE", formvorgaben: { preset: "standard" } });
    expect(await readFile(join(ref.dir, "quellen.bib"), "utf-8")).toContain("0 Quellen");
    expect(await readFile(join(ref.dir, "ARBEIT.md"), "utf-8")).toContain("# Digitale Lehre im Vergleich");
    expect((await resolveArbeit(ws, { cwd: ws })).dir).toBe(ref.dir);
    expect((await resolveArbeit(ws, { arbeit: "vergleich", cwd: ws })).dir).toBe(ref.dir);
  });

  it("adds sources with keys, detects duplicates, renames and removes", async () => {
    const ws = await workspace();
    const ref = await createArbeit(ws, { title: "Test" });
    const q = await loadQuellen(ref.dir);
    const { id: _a, ...article } = ARTICLE;
    const first = addQuelle(q, article, { via: "doi", ref: ARTICLE.DOI, service: "doi.org" });
    expect(first).toMatchObject({ duplicate: false, quelle: { key: "schmidt2020lernen", origin: { via: "doi" } } });
    expect(addQuelle(q, { ...article, DOI: "10.5555/BEISPIEL.2020.12" }, { via: "doi" }).duplicate).toBe(true);
    expect(findDuplicate(q, { type: "article-journal", title: "Lernen im Netz.", author: [{ family: "Schmidt" }], issued: { "date-parts": [[2020]] } })?.key).toBe("schmidt2020lernen");
    addQuelle(q, { ...article, DOI: undefined, title: "Lernen im Netz II", issued: { "date-parts": [[2020]] } }, { via: "manual" });
    expect(q.items.map((x) => x.key)).toEqual(["schmidt2020lernen", "schmidt2020lernen-b"]);
    expect(() => addQuelle(q, BOOK, { via: "manual" }, { key: "schmidt2020lernen" })).toThrow(/taken/);
    renameQuelle(q, "schmidt2020lernen-b", "schmidt2020netz");
    expect(getQuelle(q, "SCHMIDT2020NETZ").csl.id).toBe("schmidt2020netz");
    removeQuelle(q, "schmidt2020netz");
    expect(() => getQuelle(q, "schmidt2020netz")).toThrow(/No source/);
    await saveArbeit(ref, q);
    const bib = await readFile(join(ref.dir, "quellen.bib"), "utf-8");
    expect(bib).toContain("@article{schmidt2020lernen,");
    expect((await loadQuellen(ref.dir)).items).toHaveLength(1);
  });

  it("keeps the brief's student notes across rewrites", async () => {
    const ws = await workspace();
    const ref = await createArbeit(ws, { title: "Notizen" });
    const brief = join(ref.dir, "ARBEIT.md");
    await writeFile(brief, (await readFile(brief, "utf-8")).replace(/## Student notes\n\n/, "## Student notes\n\nBetreuerin will Kapitel 2 kürzer.\n"));
    await saveArbeit(ref, await loadQuellen(ref.dir));
    expect(await readFile(brief, "utf-8")).toContain("Betreuerin will Kapitel 2 kürzer.");
  });

  it("asks which Arbeit when several exist, and remembers the chosen one", async () => {
    const ws = await workspace();
    const a = await createArbeit(ws, { title: "Erste Arbeit" });
    const b = await createArbeit(ws, { title: "Zweite Arbeit", dir: join(ws, "..", `latex-${Date.now()}`) });
    expect((await listArbeiten(ws)).map((r) => r.arbeit.slug).sort()).toEqual(["erste-arbeit", "zweite-arbeit"]);
    // createArbeit made the second one current
    expect((await resolveArbeit(ws, { cwd: ws })).dir).toBe(b.dir);
    await setCurrentArbeit(ws, a);
    expect((await resolveArbeit(ws, { cwd: ws })).dir).toBe(a.dir);
    await writeFile(join(ws, ".imstudium", "arbeiten.json"), JSON.stringify({ current: null, extern: [b.dir] }));
    await expect(resolveArbeit(ws, { cwd: ws })).rejects.toMatchObject({ code: "ARBEIT_AMBIGUOUS" });
    expect((await resolveArbeit(ws, { cwd: b.dir })).dir).toBe(b.dir);
    expect(await readArbeit(join(ws, "nichts"))).toBeNull();
  });

  it("parses lengths and dates the way students write them", () => {
    expect(parseUmfang("6000w")).toEqual({ value: 6000, unit: "woerter" });
    expect(parseUmfang("40.000 Zeichen".replace(".", ""))).toEqual({ value: 40000, unit: "zeichen" });
    expect(parseUmfang("12,5s", 10)).toEqual({ value: 12.5, unit: "seiten", toleranz: 10 });
    expect(parseAbgabe("15.3.2027")).toBe("2027-03-15");
    expect(() => parseAbgabe("März")).toThrow(/Cannot read/);
  });
});
