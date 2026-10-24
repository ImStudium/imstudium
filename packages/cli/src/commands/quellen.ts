import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { Command } from "commander";
import {
  addQuelle,
  checkQuellen,
  CitationFormatter,
  courseReferences,
  crossrefWork,
  creatorsShort,
  cslToBibEntry,
  detectImportFormat,
  exportLibrary,
  getQuelle,
  ImstudiumError,
  normalizeIsbn,
  parseCslDate,
  parseIdentifier,
  parseLibrary,
  parseNameList,
  removeQuelle,
  renameQuelle,
  resolveIdentifier,
  resolveWorkspaceCourse,
  saveArbeit,
  searchCrossref,
  shortReference,
  toImstudiumError,
  writeBibtex,
  yearOf,
  type CslFields,
  type ExportFormat,
  type Quelle,
  type QuelleCheck,
  type QuelleCheckStatus,
} from "@imstudium/sdk";
import type { QuellenAddOutput, QuellenCheckOutput, QuellenListOutput } from "@imstudium/contract";
import { arbeitContext, arbeitOption, metadataOptions, parseAssignments } from "../arbeit-arg.js";
import { limitOption, outputOption, parseLimit, workspaceDir } from "../kit/args.js";
import { cell, table } from "../kit/format.js";
import { act, getSdk, note, output } from "../runtime.js";

/**
 * `imstudium quellen`: the citation registry of an Arbeit. Sources come in
 * by identifier (DOI, ISBN, arXiv, URL; resolved and checked against the
 * authority), from a Zotero/Citavi/Mendeley export, or by hand; every change
 * rewrites quellen.bib for LaTeX, Typst and Pandoc.
 */

const STATUS_LABEL: Record<QuelleCheckStatus | "none", string> = {
  verified: "geprüft",
  mismatch: "weicht ab",
  "not-found": "NICHT GEFUNDEN",
  retracted: "ZURÜCKGEZOGEN",
  unverified: "ungeprüft",
  none: "ungeprüft",
};

/** CSL field names and the German/short aliases `quellen edit` and `--manual` accept. */
const FIELD_ALIASES: Record<string, string> = {
  titel: "title",
  autor: "author",
  autoren: "author",
  hrsg: "editor",
  herausgeber: "editor",
  jahr: "issued",
  year: "issued",
  date: "issued",
  datum: "issued",
  abgerufen: "accessed",
  abrufdatum: "accessed",
  zeitschrift: "container-title",
  journal: "container-title",
  container: "container-title",
  sammelband: "container-title",
  reihe: "collection-title",
  series: "collection-title",
  verlag: "publisher",
  hochschule: "publisher",
  ort: "publisher-place",
  place: "publisher-place",
  seiten: "page",
  pages: "page",
  band: "volume",
  jahrgang: "volume",
  heft: "issue",
  auflage: "edition",
  doi: "DOI",
  isbn: "ISBN",
  issn: "ISSN",
  url: "URL",
  sprache: "language",
  art: "genre",
  typ: "type",
};

const NAME_FIELDS = new Set(["author", "editor", "translator", "container-author", "collection-editor"]);
const DATE_FIELDS = new Set(["issued", "accessed", "original-date"]);
const IDENTITY_FIELDS = new Set(["title", "author", "editor", "issued", "DOI", "ISBN", "type"]);

function setField(csl: Record<string, unknown>, rawKey: string, value: string): string {
  const key = FIELD_ALIASES[rawKey.toLowerCase()] ?? rawKey;
  if (key === "id") throw new ImstudiumError("Rename a key with --key, not id=", "BAD_ARGS");
  if (!value) {
    delete csl[key];
    return key;
  }
  if (NAME_FIELDS.has(key)) csl[key] = parseNameList(value);
  else if (DATE_FIELDS.has(key)) csl[key] = parseCslDate(value);
  else csl[key] = value;
  return key;
}

function quelleLine(q: Quelle): string[] {
  return [q.key, q.csl.type, `${creatorsShort(q.csl)} ${yearOf(q.csl.issued) ?? "o. J."}`, STATUS_LABEL[q.check?.status ?? "none"], q.csl.title ?? ""];
}

function checkFromResolve(service: string | null | undefined, at: string, notices?: QuelleCheck["notices"]): QuelleCheck {
  const retraction = notices?.find((n) => /retract|withdraw|removal/.test(n.type));
  if (retraction) return { status: "retracted", at, service: "crossref", detail: `Zurückgezogen${retraction.date ? ` am ${retraction.date}` : ""}${retraction.doi ? ` (Mitteilung ${retraction.doi})` : ""}. Nicht als Beleg verwenden.`, notices };
  if (service === "web") return { status: "unverified", at, detail: "Aus der Webseite übernommen. Angaben prüfen, eine Kopie sichern." };
  return { status: "verified", at, service: service ?? undefined, detail: `Angaben von ${service} übernommen.`, ...(notices?.length ? { notices } : {}) };
}

interface AddOpts {
  manual?: boolean;
  type?: string;
  title?: string;
  author?: string;
  editor?: string;
  year?: string;
  container?: string;
  publisher?: string;
  place?: string;
  pages?: string;
  volume?: string;
  issue?: string;
  edition?: string;
  url?: string;
  accessed?: string;
  doi?: string;
  isbn?: string;
  genre?: string;
  key?: string;
  file?: string;
  tag?: string[];
  note?: string;
  dryRun?: boolean;
  arbeit?: string;
  output?: string;
}

function manualItem(o: AddOpts): CslFields {
  if (!o.title) throw new ImstudiumError("--manual needs at least --title", "BAD_ARGS", undefined, 'e.g. imstudium quellen add --manual --type book --title "…" --author "Müller, Anna" --year 2021 --publisher "…" --place Augsburg');
  const csl: Record<string, unknown> = { type: o.type ?? (o.url && !o.publisher ? "webpage" : o.container ? (o.editor ? "chapter" : "article-journal") : "book") };
  const fields: Array<[string, string | undefined]> = [
    ["title", o.title], ["author", o.author], ["editor", o.editor], ["issued", o.year], ["container-title", o.container], ["publisher", o.publisher],
    ["publisher-place", o.place], ["page", o.pages], ["volume", o.volume], ["issue", o.issue], ["edition", o.edition], ["URL", o.url],
    ["accessed", o.accessed ?? (o.url ? new Date().toISOString().slice(0, 10) : undefined)], ["DOI", o.doi], ["ISBN", o.isbn], ["genre", o.genre],
  ];
  for (const [k, v] of fields) if (v) setField(csl, k, v);
  return csl as CslFields;
}

function addText(p: QuellenAddOutput): string {
  const lines: string[] = [];
  for (const q of p.added) {
    const status = q.check?.status;
    lines.push(`${p.dryRun ? "○ würde aufnehmen" : "✓ aufgenommen"}  ${q.key}  ${shortReference(q.csl as Quelle["csl"])}`);
    if (status === "retracted") lines.push(`  ✗ ZURÜCKGEZOGEN: ${q.check!.detail}`);
    else if (q.check?.notices?.length) lines.push(`  ! Hinweise: ${q.check.notices.map((n) => n.type).join(", ")}`);
  }
  for (const d of p.duplicates) lines.push(`· schon im Register  ${d.key}  (${d.input})`);
  for (const f of p.failed) lines.push(`✗ ${f.input}: ${f.message}`);
  if (p.added.length && !p.dryRun) lines.push("", `Zitieren: imstudium zitieren ${p.added[0]!.key}@<Seite>`);
  return lines.join("\n");
}

export function registerQuellen(program: Command): void {
  const quellen = program
    .command("quellen")
    .description("The Arbeit's citation registry: add by DOI/ISBN/URL, import from Zotero or Citavi, check, export")
    .option("--status <status>", "Only verified, mismatch, not-found, retracted or unverified")
    .option("--tag <tag>", "Only sources with this tag")
    .addOption(arbeitOption())
    .addOption(outputOption())
    .action(act(listAction));

  quellen
    .command("list")
    .description("Every source of the Arbeit with key, type, author, year and check status")
    .option("--status <status>", "Only verified, mismatch, not-found, retracted or unverified")
    .option("--tag <tag>", "Only sources with this tag")
    .addOption(arbeitOption())
    .addOption(outputOption())
    .action(act(listAction));

  quellen
    .command("add")
    .description("Add sources by DOI, ISBN, arXiv id or URL (resolved and checked), or by hand with --manual")
    .argument("[ids...]", "10.1000/xyz123 · ISBN 978-3-… · arXiv:2101.01234 · https://…")
    .option("--manual", "Enter the source by hand (books without ISBN, grey literature, laws, interviews)")
    .option("--type <type>", "CSL type for --manual: book, chapter, article-journal, thesis, report, webpage, legislation, legal_case, …")
    .option("--title <title>")
    .option("--author <names>", 'Authors, "Müller, Anna; Schmidt, Bert"')
    .option("--editor <names>", "Editors, same form")
    .option("--year <date>", "Year or date (2021, 2021-03-15)")
    .option("--container <title>", "Journal, edited volume or website")
    .option("--publisher <name>", "Publisher, or the university for a thesis")
    .option("--place <place>", "Place of publication")
    .option("--pages <range>", "Pages, e.g. 45-67")
    .option("--volume <n>")
    .option("--issue <n>")
    .option("--edition <n>")
    .option("--url <url>")
    .option("--accessed <date>", "Access date for web sources (default today when --url is given)")
    .option("--doi <doi>")
    .option("--isbn <isbn>")
    .option("--genre <text>", "Kind of thesis or report, e.g. Masterarbeit")
    .option("--key <citekey>", "Your own citekey (default: mueller2021digitale style)")
    .option("--file <path>", "The full text on your disk (PDF), kept with the source")
    .option("--tag <tag...>", "Tags for your own order")
    .option("--note <text>", "A note of your own")
    .option("--dry-run", "Resolve and show, write nothing")
    .addOption(arbeitOption())
    .addOption(outputOption())
    .action(
      act(async (ids: string[], opts: AddOpts) => {
        const { ref, quellen } = await arbeitContext(opts);
        if (!ids.length && !opts.manual) throw new ImstudiumError("Nothing to add", "BAD_ARGS", undefined, "imstudium quellen add <DOI|ISBN|arXiv|URL> …, or --manual --title …");
        if (opts.key && ids.length > 1) throw new ImstudiumError("--key works with one source at a time", "BAD_ARGS");
        const payload: QuellenAddOutput = { arbeit: ref.arbeit.slug, added: [], duplicates: [], failed: [], dryRun: !!opts.dryRun };
        const extra = { key: opts.key, file: opts.file ? resolve(opts.file) : undefined, tags: opts.tag, notes: opts.note };
        if (opts.manual) {
          const r = addQuelle(quellen, manualItem(opts), { via: "manual" }, extra);
          if (r.duplicate) payload.duplicates.push({ input: opts.title ?? "--manual", key: r.quelle.key });
          else payload.added.push(r.quelle);
        }
        const meta = metadataOptions();
        for (const input of ids) {
          const id = parseIdentifier(input);
          if (!id) {
            const isbnLike = /^isbn/i.test(input.trim()) || /^\d[\d\s-]{8,16}[\dXx]$/.test(input.trim());
            payload.failed.push({ input, code: "IDENTIFIER_UNRECOGNIZED", message: isbnLike ? "die Prüfziffer der ISBN stimmt nicht (Tippfehler?)" : "keine DOI, ISBN, arXiv-ID oder URL; ohne Kennung: --manual, oder imstudium quellen find" });
            continue;
          }
          try {
            const r = await resolveIdentifier(id, meta);
            const at = new Date().toISOString();
            let notices: QuelleCheck["notices"];
            if (r.item.DOI) notices = (await crossrefWork(r.item.DOI, meta).catch(() => null))?.notices;
            const added = addQuelle(quellen, r.item, r.origin, { ...extra, check: checkFromResolve(r.origin.service, at, notices) });
            if (added.duplicate) payload.duplicates.push({ input, key: added.quelle.key });
            else payload.added.push(added.quelle);
          } catch (e) {
            const err = toImstudiumError(e);
            payload.failed.push({ input, code: err.code, message: err.message });
          }
        }
        if (!opts.dryRun && payload.added.length) await saveArbeit(ref, quellen);
        if (!payload.added.length && !payload.duplicates.length && payload.failed.length === 1) {
          const f = payload.failed[0]!;
          throw new ImstudiumError(`${f.input}: ${f.message}`, f.code);
        }
        output(payload, addText(payload));
        if (payload.failed.length) process.exitCode = 1;
      }),
    );

  quellen
    .command("show")
    .description("One source: every field, origin, check, the reference in the Arbeit's style and as BibLaTeX")
    .argument("<key>", "Citekey")
    .addOption(arbeitOption())
    .addOption(outputOption())
    .action(
      act(async (key: string, opts: { arbeit?: string; output?: string }) => {
        const { ref, quellen } = await arbeitContext(opts);
        const q = getQuelle(quellen, key);
        const f = await CitationFormatter.create({ style: ref.arbeit.stil.id, items: [q.csl], arbeitDir: ref.dir, lang: ref.arbeit.sprache });
        const formatted = f.bibliography().entries[0]?.text ?? "";
        const cite = f.cite([{ key: q.key, locator: "12" }]);
        const bib = writeBibtex([cslToBibEntry(q.csl)]);
        const lines = [
          `${q.key}  ${STATUS_LABEL[q.check?.status ?? "none"]}${q.check?.detail ? `: ${q.check.detail}` : ""}`,
          "",
          `Literaturverzeichnis (${ref.arbeit.stil.id}): ${formatted}`,
          `Beleg mit Seite: ${cite}`,
          "",
          `Herkunft: ${q.origin.via}${q.origin.ref ? ` ${q.origin.ref}` : ""}${q.origin.service ? ` über ${q.origin.service}` : ""}, ${q.origin.at.slice(0, 10)}`,
          ...(q.file ? [`Volltext: ${q.file}`] : []),
          ...(q.tags?.length ? [`Tags: ${q.tags.join(", ")}`] : []),
          ...(q.notes ? [`Notiz: ${q.notes}`] : []),
          ...(q.check?.differences?.length ? ["", "Abweichungen:", ...q.check.differences.map((d) => `  ${d.field}: hier „${d.ours}“, laut Quelle „${d.theirs}“`)] : []),
          "",
          bib.trim(),
        ];
        output({ quelle: q, formatted, cite, bibtex: bib.trim() }, lines.join("\n"));
      }),
    );

  quellen
    .command("edit")
    .description("Correct fields (key=value; names as \"Müller, Anna; Schmidt, Bert\"; an empty value removes the field)")
    .argument("<key>", "Citekey")
    .argument("[assignments...]", 'e.g. ort=Augsburg seiten=45-67 "author=Müller, Anna" DOI=10.1000/xyz123')
    .option("--key <citekey>", "Rename the citekey (change it in the manuscript too)")
    .option("--file <path>", "Attach the full text on your disk")
    .option("--tag <tag...>", "Replace the tags")
    .option("--note <text>", "Replace your note")
    .addOption(arbeitOption())
    .addOption(outputOption())
    .action(
      act(async (key: string, items: string[], opts: { key?: string; file?: string; tag?: string[]; note?: string; arbeit?: string; output?: string }) => {
        const { ref, quellen } = await arbeitContext(opts);
        const q = getQuelle(quellen, key);
        let identityChanged = false;
        for (const [k, v] of parseAssignments(items)) {
          const field = setField(q.csl, k, v);
          if (IDENTITY_FIELDS.has(field)) identityChanged = true;
        }
        if (opts.file) q.file = resolve(opts.file);
        if (opts.tag) q.tags = opts.tag;
        if (opts.note !== undefined) q.notes = opts.note || undefined;
        if (identityChanged && q.check) {
          delete q.check;
          note("Titel, Autor, Jahr oder Kennung geändert: die Prüfung gilt nicht mehr (imstudium quellen check --save).");
        }
        q.updated = new Date().toISOString();
        if (opts.key) renameQuelle(quellen, q.key, opts.key);
        await saveArbeit(ref, quellen);
        output({ quelle: q }, `✓ ${q.key}  ${shortReference(q.csl)}`);
      }),
    );

  quellen
    .command("rm")
    .description("Remove sources from the registry")
    .argument("<keys...>", "Citekeys")
    .addOption(arbeitOption())
    .addOption(outputOption())
    .action(
      act(async (keys: string[], opts: { arbeit?: string; output?: string }) => {
        const { ref, quellen } = await arbeitContext(opts);
        const removed = keys.map((k) => removeQuelle(quellen, k).key);
        await saveArbeit(ref, quellen);
        output({ removed }, `Entfernt: ${removed.join(", ")}`);
      }),
    );

  quellen
    .command("check")
    .alias("pruefen")
    .description("Check sources against doi.org, Crossref (retractions too) and the DNB; completeness and duplicates offline")
    .argument("[keys...]", "Only these citekeys (default all)")
    .option("--offline", "Only completeness and duplicates, nothing leaves the machine")
    .option("--save", "Store the results in the registry")
    .addOption(arbeitOption())
    .addOption(outputOption())
    .action(
      act(async (keys: string[], opts: { offline?: boolean; save?: boolean; arbeit?: string; output?: string }) => {
        const { ref, quellen } = await arbeitContext(opts);
        for (const k of keys) getQuelle(quellen, k);
        const results = await checkQuellen(quellen, { ...metadataOptions(), keys, offline: opts.offline, ...(opts.offline ? {} : { onProgress: (d: number, t: number) => note(`  geprüft ${d}/${t}`) }) });
        if (opts.save && !opts.offline) {
          for (const r of results) {
            const q = quellen.items.find((x) => x.key === r.key);
            if (q && r.check) q.check = r.check;
          }
          await saveArbeit(ref, quellen);
        }
        const bad = results.filter((r) => r.check && ["mismatch", "not-found", "retracted"].includes(r.check.status));
        const payload: QuellenCheckOutput = { arbeit: ref.arbeit.slug, offline: !!opts.offline, saved: !!opts.save && !opts.offline, ok: bad.length === 0, results };
        const lines = results.flatMap((r) => {
          const s = r.check?.status ?? "none";
          const icon = s === "verified" ? "✓" : s === "unverified" || s === "none" ? "·" : "✗";
          return [
            `${icon} ${cell(r.key, 28)} ${cell(STATUS_LABEL[s], 16)} ${r.short}`,
            ...(r.check?.detail && s !== "verified" ? [`    ${r.check.detail}`] : []),
            ...(r.missing.length ? [`    fehlt: ${r.missing.join(", ")}`] : []),
            ...(r.duplicateOf ? [`    doppelt mit ${r.duplicateOf}`] : []),
          ];
        });
        lines.push("", `${results.length} Quellen · ${results.filter((r) => r.check?.status === "verified").length} geprüft · ${bad.length} ${bad.length === 1 ? "Problem" : "Probleme"}${opts.offline ? " (offline: nur Vollständigkeit und Dubletten)" : ""}${opts.save || opts.offline ? "" : " · mit --save speichern"}`);
        output(payload, lines.join("\n"));
        if (bad.length) process.exitCode = 1;
      }),
    );

  quellen
    .command("find")
    .alias("suchen")
    .description("Find the real work behind a half-remembered or AI-suggested reference (Crossref search)")
    .argument("<words...>", 'Author, title words, year: "Schmidt Lernen im Netz 2020"')
    .addOption(limitOption(5, "Candidates"))
    .action(
      act(async (words: string[], opts: { limit?: string }) => {
        const query = words.join(" ");
        const hits = await searchCrossref(query, { ...metadataOptions(), rows: parseLimit(opts.limit, 5) });
        const lines = hits.length
          ? [...hits.flatMap((h, i) => [`${i + 1}. ${shortReference({ ...h.item, id: h.doi } as Quelle["csl"])}`, `   ${h.item["container-title"] ?? h.item.publisher ?? ""}  doi:${h.doi}`]), "", `Aufnehmen: imstudium quellen add ${hits[0]!.doi}`, "Kein Treffer passt? Dann gibt es die Quelle so vermutlich nicht. Nicht zitieren, was du nicht selbst gefunden hast."]
          : ["Kein Treffer bei Crossref. Bücher sucht man besser im Katalog der Bibliothek (oder per ISBN: imstudium quellen add <ISBN>)."];
        output({ query, count: hits.length, candidates: hits }, lines.join("\n"));
      }),
    );

  quellen
    .command("kurs")
    .description("Literature your course material names (DOIs and ISBNs in the extracted files), ready to add")
    .argument("<course>", "Title fragment, shortcut or slug")
    .addOption(arbeitOption())
    .addOption(outputOption())
    .action(
      act(async (courseQuery: string, opts: { arbeit?: string; output?: string }) => {
        const sdk = await getSdk({ silentRefresh: false });
        const workspace = workspaceDir(sdk, opts);
        let registry: Quelle[] = [];
        try {
          registry = (await arbeitContext(opts)).quellen.items;
        } catch (e) {
          // no Arbeit (or none picked) is fine here: list the course's literature anyway
          if (!["ARBEIT_MISSING", "ARBEIT_AMBIGUOUS"].includes(toImstudiumError(e).code)) throw e;
        }
        const ws = await sdk.studium.loadWorkspace(workspace);
        if (!ws) throw new ImstudiumError("No Studium workspace here", "WORKSPACE_MISSING");
        const course = resolveWorkspaceCourse(ws, courseQuery, sdk.config.courseAliases);
        const refs = await courseReferences(workspace, course.path ?? course.slug);
        const inRegistry = (kind: string, id: string) => registry.some((q) => (kind === "doi" ? q.csl.DOI?.toLowerCase() === id : normalizeIsbn((q.csl.ISBN ?? "").split(/[\s,;]+/)[0] ?? "") === id));
        const items = refs.map((r) => ({ ...r, inRegistry: inRegistry(r.kind, r.id) }));
        const lines = items.length
          ? [...items.map((r) => `${r.inRegistry ? "✓" : "+"} ${r.kind === "doi" ? `doi:${r.id}` : `ISBN ${r.id}`}  ${basename(r.file)}${r.page ? ` S. ${r.page}` : ""}\n    ${r.context}`), "", `Aufnehmen: imstudium quellen add ${items.filter((r) => !r.inRegistry).slice(0, 3).map((r) => r.id).join(" ") || "<id>"}`]
          : [`Keine DOIs oder ISBNs in den extrahierten Dateien von ${course.title}. Erst imstudium sync --extract, oder die Literaturliste mit imstudium search "Literatur" --course "${courseQuery}" suchen.`];
        output({ course: { id: course.id, title: course.title, path: course.path ?? null }, count: items.length, references: items }, lines.join("\n"));
      }),
    );

  quellen
    .command("import")
    .description("Import a library export: BibTeX/BibLaTeX (Zotero, Better BibTeX, JabRef), RIS (Citavi, EndNote, Mendeley), CSL-JSON")
    .argument("<files...>", ".bib, .ris or .json files")
    .option("--dry-run", "Show what would come in, write nothing")
    .addOption(arbeitOption())
    .addOption(outputOption())
    .action(
      act(async (files: string[], opts: { dryRun?: boolean; arbeit?: string; output?: string }) => {
        const { ref, quellen } = await arbeitContext(opts);
        const payload: QuellenAddOutput = { arbeit: ref.arbeit.slug, added: [], duplicates: [], failed: [], dryRun: !!opts.dryRun };
        for (const file of files) {
          const text = await readFile(resolve(file), "utf-8").catch(() => {
            throw new ImstudiumError(`Cannot read ${file}`, "NOT_FOUND");
          });
          const format = detectImportFormat(text, file);
          if (!format) {
            payload.failed.push({ input: file, code: "IMPORT_FAILED", message: "weder BibTeX noch RIS noch CSL-JSON" });
            continue;
          }
          const lib = parseLibrary(text, format);
          for (const err of lib.errors) payload.failed.push({ input: `${basename(file)}: ${err.slice(0, 80)}`, code: "IMPORT_FAILED", message: err });
          const via = format === "bibtex" ? "bibtex" : format === "ris" ? "ris" : "csl-json";
          for (const item of lib.items) {
            const r = addQuelle(quellen, item, { via, ref: basename(file) });
            if (r.duplicate) payload.duplicates.push({ input: item.id || item.title || "?", key: r.quelle.key });
            else payload.added.push(r.quelle);
          }
        }
        if (!opts.dryRun && payload.added.length) await saveArbeit(ref, quellen);
        if (!payload.added.length && !payload.duplicates.length && payload.failed.length) throw new ImstudiumError(payload.failed[0]!.message, "IMPORT_FAILED");
        const text = [`${payload.added.length} ${opts.dryRun ? "würden aufgenommen" : "aufgenommen"} · ${payload.duplicates.length} schon im Register · ${payload.failed.length} Fehler`, ...payload.failed.map((f) => `✗ ${f.input}`), "", payload.added.length && !opts.dryRun ? "Gegen die Normdaten prüfen: imstudium quellen check --save" : ""].filter(Boolean).join("\n");
        output(payload, text);
      }),
    );

  quellen
    .command("export")
    .description("Export the registry: biblatex (default), bibtex, ris (Citavi, EndNote) or csl-json (Zotero, Pandoc)")
    .option("--format <format>", "biblatex · bibtex · ris · csl-json")
    .option("--save <file>", "Write to a file instead of stdout")
    .addOption(arbeitOption())
    .addOption(outputOption())
    .action(
      act(async (opts: { format?: string; save?: string; arbeit?: string; output?: string }) => {
        const { ref, quellen } = await arbeitContext(opts);
        const format = (opts.format ?? "biblatex") as ExportFormat;
        if (!["biblatex", "bibtex", "ris", "csl-json"].includes(format)) throw new ImstudiumError(`Unknown --format ${format}`, "BAD_ARGS", undefined, "biblatex, bibtex, ris or csl-json");
        const text = exportLibrary(quellen.items.map((q) => q.csl), format, `Export der Arbeit „${ref.arbeit.title}“ (ImStudium)`);
        if (opts.save) {
          await writeFile(resolve(opts.save), text);
          output({ format, file: resolve(opts.save), count: quellen.items.length }, `${quellen.items.length} Quellen → ${resolve(opts.save)}`);
        } else {
          output({ format, count: quellen.items.length, text }, text);
        }
      }),
    );
}

async function listAction(opts: { status?: string; tag?: string; arbeit?: string; output?: string }): Promise<void> {
  const { ref, quellen } = await arbeitContext(opts);
  let items = quellen.items;
  if (opts.status) items = items.filter((q) => (q.check?.status ?? "unverified") === opts.status);
  if (opts.tag) items = items.filter((q) => q.tags?.includes(opts.tag!));
  const payload: QuellenListOutput = { arbeit: ref.arbeit.slug, count: items.length, quellen: items };
  const text = items.length
    ? [...table(items.map(quelleLine), { maxWidths: [30, 16, 26, 16, 60] }), "", `${items.length} Quellen · ${ref.arbeit.stil.id} · quellen.bib aktuell`].join("\n")
    : `Keine Quellen${opts.status || opts.tag ? " mit diesem Filter" : ""}. Aufnehmen: imstudium quellen add <DOI|ISBN|URL> · importieren: imstudium quellen import <datei.bib>`;
  output(payload, text);
}
