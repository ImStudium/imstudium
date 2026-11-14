import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import type { Command } from "commander";
import {
  arbeitStyles,
  BUNDLED_STYLE_NOTES,
  bundledStyles,
  CitationFormatter,
  fetchStyle,
  ImstudiumError,
  loadStyle,
  saveArbeit,
  scanManuscript,
  matchCitations,
  searchStyles,
  toImstudiumError,
  type CiteFormat,
  type CitePosition,
  type CiteRequest,
  type CslItem,
} from "@imstudium/sdk";
import type { LiteraturOutput, StileOutput, ZitierenOutput } from "@imstudium/contract";
import { arbeitContext, arbeitOption, metadataOptions } from "../arbeit-arg.js";
import { limitOption, outputOption, parseLimit } from "../kit/args.js";
import { table } from "../kit/format.js";
import { act, output } from "../runtime.js";

/**
 * `imstudium zitieren`, `literatur` and `stile`: citations and the
 * bibliography in the Arbeit's CSL style (the formatter Zotero uses), and
 * the styles themselves, bundled or added from the CSL repository.
 */

const FORMATS: Record<string, CiteFormat> = { text: "text", txt: "text", html: "html", rtf: "rtf", md: "markdown", markdown: "markdown" };
const POSITIONS: Record<string, CitePosition> = { erst: "first", first: "first", folge: "subsequent", subsequent: "subsequent", ebd: "ibid", ibid: "ibid" };

function parseFormat(value: string | undefined, fallback: CiteFormat): CiteFormat {
  if (!value) return fallback;
  const f = FORMATS[value.toLowerCase()];
  if (!f) throw new ImstudiumError(`Unknown --format ${value}`, "BAD_ARGS", undefined, "text, md, html or rtf (rtf opens in Word with italics intact)");
  return f;
}

/** "key", "key@12", "key@S. 12-14", "key@Rn. 7" */
function parseCite(raw: string): CiteRequest {
  const i = raw.indexOf("@");
  if (i <= 0) return { key: raw.trim() };
  return { key: raw.slice(0, i).trim(), locator: raw.slice(i + 1).trim() };
}

/** A synthetic book and article to show what a style looks like before any source is in the registry. */
const SAMPLE: CslItem[] = [
  { id: "beispiel2021buch", type: "book", title: "Digitale Lehre: Ein Handbuch", author: [{ family: "Müller", given: "Anna" }], issued: { "date-parts": [[2021]] }, publisher: "Synthetik Verlag", "publisher-place": "Augsburg", edition: "2" },
  { id: "beispiel2020artikel", type: "article-journal", title: "Lernen im Netz", author: [{ family: "Schmidt", given: "Bert" }, { family: "Weber", given: "Clara" }], issued: { "date-parts": [[2020]] }, "container-title": "Zeitschrift für Beispiele", volume: "12", issue: "3", page: "45-67", DOI: "10.5555/beispiel.2020.12" },
];

export function registerZitieren(program: Command): void {
  program
    .command("zitieren")
    .description("A citation in the Arbeit's style: in the text, or the footnote for note styles")
    .argument("<cites...>", "key, key@12, key@S. 12-14, key@Kap. 3 (several keys make one citation)")
    .option("--seite <locator>", "Page or locator for a single key (same as key@…)")
    .option("--position <pos>", "erst (first mention, default), folge (later, short form) or ebd (right after the same source)")
    .option("--vgl", "Indirect quote: prefix „Vgl.“ (German convention)")
    .option("--stil <id>", "Another style for this once (id or .csl file)")
    .option("--format <format>", "text (default), md, html or rtf")
    .addOption(arbeitOption())
    .addOption(outputOption())
    .action(
      act(async (raw: string[], opts: { seite?: string; position?: string; vgl?: boolean; stil?: string; format?: string; arbeit?: string; output?: string }) => {
        const { ref, quellen } = await arbeitContext(opts);
        const cites = raw.map(parseCite);
        if (opts.seite) {
          if (cites.length !== 1) throw new ImstudiumError("--seite works with one key; write key@page for several", "BAD_ARGS");
          cites[0]!.locator = opts.seite;
        }
        const position = opts.position ? POSITIONS[opts.position.toLowerCase()] : "first";
        if (!position) throw new ImstudiumError(`Unknown --position ${opts.position}`, "BAD_ARGS", undefined, "erst, folge or ebd");
        const format = parseFormat(opts.format, "text");
        const f = await CitationFormatter.create({ style: opts.stil ?? ref.arbeit.stil.id, items: quellen.items.map((q) => q.csl), arbeitDir: ref.dir, lang: ref.arbeit.sprache, format });
        if (opts.vgl) cites[0]!.prefix = f.style.class === "note" ? "Vgl. " : "vgl. ";
        const citation = f.cite(cites, f.style.class === "note" ? position : "first");
        const payload: ZitierenOutput = { style: { id: f.style.id, title: f.style.title, class: f.style.class }, position, format, citation, keys: cites.map((c) => c.key) };
        output(payload, citation);
      }),
    );

  program
    .command("literatur")
    .description("The bibliography (Literaturverzeichnis) in the Arbeit's style")
    .option("--nur-zitiert <manuskript>", "Only what this manuscript cites (.docx, .md, .tex, .typ)")
    .option("--stil <id>", "Another style for this once")
    .option("--format <format>", "md (default), text, html or rtf (opens in Word with italics and hanging indent)")
    .option("--save <file>", "Write to a file instead of stdout")
    .addOption(arbeitOption())
    .addOption(outputOption())
    .action(
      act(async (opts: { nurZitiert?: string; stil?: string; format?: string; save?: string; arbeit?: string; output?: string }) => {
        const { ref, quellen } = await arbeitContext(opts);
        const format = parseFormat(opts.format, "markdown");
        let keys: string[] | undefined;
        if (opts.nurZitiert) {
          const report = matchCitations(quellen, await scanManuscript(resolve(opts.nurZitiert)));
          // numeric styles number in order of first citation
          keys = report.cited;
        }
        const f = await CitationFormatter.create({ style: opts.stil ?? ref.arbeit.stil.id, items: quellen.items.map((q) => q.csl), arbeitDir: ref.dir, lang: ref.arbeit.sprache, format });
        const bib = f.bibliography(keys);
        const payload: LiteraturOutput = { style: { id: f.style.id, title: f.style.title, class: f.style.class }, format, count: bib.entries.length, entries: bib.entries, text: bib.text, hangingIndent: bib.hangingIndent };
        if (opts.save) {
          await writeFile(resolve(opts.save), bib.text);
          output({ ...payload, file: resolve(opts.save) }, `${bib.entries.length} Einträge → ${resolve(opts.save)}`);
          return;
        }
        output(payload, bib.entries.length ? bib.text : "Das Register ist leer. Aufnehmen: imstudium quellen add <DOI|ISBN|URL>");
      }),
    );

  const stile = program
    .command("stile")
    .description("Citation styles (CSL): the bundled set, yours, and any of the ~10,000 in the CSL repository")
    .addOption(arbeitOption())
    .addOption(outputOption())
    .action(act(listStyles));

  stile
    .command("list")
    .description("Bundled styles and the ones added to the Arbeit")
    .addOption(arbeitOption())
    .addOption(outputOption())
    .action(act(listStyles));

  stile
    .command("show")
    .description("What a style looks like: a citation, a later one and two references (synthetic examples)")
    .argument("<id>", "Style id or .csl file")
    .addOption(arbeitOption())
    .addOption(outputOption())
    .action(
      act(async (id: string, opts: { arbeit?: string; output?: string }) => {
        const dir = await arbeitContext(opts).then((c) => c.ref.dir).catch(() => null);
        const f = await CitationFormatter.create({ style: id, items: SAMPLE, arbeitDir: dir });
        const first = f.cite([{ key: "beispiel2020artikel", locator: "50" }]);
        const later = f.style.class === "note" ? f.cite([{ key: "beispiel2020artikel", locator: "51" }], "subsequent") : null;
        const bib = f.bibliography();
        output(
          { style: f.style, example: { cite: first, subsequent: later, bibliography: bib.entries } },
          [`${f.style.title} (${f.style.id}, ${f.style.class === "note" ? "Fußnoten" : "im Text"})`, "", `Beleg: ${first}`, ...(later ? [`Später: ${later}`] : []), "", ...bib.entries.map((e) => e.text)].join("\n"),
        );
      }),
    );

  stile
    .command("find")
    .alias("suchen")
    .description("Search the CSL repository by words (university, institute, journal, Lehrstuhl)")
    .argument("<words...>", 'e.g. "TU Dresden" Linguistik')
    .addOption(limitOption(20, "Styles"))
    .action(
      act(async (words: string[], opts: { limit?: string }) => {
        const hits = await searchStyles(words, { ...metadataOptions(), limit: parseLimit(opts.limit, 20) });
        const lines = hits.length ? [...hits.map((h) => `${h.id}${h.dependent ? "  (abhängig)" : ""}`), "", `Übernehmen: imstudium stile add ${hits[0]!.id}`] : ["Kein Stil gefunden. Mit weniger Wörtern suchen, oder auf https://www.zotero.org/styles nachsehen."];
        output({ count: hits.length, styles: hits }, lines.join("\n"));
      }),
    );

  stile
    .command("add")
    .description("Add a style to the Arbeit (from the CSL repository, a URL or a .csl file) and use it")
    .argument("<style>", "Style id (stile find), a zotero.org/styles URL, or a .csl file")
    .option("--no-use", "Only add it, keep the current style")
    .addOption(arbeitOption())
    .addOption(outputOption())
    .action(
      act(async (input: string, opts: { use?: boolean; arbeit?: string; output?: string }) => {
        const { ref, quellen } = await arbeitContext(opts);
        const dir = join(ref.dir, "stil");
        await mkdir(dir, { recursive: true });
        let id: string;
        if (input.endsWith(".csl") && !/^https?:\/\//.test(input)) {
          const style = await loadStyle(resolve(input), ref.dir);
          id = style.info.id;
          await copyFile(style.info.path, join(dir, `${id}.csl`));
        } else {
          const fetched = await fetchStyle(input, metadataOptions());
          id = fetched.id;
          await writeFile(join(dir, `${id}.csl`), fetched.xml);
          if (fetched.parent) await writeFile(join(dir, `${fetched.parent.id}.csl`), fetched.parent.xml);
        }
        const style = await loadStyle(id, ref.dir);
        if (opts.use !== false) {
          ref.arbeit.stil = { id, title: style.info.title, file: relative(ref.dir, join(dir, `${id}.csl`)), class: style.info.class };
          await saveArbeit(ref, quellen);
        }
        output({ id, title: style.info.title, class: style.info.class, file: join(dir, `${id}.csl`), used: opts.use !== false }, `✓ ${style.info.title} (${id})${opts.use !== false ? " ist jetzt der Stil dieser Arbeit" : " liegt in stil/"}`);
      }),
    );
}

async function listStyles(opts: { arbeit?: string; output?: string }): Promise<void> {
  let current: string | null = null;
  let mine: Awaited<ReturnType<typeof arbeitStyles>> = [];
  try {
    const { ref } = await arbeitContext(opts);
    current = ref.arbeit.stil.id;
    mine = await arbeitStyles(ref.dir);
  } catch (e) {
    if (!["ARBEIT_MISSING", "ARBEIT_AMBIGUOUS"].includes(toImstudiumError(e).code)) throw e;
  }
  const all = [...mine, ...(await bundledStyles()).filter((b) => !mine.some((m) => m.id === b.id))];
  const payload: StileOutput = {
    current,
    count: all.length,
    styles: all.map((s) => ({ id: s.id, title: s.title, class: s.class, locale: s.locale, source: s.source, note: BUNDLED_STYLE_NOTES[s.id] ?? null })),
  };
  const rows = payload.styles.map((s) => [s.id === current ? "▸" : " ", s.id, s.class === "note" ? "Fußnote" : "im Text", s.source === "bundled" ? "" : "Arbeit", s.note ?? s.title]);
  output(payload, [...table(rows, { maxWidths: [1, 40, 8, 6, 90] }), "", "Andere Stile (Lehrstuhl, Institut, Zeitschrift): imstudium stile find <wörter> · imstudium stile add <id>"].join("\n"));
}
