import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import type { Command } from "commander";
import {
  ARBEIT_TYP_LABEL,
  ARBEIT_TYPEN,
  applyFormvorgaben,
  CitationFormatter,
  checkArbeit,
  createArbeit,
  findLeitfaden,
  FORMVORGABEN_FIELDS,
  FORMVORGABEN_PRESETS,
  formvorgabenLines,
  formvorgabenPreset,
  ImstudiumError,
  listArbeiten,
  loadQuellen,
  loadStyle,
  parseAbgabe,
  parseArbeitTyp,
  parseUmfang,
  resolveArbeit,
  resolveWorkspaceCourse,
  saveArbeit,
  scanManuscript,
  setCurrentArbeit,
  VORLAGE_FORMATS,
  writeVorlagen,
  type ArbeitCourse,
  type VorlageFormat,
} from "@imstudium/sdk";
import type { ArbeitCheckOutput, ArbeitListOutput, DoctorStatus } from "@imstudium/contract";
import { arbeitContext, arbeitOption, arbeitShow, arbeitSummary, parseAssignments } from "../arbeit-arg.js";
import { courseOption, limitOption, outputOption, parseLimit, workspaceDir } from "../kit/args.js";
import { cell, daysLeftLabel, table } from "../kit/format.js";
import { act, getSdk, note, output, type Sdk } from "../runtime.js";

/**
 * `imstudium arbeit`: written work (Hausarbeit, Seminararbeit, Bachelor- and
 * Masterarbeit). An Arbeit is a folder with its citation registry
 * (quellen.json → quellen.bib), its style, its Formvorgaben and the brief
 * ARBEIT.md; `arbeit check` holds the manuscript against all of them.
 */

const ICON: Record<DoctorStatus, string> = { ok: "✓", warn: "!", fail: "✗", skip: "·" };

async function courseFor(sdk: Sdk, workspace: string, query: string): Promise<ArbeitCourse> {
  const ws = await sdk.studium.loadWorkspace(workspace).catch(() => null);
  if (!ws) return { id: null, title: query, path: null };
  const c = resolveWorkspaceCourse(ws, query, sdk.config.courseAliases);
  return { id: c.id, title: c.title, path: c.path ?? null };
}


function showText(out: ReturnType<typeof arbeitShow>): string {
  const a = out.arbeit;
  const q = out.quellen;
  return [
    `${a.title}`,
    `${ARBEIT_TYP_LABEL[a.typ]}${a.course ? ` · ${a.course.title}` : ""}${a.abgabe ? ` · Abgabe ${a.abgabe.split("-").reverse().join(".")} (${daysLeftLabel(out.daysLeft)})` : ""}${a.umfang ? ` · ${a.umfang.value} ${a.umfang.unit === "woerter" ? "Wörter" : a.umfang.unit === "zeichen" ? "Zeichen" : "Seiten"}` : ""}`,
    `Zitierstil: ${a.stil.title} (${a.stil.id}, ${a.stil.class === "note" ? "Fußnoten" : "im Text"}) · Sprache ${a.sprache}`,
    `Quellen: ${q.total} · ${q.verified} geprüft · ${q.problems} mit Problem · ${q.unverified} ungeprüft`,
    `Ordner: ${out.dir}`,
    "",
    "Formvorgaben:",
    ...formvorgabenLines(a.formvorgaben).map((l) => `  ${l}`),
    ...(a.hilfsmittel.length ? ["", "Hilfsmittel:", ...a.hilfsmittel.map((h, i) => `  ${i + 1}. ${h.werkzeug}: ${h.zweck}${h.teile ? ` (${h.teile})` : ""}`)] : []),
    "",
    "Weiter: imstudium quellen add <DOI|ISBN|URL> · imstudium zitieren <key>@<Seite> · imstudium arbeit check <manuskript>",
  ].join("\n");
}

async function listPayload(workspace: string): Promise<ArbeitListOutput> {
  const all = await listArbeiten(workspace);
  let current: string | null = null;
  try {
    current = (await resolveArbeit(workspace, { cwd: process.cwd() })).dir;
  } catch {
    current = null;
  }
  const arbeiten = await Promise.all(all.map(async (r) => arbeitSummary(r, await loadQuellen(r.dir), current)));
  return { workspace, current, count: arbeiten.length, arbeiten };
}

function listText(p: ArbeitListOutput): string {
  if (!p.arbeiten.length) return 'Noch keine Arbeit. Anfangen mit: imstudium arbeit new "<Titel>" --typ hausarbeit';
  return table(
    p.arbeiten.map((a) => [a.current ? "▸" : " ", a.slug, a.typ, a.abgabe ? `${a.abgabe} ${daysLeftLabel(a.daysLeft)}` : "", `${a.quellen.total} Q.`, a.stil, a.title]),
    { maxWidths: [1, 32, 14, 22, 6, 24] },
  ).join("\n");
}

export function registerArbeit(program: Command): void {
  const arbeit = program
    .command("arbeit")
    .description("Written work (Hausarbeit, Seminar-, Bachelor-, Masterarbeit): registry, style, Formvorgaben, checks")
    .addOption(outputOption())
    .action(
      act(async (opts: { output?: string }) => {
        const sdk = await getSdk({ silentRefresh: false });
        const payload = await listPayload(workspaceDir(sdk, opts));
        output(payload, listText(payload));
      }),
    );

  arbeit
    .command("list")
    .description("Every Arbeit, in the workspace and in folders elsewhere")
    .addOption(outputOption())
    .action(
      act(async (opts: { output?: string }) => {
        const sdk = await getSdk({ silentRefresh: false });
        const payload = await listPayload(workspaceDir(sdk, opts));
        output(payload, listText(payload));
      }),
    );

  arbeit
    .command("new")
    .alias("neu")
    .description("Start an Arbeit: its folder, an empty citation registry, quellen.bib and ARBEIT.md")
    .argument("<title...>", "Working title")
    .option("--typ <typ>", `${ARBEIT_TYPEN.join(", ")} (default hausarbeit)`)
    .option("--stil <id>", "Citation style: a bundled id (imstudium stile), a .csl file, or one you add later with stile add (default from --preset)")
    .option("--preset <name>", `Formvorgaben to start from: ${Object.keys(FORMVORGABEN_PRESETS).join(", ")} (default standard)`)
    .addOption(courseOption("The course it is written for (title fragment, shortcut or slug)"))
    .option("--abgabe <date>", "Deadline, 2027-03-15 or 15.03.2027")
    .option("--umfang <length>", "Required length: 15s (Seiten), 6000w (Wörter) or 40000z (Zeichen)")
    .option("--toleranz <percent>", "Allowed deviation from --umfang in percent (default 10)")
    .option("--sprache <lang>", "Language of the work, e.g. de-DE or en-US (default: the style's, else de-DE)")
    .option("--betreuung <name>", "Supervisor (stays in your workspace)")
    .option("--slug <slug>", "Folder name under arbeiten/ (default from the title)")
    .option("--dir <folder>", "Create the Arbeit in this folder instead (e.g. your LaTeX or Typst project)")
    .addOption(outputOption())
    .action(
      act(async (words: string[], opts: { typ?: string; stil?: string; preset?: string; course?: string; abgabe?: string; umfang?: string; toleranz?: string; sprache?: string; betreuung?: string; slug?: string; dir?: string; output?: string }) => {
        const sdk = await getSdk({ silentRefresh: false });
        const workspace = workspaceDir(sdk, opts);
        const tol = opts.toleranz !== undefined ? parseLimit(opts.toleranz, 10, "toleranz", 0) : undefined;
        const ref = await createArbeit(workspace, {
          title: words.join(" "),
          typ: opts.typ ? parseArbeitTyp(opts.typ) : undefined,
          stil: opts.stil,
          preset: opts.preset,
          sprache: opts.sprache,
          course: opts.course ? await courseFor(sdk, workspace, opts.course) : null,
          betreuung: opts.betreuung ?? null,
          abgabe: opts.abgabe ? parseAbgabe(opts.abgabe) : null,
          umfang: opts.umfang ? parseUmfang(opts.umfang, tol) : null,
          slug: opts.slug,
          dir: opts.dir ? resolve(opts.dir) : undefined,
        });
        const payload = arbeitShow(ref, await loadQuellen(ref.dir));
        output(payload, `Angelegt: ${ref.dir}\n\n${showText(payload)}\n\nPrüfe die Formvorgaben gegen deinen Leitfaden: imstudium arbeit leitfaden${opts.course ? ` --course "${opts.course}"` : ""}`);
      }),
    );

  arbeit
    .command("show")
    .description("One Arbeit: deadline, length, style, Formvorgaben, aids and the registry's state")
    .argument("[arbeit]", "Slug, title fragment or folder (same as --arbeit)")
    .addOption(arbeitOption())
    .addOption(outputOption())
    .action(
      act(async (name: string | undefined, opts: { arbeit?: string; output?: string }) => {
        const { ref, quellen } = await arbeitContext({ ...opts, arbeit: opts.arbeit ?? name });
        const payload = arbeitShow(ref, quellen);
        output(payload, showText(payload));
      }),
    );

  arbeit
    .command("use")
    .description("Pick the Arbeit commands use when you are not inside its folder")
    .argument("<arbeit>", "Slug, title fragment or folder")
    .addOption(outputOption())
    .action(
      act(async (name: string, opts: { output?: string }) => {
        const sdk = await getSdk({ silentRefresh: false });
        const workspace = workspaceDir(sdk, opts);
        const ref = await resolveArbeit(workspace, { arbeit: name, cwd: process.cwd() });
        await setCurrentArbeit(workspace, ref);
        output({ current: ref.dir, slug: ref.arbeit.slug }, `Ausgewählt: ${ref.arbeit.title} (${ref.dir})`);
      }),
    );

  arbeit
    .command("set")
    .description("Change title, typ, abgabe, umfang, stil, sprache, betreuung, course or manuskript (key=value)")
    .argument("<assignments...>", 'e.g. abgabe=2027-03-15 umfang=6000w manuskript=~/thesis/main.tex stil=ieee')
    .addOption(arbeitOption())
    .addOption(outputOption())
    .action(
      act(async (items: string[], opts: { arbeit?: string; output?: string }) => {
        const { sdk, workspace, ref, quellen } = await arbeitContext(opts);
        const a = ref.arbeit;
        for (const [key, value] of parseAssignments(items)) {
          switch (key) {
            case "title":
            case "titel":
              if (!value) throw new ImstudiumError("title needs a value", "BAD_ARGS");
              a.title = value;
              break;
            case "typ":
              a.typ = parseArbeitTyp(value);
              break;
            case "abgabe":
              a.abgabe = value ? parseAbgabe(value) : null;
              break;
            case "umfang":
              a.umfang = value ? parseUmfang(value, a.umfang?.toleranz) : null;
              break;
            case "toleranz":
              if (!a.umfang) throw new ImstudiumError("Set umfang first", "BAD_ARGS", undefined, "imstudium arbeit set umfang=15s toleranz=10");
              a.umfang.toleranz = parseLimit(value, 10, "toleranz", 0);
              break;
            case "sprache":
              a.sprache = value || "de-DE";
              break;
            case "betreuung":
              a.betreuung = value || null;
              break;
            case "course":
            case "kurs":
              a.course = value ? await courseFor(sdk, workspace, value) : null;
              break;
            case "manuskript": {
              if (!value) {
                a.manuskript = null;
                break;
              }
              const abs = resolve(value.replace(/^~(?=\/)/, process.env.HOME ?? "~"));
              if (!existsSync(abs)) throw new ImstudiumError(`No file at ${abs}`, "NOT_FOUND");
              a.manuskript = abs.startsWith(ref.dir) ? relative(ref.dir, abs) : abs;
              break;
            }
            case "stil": {
              const style = await loadStyle(value, ref.dir);
              a.stil = { id: style.info.id, title: style.info.title, file: style.info.source === "bundled" ? null : relative(ref.dir, style.info.path), class: style.info.class };
              break;
            }
            default:
              throw new ImstudiumError(`Unknown field "${key}"`, "BAD_ARGS", undefined, "Fields: title, typ, abgabe, umfang, toleranz, sprache, betreuung, course, manuskript, stil (Formvorgaben: imstudium arbeit formvorgaben set …)");
          }
        }
        await saveArbeit(ref, quellen);
        const payload = arbeitShow(ref, quellen);
        output(payload, showText(payload));
      }),
    );

  arbeit
    .command("check")
    .alias("pruefen")
    .description("Check the manuscript (.docx, .md, .tex, .typ) against the registry and the Formvorgaben")
    .argument("[manuskript]", "The manuscript file (default: manuskript set with arbeit set)")
    .addOption(arbeitOption())
    .addOption(outputOption())
    .action(
      act(async (file: string | undefined, opts: { arbeit?: string; output?: string }) => {
        const { ref, quellen } = await arbeitContext(opts);
        const path = file ? resolve(file) : ref.arbeit.manuskript ? (isAbsolute(ref.arbeit.manuskript) ? ref.arbeit.manuskript : resolve(ref.dir, ref.arbeit.manuskript)) : null;
        const scan = path ? await scanManuscript(path) : null;
        const { checks, citations, pages } = checkArbeit(ref.arbeit, quellen, scan);
        const summary = { ok: 0, warn: 0, fail: 0, skip: 0 };
        for (const c of checks) summary[c.status]++;
        const payload: ArbeitCheckOutput = {
          ok: summary.fail === 0,
          dir: ref.dir,
          manuscript: scan ? { path: scan.path, format: scan.format, words: scan.words, chars: scan.chars, footnoteWords: scan.footnoteWords, pages: pages ?? 0, headings: scan.headings } : null,
          citations,
          summary,
          checks,
        };
        const lines = [
          `${ref.arbeit.title}${scan ? ` · ${scan.path} (${scan.format}, ${scan.words} Wörter, ca. ${pages} Seiten)` : " · ohne Manuskript (nur das Register)"}`,
          "",
          ...checks.flatMap((c) => [`${ICON[c.status]} ${cell(c.title, 34)} ${c.detail}`, ...(c.fix && c.status !== "ok" ? [`  → ${c.fix}`] : [])]),
          "",
          `${summary.ok} ok · ${summary.warn} Hinweise · ${summary.fail} Fehler`,
          ...(scan ? [] : ["", "Mit Manuskript: imstudium arbeit check <datei> (oder einmal: imstudium arbeit set manuskript=<datei>)"]),
        ];
        output(payload, lines.join("\n"));
        if (!payload.ok) process.exitCode = 1;
      }),
    );

  const form = arbeit
    .command("formvorgaben")
    .alias("form")
    .description("The Formvorgaben: margins, type, spacing, numbering, Deckblatt, parts, declaration")
    .addOption(arbeitOption())
    .addOption(outputOption())
    .action(
      act(async (opts: { arbeit?: string; output?: string }) => {
        const { ref } = await arbeitContext(opts);
        const f = ref.arbeit.formvorgaben;
        output({ formvorgaben: f, presets: Object.keys(FORMVORGABEN_PRESETS) }, [...formvorgabenLines(f), "", "Ändern: imstudium arbeit formvorgaben set rand.links=3 schrift.familie=Arial (Felder: imstudium arbeit formvorgaben set --help)"].join("\n"));
      }),
    );

  form
    .command("set")
    .description(`Change fields (key=value; lists with ; and += to append). Fields: ${Object.keys(FORMVORGABEN_FIELDS).join(", ")}`)
    .argument("<assignments...>", 'e.g. rand.links=4 zeilenabstand=1,5 "pflichtabschnitte=Einleitung;Fazit" quelle=Leitfaden.pdf')
    .addOption(arbeitOption())
    .addOption(outputOption())
    .action(
      act(async (items: string[], opts: { arbeit?: string; output?: string }) => {
        const { ref, quellen } = await arbeitContext(opts);
        ref.arbeit.formvorgaben = applyFormvorgaben(ref.arbeit.formvorgaben, items);
        await saveArbeit(ref, quellen);
        output({ formvorgaben: ref.arbeit.formvorgaben }, formvorgabenLines(ref.arbeit.formvorgaben).join("\n"));
      }),
    );

  form
    .command("preset")
    .description(`Start over from a preset: ${Object.entries(FORMVORGABEN_PRESETS).map(([k, v]) => `${k} (${v.title})`).join("; ")}`)
    .argument("<name>", Object.keys(FORMVORGABEN_PRESETS).join(" | "))
    .option("--with-stil", "Also switch to the preset's citation style")
    .addOption(arbeitOption())
    .addOption(outputOption())
    .action(
      act(async (name: string, opts: { withStil?: boolean; arbeit?: string; output?: string }) => {
        const { ref, quellen } = await arbeitContext(opts);
        ref.arbeit.formvorgaben = formvorgabenPreset(name);
        if (opts.withStil) {
          const style = await loadStyle(FORMVORGABEN_PRESETS[name]!.stil, ref.dir);
          ref.arbeit.stil = { id: style.info.id, title: style.info.title, file: null, class: style.info.class };
        }
        await saveArbeit(ref, quellen);
        output({ formvorgaben: ref.arbeit.formvorgaben, stil: ref.arbeit.stil.id }, formvorgabenLines(ref.arbeit.formvorgaben).join("\n"));
      }),
    );

  arbeit
    .command("vorlage")
    .description("Write templates that follow the Formvorgaben: Word (.docx), LaTeX, Typst, Pandoc")
    .option("--format <formats>", `Comma-separated: ${VORLAGE_FORMATS.join(",")} or all (default docx)`)
    .option("--force", "Overwrite templates that exist")
    .addOption(arbeitOption())
    .addOption(outputOption())
    .action(
      act(async (opts: { format?: string; force?: boolean; arbeit?: string; output?: string }) => {
        const { ref, quellen } = await arbeitContext(opts);
        const wanted = (opts.format ?? "docx").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
        const formats = (wanted.includes("all") ? VORLAGE_FORMATS : wanted) as VorlageFormat[];
        const bad = formats.filter((f) => !VORLAGE_FORMATS.includes(f));
        if (bad.length) throw new ImstudiumError(`Unknown --format: ${bad.join(", ")}`, "BAD_ARGS", undefined, `Choose from: ${VORLAGE_FORMATS.join(",")},all`);
        const items = quellen.items.map((q) => q.csl);
        let bibliographyHtml: string[] = [];
        let exampleCite: string | null = null;
        let hangingIndent = true;
        if (items.length) {
          const html = await CitationFormatter.create({ style: ref.arbeit.stil.id, items, arbeitDir: ref.dir, lang: ref.arbeit.sprache, format: "html" });
          const bib = html.bibliography();
          bibliographyHtml = bib.entries.map((e) => e.text);
          hangingIndent = bib.hangingIndent;
          exampleCite = html.cite([{ key: items[0]!.id, locator: "12" }]);
        }
        const written = await writeVorlagen({ ref, bibliographyHtml, hangingIndent, exampleCite, exampleKey: items[0]?.id ?? null }, formats, { force: opts.force });
        const lines = written.map((w) => `${w.skipped ? "· vorhanden" : "✓ geschrieben"}  ${w.path}`);
        output({ dir: ref.dir, written }, [...lines, "", written.some((w) => w.skipped) ? "Vorhandene Dateien bleiben; --force überschreibt sie." : "Deckblatt-Platzhalter ersetzen, Erklärung aus der Prüfungsordnung einfügen."].join("\n"));
      }),
    );

  arbeit
    .command("leitfaden")
    .description("Find the Leitfaden or Formvorgaben in your course files (offline search)")
    .addOption(courseOption("Only this course"))
    .addOption(limitOption(8, "Files"))
    .addOption(outputOption())
    .action(
      act(async (opts: { course?: string; limit?: string; output?: string }) => {
        const sdk = await getSdk({ silentRefresh: false });
        const workspace = workspaceDir(sdk, opts);
        let course: string | undefined;
        if (opts.course) {
          const ws = await sdk.studium.loadWorkspace(workspace);
          course = ws ? resolveWorkspaceCourse(ws, opts.course, sdk.config.courseAliases).slug : opts.course;
        }
        const hits = await findLeitfaden(workspace, { course, limit: parseLimit(opts.limit, 8) });
        const lines = hits.length
          ? [...hits.flatMap((h, i) => [`${String(i + 1).padStart(2)}. ${h.citation}  (${h.matches} Treffer)`, `    ${h.path}${h.page ? `  (Seite ${h.page})` : ""}`]), "", "Lies die Vorgaben und übernimm sie: imstudium arbeit formvorgaben set … quelle=<Datei>"]
          : ["Kein Leitfaden in den extrahierten Kursdateien gefunden. Erst imstudium sync --extract, oder den Leitfaden der Website des Lehrstuhls nehmen."];
        output({ count: hits.length, hits }, lines.join("\n"));
      }),
    );

  const hilfe = arbeit
    .command("hilfsmittel")
    .description("Aids you used (AI tools and others), for the declaration many Prüfungsordnungen require")
    .addOption(arbeitOption())
    .addOption(outputOption())
    .action(
      act(async (opts: { arbeit?: string; output?: string }) => {
        const { ref } = await arbeitContext(opts);
        const h = ref.arbeit.hilfsmittel;
        output({ hilfsmittel: h }, h.length ? h.map((x, i) => `${i + 1}. ${x.werkzeug}: ${x.zweck}${x.teile ? ` (${x.teile})` : ""} · ${x.at.slice(0, 10)}`).join("\n") : 'Keine Hilfsmittel eingetragen. Eintragen: imstudium arbeit hilfsmittel add "DeepL Write" --zweck "Rechtschreibung" --teile "ganze Arbeit"');
      }),
    );

  hilfe
    .command("add")
    .description("Record one aid: product and version, what for, which parts")
    .argument("<werkzeug...>", 'Product and version, e.g. "ChatGPT (GPT-5)"')
    .requiredOption("--zweck <text>", "What it was used for, e.g. Gliederung besprochen, Rechtschreibung")
    .option("--teile <text>", "Which parts of the work, e.g. Kapitel 2")
    .addOption(arbeitOption())
    .addOption(outputOption())
    .action(
      act(async (words: string[], opts: { zweck: string; teile?: string; arbeit?: string; output?: string }) => {
        const { ref, quellen } = await arbeitContext(opts);
        ref.arbeit.hilfsmittel.push({ werkzeug: words.join(" "), zweck: opts.zweck, ...(opts.teile ? { teile: opts.teile } : {}), at: new Date().toISOString() });
        await saveArbeit(ref, quellen);
        output({ hilfsmittel: ref.arbeit.hilfsmittel }, `Eingetragen (${ref.arbeit.hilfsmittel.length}). Die Vorlage listet sie unter der Erklärung: imstudium arbeit vorlage --force`);
      }),
    );

  hilfe
    .command("rm")
    .description("Remove an aid by its number")
    .argument("<number>", "As listed by imstudium arbeit hilfsmittel")
    .addOption(arbeitOption())
    .addOption(outputOption())
    .action(
      act(async (n: string, opts: { arbeit?: string; output?: string }) => {
        const { ref, quellen } = await arbeitContext(opts);
        const i = parseLimit(n, 1, "number") - 1;
        if (i >= ref.arbeit.hilfsmittel.length) throw new ImstudiumError(`No aid number ${i + 1}`, "NOT_FOUND", undefined, "imstudium arbeit hilfsmittel lists them");
        const [removed] = ref.arbeit.hilfsmittel.splice(i, 1);
        await saveArbeit(ref, quellen);
        note(`Entfernt: ${removed!.werkzeug}`);
        output({ hilfsmittel: ref.arbeit.hilfsmittel }, ref.arbeit.hilfsmittel.length ? `${ref.arbeit.hilfsmittel.length} Hilfsmittel` : "Keine Hilfsmittel mehr eingetragen");
      }),
    );

}
