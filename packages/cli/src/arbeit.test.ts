import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { CLI_OUTPUTS, envelopeV1, type CliCommandWithSchema } from "@imstudium/contract";
import { makeFixture, runCli, type Fixture } from "./test/harness.js";

/**
 * The writing commands on the built CLI, offline, against the synthetic
 * workspace: an Arbeit, its registry from a synthetic BibTeX export and by
 * hand, citations, the bibliography, the manuscript check and templates.
 * Every --json output validates against @imstudium/contract.
 */

let fx: Fixture;
const BIB = `@article{schmidt2020lernen,
  author = {Schmidt, Bert and Weber, Clara},
  title = {Lernen im Netz},
  journaltitle = {Zeitschrift f{\\"u}r Beispiele},
  date = {2020-03}, volume = {12}, number = {3}, pages = {45--67},
  doi = {10.5555/beispiel.2020.12}
}
@book{kaya2019quellen, author = {Kaya, Deniz}, title = {Quellen und Belege}, date = {2019}, publisher = {Beispielverlag}, location = {Beispielstadt}}
`;

function json(command: CliCommandWithSchema, args: string[]) {
  const r = runCli(fx, ["--json", ...args]);
  expect(r.stderr, args.join(" ")).not.toContain("[no-network]");
  expect(r.status, `${args.join(" ")}\n${r.stderr}`).toBe(0);
  const parsed = envelopeV1(CLI_OUTPUTS[command]).safeParse(r.json());
  expect(parsed.success ? null : parsed.error.issues, args.join(" ")).toBeNull();
  return r.json() as Record<string, any>;
}

beforeAll(async () => {
  fx = await makeFixture();
  await writeFile(join(fx.root, "zotero.bib"), BIB);
});

describe("imstudium arbeit / quellen / zitieren / literatur (offline, synthetic)", () => {
  it("starts an Arbeit tied to a course, with deadline and length", () => {
    const out = json("arbeit new", ["arbeit", "new", "Digitale", "Lehre", "im", "Vergleich", "--typ", "seminararbeit", "--course", "statistik", "--abgabe", "15.03.2027", "--umfang", "12s"]);
    expect(out.arbeit).toMatchObject({ slug: "digitale-lehre-im-vergleich", typ: "seminararbeit", abgabe: "2027-03-15", umfang: { value: 12, unit: "seiten" }, course: { title: "Statistik I", path: "WS2026-27/statistik-i" }, stil: { id: "apa" } });
    expect(existsSync(join(fx.workspace, "arbeiten", "digitale-lehre-im-vergleich", "quellen.bib"))).toBe(true);
    const list = json("arbeit", ["arbeit"]);
    expect(list.arbeiten).toHaveLength(1);
    expect(list.arbeiten[0]).toMatchObject({ current: true, quellen: { total: 0 } });
  });

  it("imports a BibTeX export and adds a book by hand", () => {
    const imp = json("quellen import", ["quellen", "import", join(fx.root, "zotero.bib")]);
    expect(imp.added.map((q: { key: string }) => q.key)).toEqual(["schmidt2020lernen", "kaya2019quellen"]);
    const again = json("quellen import", ["quellen", "import", join(fx.root, "zotero.bib")]);
    expect(again.added).toEqual([]);
    expect(again.duplicates).toHaveLength(2);
    const add = json("quellen add", ["quellen", "add", "--manual", "--type", "book", "--title", "Digitale Lehre: Ein Handbuch", "--author", "Müller, Anna", "--year", "2021", "--publisher", "Synthetik Verlag", "--place", "Augsburg"]);
    expect(add.added[0]).toMatchObject({ key: "mueller2021digitale", origin: { via: "manual" } });
    const list = json("quellen", ["quellen"]);
    expect(list.count).toBe(3);
  });

  it("formats citations and the bibliography in the Arbeit's style", () => {
    expect(json("zitieren", ["zitieren", "schmidt2020lernen@50", "--vgl"]).citation).toBe("(vgl. Schmidt & Weber, 2020, S. 50)");
    const note = json("zitieren", ["zitieren", "kaya2019quellen@3", "--stil", "chicago-notes-bibliography"]);
    expect(note).toMatchObject({ style: { class: "note" }, citation: "Deniz Kaya, Quellen und Belege (Beispielverlag, 2019), 3." });
    const bib = json("literatur", ["literatur"]);
    expect(bib.count).toBe(3);
    expect(bib.entries[1].text).toBe("Müller, A. (2021). *Digitale Lehre: Ein Handbuch*. Synthetik Verlag.");
  });

  it("checks the registry offline: completeness and duplicates, nothing leaves the machine", () => {
    const out = json("quellen check", ["quellen", "check", "--offline"]);
    expect(out).toMatchObject({ offline: true, saved: false, ok: true });
    expect(out.results.map((r: { key: string; missing: string[] }) => [r.key, r.missing])).toEqual([
      ["schmidt2020lernen", []],
      ["kaya2019quellen", []],
      ["mueller2021digitale", []],
    ]);
  });

  it("reports METADATA_UNAVAILABLE when a lookup needs the network", () => {
    const r = runCli(fx, ["--json", "quellen", "add", "10.5555/beispiel.2020.99"]);
    expect(r.status).toBe(6);
    // the harness logs the blocked request on stderr before the error document
    expect(r.stderr).toContain("[no-network] blocked https://doi.org/10.5555/beispiel.2020.99");
    expect(JSON.parse(r.stderr.slice(r.stderr.indexOf("{"))).error.code).toBe("METADATA_UNAVAILABLE");
    const bad = runCli(fx, ["--json", "quellen", "add", "Müller 2021"]);
    expect(bad.status).toBe(2);
    expect(JSON.parse(bad.stderr).error.code).toBe("IDENTIFIER_UNRECOGNIZED");
  });

  it("holds a manuscript against registry and Formvorgaben", async () => {
    const md = join(fx.root, "manuskript.md");
    await writeFile(md, "# Einleitung\n\nText [@schmidt2020lernen, S. 50] und [@erfunden2024].\n\n# Fazit\n\nEnde.\n\n# Literaturverzeichnis\n");
    const r = runCli(fx, ["--json", "arbeit", "check", md]);
    expect(r.status).toBe(1);
    const out = envelopeV1(CLI_OUTPUTS["arbeit check"]).parse(r.json()) as Record<string, any>;
    expect(out.citations).toMatchObject({ cited: ["schmidt2020lernen"], unknown: ["erfunden2024"], uncited: ["kaya2019quellen", "mueller2021digitale"] });
    const status = Object.fromEntries(out.checks.map((c: { id: string; status: string }) => [c.id, c.status]));
    expect(status).toMatchObject({ "zitate.unbekannt": "fail", "zitate.unzitiert": "warn", abschnitte: "ok", literaturverzeichnis: "ok", erklaerung: "warn" });
  });

  it("changes Formvorgaben, records an aid and writes every template", async () => {
    const f = runCli(fx, ["--json", "arbeit", "formvorgaben", "set", "rand.links=3", "quelle=Leitfaden.pdf"]);
    expect(f.status).toBe(0);
    expect(JSON.parse(f.stdout).formvorgaben.rand.links).toBe(3);
    expect(runCli(fx, ["arbeit", "hilfsmittel", "add", "DeepL", "Write", "--zweck", "Rechtschreibung"]).status).toBe(0);
    const v = runCli(fx, ["--json", "arbeit", "vorlage", "--format", "all"]);
    expect(v.status, v.stderr).toBe(0);
    const dir = join(fx.workspace, "arbeiten", "digitale-lehre-im-vergleich");
    for (const name of ["vorlage/arbeit.docx", "vorlage/arbeit.tex", "vorlage/arbeit.typ", "vorlage/pandoc.yaml", "vorlage/arbeit.md", "stil/apa.csl"]) expect(existsSync(join(dir, name)), name).toBe(true);
    expect(await readFile(join(dir, "vorlage", "arbeit.tex"), "utf-8")).toContain("left=3cm");
    const show = json("arbeit show", ["arbeit", "show"]);
    expect(show.arbeit.hilfsmittel[0]).toMatchObject({ werkzeug: "DeepL Write", zweck: "Rechtschreibung" });
    expect(await readFile(join(dir, "ARBEIT.md"), "utf-8")).toContain("DeepL Write: Rechtschreibung");
  });

  it("lists styles and edits, renames and removes sources", () => {
    const styles = json("stile", ["stile"]);
    expect(styles.current).toBe("apa");
    expect(styles.styles.find((s: { id: string }) => s.id === "juristische-zitierweise")).toMatchObject({ class: "note", source: "bundled" });
    expect(runCli(fx, ["quellen", "edit", "kaya2019quellen", "seiten=", "--key", "kaya2019belege"]).status).toBe(0);
    expect(runCli(fx, ["quellen", "rm", "kaya2019belege"]).status).toBe(0);
    expect(json("quellen", ["quellen"]).count).toBe(2);
    const missing = runCli(fx, ["--json", "quellen", "show", "kaya2019belege"]);
    expect(missing.status).toBe(5);
    expect(JSON.parse(missing.stderr).error.code).toBe("SOURCE_NOT_FOUND");
    const exp = runCli(fx, ["quellen", "export", "--format", "ris"]);
    expect(exp.stdout).toContain("TY  - JOUR");
  });

  it("asks for an Arbeit when there is none", async () => {
    const empty = await makeFixture();
    const r = runCli(empty, ["--json", "quellen"]);
    expect(r.status).toBe(8);
    expect(JSON.parse(r.stderr).error.code).toBe("ARBEIT_MISSING");
  });
});
