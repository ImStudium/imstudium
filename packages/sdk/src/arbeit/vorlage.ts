import { existsSync } from "node:fs";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { loadStyle } from "./styles.js";
import { ARBEIT_TYP_LABEL, type ArbeitRef, type Formvorgaben, type Hilfsmittel } from "./types.js";
import { writeZip } from "./zip.js";

/**
 * Templates that already follow the Formvorgaben: a Word document (.docx,
 * also Pandoc's reference doc), LaTeX (KOMA-Script + biblatex), Typst (with
 * the Arbeit's own CSL style) and Pandoc (defaults file + markdown
 * skeleton). Every template reads `quellen.bib`; none holds personal data,
 * the Deckblatt has placeholders.
 */

export type VorlageFormat = "docx" | "latex" | "typst" | "pandoc";
export const VORLAGE_FORMATS: VorlageFormat[] = ["docx", "latex", "typst", "pandoc"];

export interface VorlageInput {
  ref: ArbeitRef;
  /** Formatted bibliography entries (citeproc HTML) for the Word template's Literaturverzeichnis. */
  bibliographyHtml?: string[];
  hangingIndent?: boolean;
  /** A formatted example citation (footnote text for note styles, in-text otherwise). */
  exampleCite?: string | null;
  /** The first citekey, for example cites in the LaTeX/Typst/Markdown skeletons. */
  exampleKey?: string | null;
}

const isLong = (ref: ArbeitRef) => ["bachelorarbeit", "masterarbeit", "dissertation"].includes(ref.arbeit.typ);

/** The text sections in order: the Pflichtabschnitte (first alternative each), a Hauptteil between them. */
function textSections(f: Formvorgaben): string[] {
  const names = f.pflichtabschnitte.map((p) => p.split("|")[0]!.trim()).filter(Boolean);
  if (!names.length) return ["Einleitung", "Hauptteil", "Fazit"];
  if (names.length === 1) return [names[0]!, "Hauptteil"];
  return [names[0]!, "Hauptteil", ...names.slice(1)];
}

const placeholder = (field: string) => `[${field}]`;

const DECLARATION_HINT = "[Hier den Wortlaut der Eigenständigkeitserklärung aus deiner Prüfungsordnung einfügen, mit Ort, Datum und Unterschrift.]";

function hilfsmittelRows(h: Hilfsmittel[]): string[][] {
  return h.map((x) => [x.werkzeug, x.zweck, x.teile ?? "", x.at.slice(0, 10).split("-").reverse().join(".")]);
}

// ── LaTeX ───────────────────────────────────────────────────────────────────

const BIBLATEX_STYLE: Record<string, string> = {
  apa: "apa",
  "deutsche-gesellschaft-fur-psychologie": "apa",
  ieee: "ieee",
  "modern-language-association": "mla",
  "din-1505-2-numeric": "numeric-comp",
  "elsevier-vancouver": "numeric-comp",
  "juristische-zitierweise": "ext-verbose-trad2",
  "chicago-notes-bibliography": "ext-verbose-trad2",
};

const texEscape = (s: string) => s.replace(/([\\{}&%$#_])/g, (m) => (m === "\\" ? "\\textbackslash{}" : `\\${m}`)).replace(/~/g, "\\textasciitilde{}").replace(/\^/g, "\\textasciicircum{}");

export function latexTemplate(input: VorlageInput): string {
  const { ref } = input;
  const a = ref.arbeit;
  const f = a.formvorgaben;
  const long = isLong(ref);
  const sec = long ? "chapter" : "section";
  const style = BIBLATEX_STYLE[a.stil.id] ?? (a.stil.class === "note" ? "ext-verbose-trad2" : "ext-authoryear");
  const babel = a.sprache.startsWith("en") ? "english" : a.sprache === "de-AT" ? "naustrian" : a.sprache === "de-CH" ? "nswissgerman" : "ngerman";
  const key = input.exampleKey ?? "key";
  const jura = f.nummerierung === "juristisch";
  const lines = [
    `% ${a.title}: ${ARBEIT_TYP_LABEL[a.typ]}`,
    `% Vorlage von ImStudium. Formvorgaben „${f.preset}“${f.quelle ? ` nach ${f.quelle}` : " (mit deinem Leitfaden abgleichen)"}.`,
    "% Übersetzen mit LuaLaTeX und Biber: lualatex arbeit && biber arbeit && lualatex arbeit",
    "",
    `\\documentclass[${f.schrift.groesse}pt,a4paper,oneside,${babel},${f.absatz.einzug > 0 ? "parskip=false" : "parskip=half"},numbers=noenddot]{${long ? "scrreprt" : "scrartcl"}}`,
    `\\usepackage[${babel}]{babel}`,
    "\\usepackage{fontspec}",
    `\\setmainfont{${f.schrift.familie}}`,
    `\\usepackage[top=${f.rand.oben}cm,bottom=${f.rand.unten}cm,left=${f.rand.links}cm,right=${f.rand.rechts}cm]{geometry}`,
    "\\usepackage{setspace}",
    `\\setstretch{${f.zeilenabstand === 1.5 ? "1.5" : f.zeilenabstand === 2 ? "2" : f.zeilenabstand}}`,
    "\\usepackage{microtype}",
    ...(f.ausrichtung === "links" ? ["\\usepackage[newcommands]{ragged2e}", "\\RaggedRight"] : []),
    ...(f.silbentrennung ? [] : ["\\hyphenpenalty=10000", "\\exhyphenpenalty=10000"]),
    ...(f.absatz.einzug > 0 ? [`\\setlength{\\parindent}{${f.absatz.einzug}cm}`] : []),
    `\\setkomafont{footnote}{\\fontsize{${f.schrift.fussnoten}pt}{${Math.round(f.schrift.fussnoten * 1.2)}pt}\\selectfont}`,
    "\\usepackage[autostyle]{csquotes}",
    `\\usepackage[backend=biber,style=${style}]{biblatex}`,
    "\\addbibresource{../quellen.bib}",
    `% Genau der CSL-Stil „${a.stil.id}“ wie in Zotero: statt biblatex das Paket citation-style-language (LuaLaTeX):`,
    "%   \\usepackage{citation-style-language}",
    `%   \\cslsetup{style = ../stil/${a.stil.id}}`,
    "%   \\addbibresource{../quellen.bib}",
    ...(jura
      ? [
          "% Juristische Gliederung: A. I. 1. a) aa) (1)",
          "\\setcounter{secnumdepth}{6}",
          `\\renewcommand*{\\the${long ? "chapter" : "section"}}{\\Alph{${long ? "chapter" : "section"}}.}`,
          `\\renewcommand*{\\the${long ? "section" : "subsection"}}{\\Roman{${long ? "section" : "subsection"}}.}`,
          `\\renewcommand*{\\the${long ? "subsection" : "subsubsection"}}{\\arabic{${long ? "subsection" : "subsubsection"}}.}`,
          `\\renewcommand*{\\the${long ? "subsubsection" : "paragraph"}}{\\alph{${long ? "subsubsection" : "paragraph"}})}`,
        ]
      : f.nummerierung === "keine"
        ? ["\\setcounter{secnumdepth}{0}"]
        : []),
    "\\usepackage[hidelinks]{hyperref}",
    "",
    "\\begin{document}",
    "",
    "\\begin{titlepage}",
    "  \\centering",
    ...f.deckblatt.map((d) => (d === "Titel" ? `  \\vspace{2cm}{\\LARGE\\bfseries ${texEscape(a.title)}\\par}\\vspace{1cm}` : d === "Art der Arbeit" ? `  {\\large ${ARBEIT_TYP_LABEL[a.typ]}\\par}` : `  ${texEscape(placeholder(d))}\\par`)),
    "\\end{titlepage}",
    "",
    f.seitenzahlen.vorspann === "roemisch" ? "\\pagenumbering{Roman}" : f.seitenzahlen.vorspann === "keine" ? "\\pagestyle{empty}" : "\\pagenumbering{arabic}",
    "\\tableofcontents",
    ...(f.gliederung.includes("Abbildungsverzeichnis") ? ["\\listoffigures"] : []),
    ...(f.gliederung.includes("Tabellenverzeichnis") ? ["\\listoftables"] : []),
    ...(f.gliederung.includes("Abkürzungsverzeichnis") ? [`\\${sec}*{Abkürzungsverzeichnis}`, `\\addcontentsline{toc}{${sec}}{Abkürzungsverzeichnis}`, "% \\begin{description} \\item[Abk.] Abkürzung \\end{description}"] : []),
    ...(f.gliederung.indexOf("Literaturverzeichnis") > -1 && f.gliederung.indexOf("Literaturverzeichnis") < f.gliederung.indexOf("Text") ? ["\\printbibliography[heading=bibintoc,title={Literaturverzeichnis}]"] : []),
    "\\clearpage",
    "\\pagestyle{plain}",
    "\\pagenumbering{arabic}",
    "",
    ...textSections(f).flatMap((s, i) => [
      `\\${sec}{${texEscape(s)}}`,
      i === 0 ? `Text. Ein Beleg mit Seite steht so: \\autocite[S.~12]{${key}}.` : "Text.",
      "",
    ]),
    ...(f.gliederung.indexOf("Literaturverzeichnis") >= f.gliederung.indexOf("Text") ? ["\\printbibliography[heading=bibintoc,title={Literaturverzeichnis}]", ""] : []),
    ...(f.gliederung.includes("Anhang") ? ["\\appendix", `\\${sec}{Anhang}`, ""] : []),
    ...(f.erklaerung.erforderlich
      ? [
          `\\${sec}*{Eigenständigkeitserklärung}`,
          texEscape(DECLARATION_HINT),
          ...(a.hilfsmittel.length
            ? ["", "\\subsection*{Verwendete Hilfsmittel}", "\\begin{tabular}{p{4cm}p{5cm}p{3cm}p{2cm}}", "Werkzeug & Zweck & Teile & Datum\\\\\\hline", ...hilfsmittelRows(a.hilfsmittel).map((r) => `${r.map(texEscape).join(" & ")}\\\\`), "\\end{tabular}"]
            : []),
        ]
      : []),
    "",
    "\\end{document}",
    "",
  ];
  return lines.join("\n");
}

// ── Typst ───────────────────────────────────────────────────────────────────

const typStr = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
const typContent = (s: string) => s.replace(/([\\#$*_@<>`\[\]=~/])/g, "\\$1");

export function typstTemplate(input: VorlageInput): string {
  const { ref } = input;
  const a = ref.arbeit;
  const f = a.formvorgaben;
  const leading = Math.max(0.3, Math.round((f.zeilenabstand * 1.15 - 0.7) * 100) / 100);
  const blockLeading = Math.max(0.3, Math.round((f.blockzitat.zeilenabstand * 1.15 - 0.7) * 100) / 100);
  const numbering = f.nummerierung === "juristisch" ? "jura" : f.nummerierung === "alphanumerisch" ? '"A.I.1.a)"' : f.nummerierung === "keine" ? "none" : '"1.1"';
  const pageNum = (fmt: string) => (f.seitenzahlen.position === "oben-rechts" ? `numbering: ${fmt}, number-align: top + right` : f.seitenzahlen.position === "unten-rechts" ? `numbering: ${fmt}, number-align: bottom + right` : `numbering: ${fmt}`);
  const key = input.exampleKey ?? "key";
  const bibBefore = f.gliederung.indexOf("Literaturverzeichnis") > -1 && f.gliederung.indexOf("Literaturverzeichnis") < f.gliederung.indexOf("Text");
  const bib = `#bibliography("../quellen.bib", style: "../stil/${a.stil.id}.csl", title: "Literaturverzeichnis")`;
  return [
    `// ${a.title}: ${ARBEIT_TYP_LABEL[a.typ]}`,
    `// Vorlage von ImStudium. Formvorgaben „${f.preset}“${f.quelle ? ` nach ${f.quelle}` : " (mit deinem Leitfaden abgleichen)"}.`,
    "// Übersetzen: typst compile arbeit.typ",
    "",
    ...(f.nummerierung === "juristisch"
      ? [
          "// Juristische Gliederung: A. I. 1. a) aa) (1)",
          "#let jura(..nums) = {",
          "  let n = nums.pos()",
          "  let v = n.last()",
          "  let i = n.len() - 1",
          '  if i == 0 { numbering("A.", v) } else if i == 1 { numbering("I.", v) } else if i == 2 { numbering("1.", v) }',
          '  else if i == 3 { numbering("a)", v) } else if i == 4 { numbering("a", v) + numbering("a", v) + ")" } else { "(" + str(v) + ")" }',
          "}",
          "",
        ]
      : []),
    `#set document(title: ${typStr(a.title)})`,
    `#set page(paper: "a4", margin: (top: ${f.rand.oben}cm, bottom: ${f.rand.unten}cm, left: ${f.rand.links}cm, right: ${f.rand.rechts}cm), numbering: none)`,
    `#set text(font: (${typStr(f.schrift.familie)}, "TeX Gyre Termes", "Liberation Serif"), size: ${f.schrift.groesse}pt, lang: ${typStr(a.sprache.slice(0, 2))}, hyphenate: ${f.silbentrennung})`,
    `#set par(justify: ${f.ausrichtung === "blocksatz"}, leading: ${leading}em, first-line-indent: ${f.absatz.einzug}cm, spacing: ${f.absatz.abstand + Math.round(leading * f.schrift.groesse)}pt)`,
    `#set heading(numbering: ${numbering})`,
    `#show footnote.entry: set text(size: ${f.schrift.fussnoten}pt)`,
    `#show quote.where(block: true): it => block(inset: (left: ${f.blockzitat.einzug}cm), { set par(leading: ${blockLeading}em); it.body })`,
    "",
    "// Deckblatt (Platzhalter ersetzen)",
    "#page(numbering: none)[",
    "  #set align(center)",
    ...f.deckblatt.map((d) => (d === "Titel" ? `  #v(2cm) #text(size: 18pt, weight: "bold")[${typContent(a.title)}] #v(1cm)` : d === "Art der Arbeit" ? `  ${ARBEIT_TYP_LABEL[a.typ]} \\` : `  ${typContent(placeholder(d))} \\`)),
    "]",
    "",
    f.seitenzahlen.vorspann === "roemisch" ? `#set page(${pageNum('"I"')})` : f.seitenzahlen.vorspann === "arabisch" ? `#set page(${pageNum('"1"')})` : "#set page(numbering: none)",
    "#counter(page).update(1)",
    '#outline(title: "Inhaltsverzeichnis", indent: auto)',
    ...(f.gliederung.includes("Abbildungsverzeichnis") ? ['#outline(title: "Abbildungsverzeichnis", target: figure.where(kind: image))'] : []),
    ...(f.gliederung.includes("Tabellenverzeichnis") ? ['#outline(title: "Tabellenverzeichnis", target: figure.where(kind: table))'] : []),
    ...(bibBefore ? [bib] : []),
    "#pagebreak()",
    `#set page(${pageNum('"1"')})`,
    "#counter(page).update(1)",
    "",
    ...textSections(f).flatMap((s, i) => [`= ${typContent(s)}`, i === 0 ? `Text. Ein Beleg mit Seite steht so: @${key}[S. 12].` : "Text.", ""]),
    ...(bibBefore ? [] : [bib, ""]),
    ...(f.gliederung.includes("Anhang") ? ["= Anhang", ""] : []),
    ...(f.erklaerung.erforderlich
      ? [
          "#heading(numbering: none)[Eigenständigkeitserklärung]",
          typContent(DECLARATION_HINT),
          ...(a.hilfsmittel.length
            ? ["", "#heading(level: 2, numbering: none)[Verwendete Hilfsmittel]", "#table(columns: 4, [*Werkzeug*], [*Zweck*], [*Teile*], [*Datum*],", ...hilfsmittelRows(a.hilfsmittel).map((r) => `  ${r.map((c) => `[${typContent(c)}]`).join(", ")},`), ")"]
            : []),
        ]
      : []),
    "",
  ].join("\n");
}

// ── Pandoc ──────────────────────────────────────────────────────────────────

export function pandocDefaults(input: VorlageInput): string {
  const a = input.ref.arbeit;
  const f = a.formvorgaben;
  return [
    `# Pandoc-Defaults für „${a.title}“ (ImStudium).`,
    "# Word:  pandoc -d vorlage/pandoc.yaml vorlage/arbeit.md -o arbeit.docx",
    "# PDF:   pandoc -d vorlage/pandoc.yaml vorlage/arbeit.md -o arbeit.pdf --pdf-engine=lualatex",
    "from: markdown",
    "citeproc: true",
    "bibliography: ${.}/../quellen.bib",
    `csl: \${.}/../stil/${a.stil.id}.csl`,
    "reference-doc: ${.}/arbeit.docx",
    "metadata:",
    `  lang: ${a.sprache}`,
    "  link-citations: true",
    "  reference-section-title: Literaturverzeichnis",
    "variables:",
    `  documentclass: ${isLong(input.ref) ? "scrreprt" : "scrartcl"}`,
    `  geometry: [top=${f.rand.oben}cm, bottom=${f.rand.unten}cm, left=${f.rand.links}cm, right=${f.rand.rechts}cm]`,
    `  fontsize: ${f.schrift.groesse}pt`,
    `  linestretch: ${f.zeilenabstand}`,
    `  mainfont: ${f.schrift.familie}`,
    "",
  ].join("\n");
}

export function markdownSkeleton(input: VorlageInput): string {
  const a = input.ref.arbeit;
  const f = a.formvorgaben;
  const key = input.exampleKey ?? "key";
  return [
    "---",
    `title: ${JSON.stringify(a.title)}`,
    `subtitle: ${JSON.stringify(ARBEIT_TYP_LABEL[a.typ])}`,
    "toc: true",
    ...(f.nummerierung !== "keine" ? ["numbersections: true"] : []),
    "---",
    "",
    ...textSections(f).flatMap((s, i) => [`# ${s}`, "", i === 0 ? `Text. Ein Beleg mit Seite steht so [@${key}, S. 12].` : "Text.", ""]),
    "# Literaturverzeichnis {-}",
    "",
    "::: {#refs}",
    ":::",
    "",
  ].join("\n");
}

// ── Word (.docx) ────────────────────────────────────────────────────────────

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const cmTw = (cm: number) => Math.round(cm * 567);
const W_NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

function run(text: string, rpr = ""): string {
  return `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ""}<w:t xml:space="preserve">${xml(text)}</w:t></w:r>`;
}

/** citeproc HTML → Word runs (italic, bold, small caps, super/subscript). */
export function htmlToRuns(html: string): string {
  const out: string[] = [];
  const state = { i: 0, b: 0, sc: 0, sup: 0, sub: 0 };
  const stack: Array<keyof typeof state | null> = [];
  for (const tok of html.replace(/<\/?div[^>]*>/g, "").split(/(<[^>]+>)/)) {
    if (!tok) continue;
    if (tok.startsWith("<")) {
      const close = tok.startsWith("</");
      const name = /<\/?\s*([a-z]+)/i.exec(tok)?.[1]?.toLowerCase();
      if (close) {
        const k = stack.pop();
        if (k) state[k]--;
        continue;
      }
      const k: keyof typeof state | null = name === "i" || name === "em" ? "i" : name === "b" || name === "strong" ? "b" : name === "sup" ? "sup" : name === "sub" ? "sub" : name === "span" && /small-caps/.test(tok) ? "sc" : null;
      if (k) state[k]++;
      stack.push(k);
      continue;
    }
    const text = tok
      .replace(/&#38;|&amp;/g, "&")
      .replace(/&#60;|&lt;/g, "<")
      .replace(/&#62;|&gt;/g, ">")
      .replace(/&#160;|&nbsp;/g, " ")
      .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)));
    const rpr = `${state.i ? "<w:i/>" : ""}${state.b ? "<w:b/>" : ""}${state.sc ? "<w:smallCaps/>" : ""}${state.sup ? '<w:vertAlign w:val="superscript"/>' : state.sub ? '<w:vertAlign w:val="subscript"/>' : ""}`;
    out.push(run(text, rpr));
  }
  return out.join("");
}

function para(content: string, style?: string, extraPpr = ""): string {
  return `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ""}${extraPpr}</w:pPr>${content}</w:p>`;
}

function field(instr: string, placeholderText: string): string {
  return `<w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r><w:r><w:instrText xml:space="preserve"> ${xml(instr)} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${run(placeholderText)}<w:r><w:fldChar w:fldCharType="end"/></w:r>`;
}

function stylesXml(f: Formvorgaben, lang: string, hanging: boolean): string {
  const sz = Math.round(f.schrift.groesse * 2);
  const fn = Math.round(f.schrift.fussnoten * 2);
  const font = xml(f.schrift.familie);
  const line = Math.round(f.zeilenabstand * 240);
  const jc = f.ausrichtung === "blocksatz" ? "both" : "left";
  const heading = (n: number, size: number, outline: number) =>
    `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="${n === 1 ? 360 : 240}" w:after="120"/><w:jc w:val="left"/><w:ind w:firstLine="0"/>${f.nummerierung !== "keine" ? `<w:numPr><w:ilvl w:val="${n - 1}"/><w:numId w:val="1"/></w:numPr>` : ""}<w:outlineLvl w:val="${outline}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:style>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${W_NS}>
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}" w:eastAsia="${font}"/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/><w:lang w:val="${xml(lang)}"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="${Math.round(f.absatz.abstand * 20)}" w:line="${line}" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:jc w:val="${jc}"/>${f.absatz.einzug ? `<w:ind w:firstLine="${cmTw(f.absatz.einzug)}"/>` : ""}</w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:jc w:val="center"/><w:ind w:firstLine="0"/><w:spacing w:before="480" w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Deckblatt"><w:name w:val="Deckblatt"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:ind w:firstLine="0"/><w:spacing w:after="120" w:line="240" w:lineRule="auto"/></w:pPr></w:style>
${heading(1, sz + 8, 0)}
${heading(2, sz + 4, 1)}
${heading(3, sz, 2)}
<w:style w:type="paragraph" w:styleId="HeadingUnnumbered"><w:name w:val="Überschrift ohne Nummer"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="120"/><w:jc w:val="left"/><w:ind w:firstLine="0"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="${sz + 8}"/><w:szCs w:val="${sz + 8}"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Blockzitat"><w:name w:val="Blockzitat"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="${cmTw(f.blockzitat.einzug)}" w:firstLine="0"/><w:spacing w:line="${Math.round(f.blockzitat.zeilenabstand * 240)}" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="${Math.max(16, sz - 2)}"/><w:szCs w:val="${Math.max(16, sz - 2)}"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Literaturverzeichnis"><w:name w:val="Bibliography"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="left"/>${hanging ? `<w:ind w:left="${cmTw(1.27)}" w:hanging="${cmTw(1.27)}"/>` : '<w:ind w:left="0" w:firstLine="0"/>'}<w:spacing w:after="120" w:line="240" w:lineRule="auto"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="FootnoteText"><w:name w:val="footnote text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:ind w:firstLine="0"/></w:pPr><w:rPr><w:sz w:val="${fn}"/><w:szCs w:val="${fn}"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:firstLine="0"/></w:pPr><w:rPr><w:i/><w:sz w:val="${fn}"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="TOC1"><w:name w:val="toc 1"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:firstLine="0"/><w:spacing w:after="60"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="TOC2"><w:name w:val="toc 2"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="240" w:firstLine="0"/><w:spacing w:after="60"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="TOC3"><w:name w:val="toc 3"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="480" w:firstLine="0"/><w:spacing w:after="60"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:firstLine="0"/><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders></w:tblPr></w:style>
</w:styles>`;
}

function numberingXml(f: Formvorgaben): string {
  const levels: Array<[string, string]> =
    f.nummerierung === "juristisch"
      ? [["upperLetter", "%1."], ["upperRoman", "%2."], ["decimal", "%3."], ["lowerLetter", "%4)"], ["lowerLetter", "%5%5)"], ["decimal", "(%6)"]]
      : f.nummerierung === "alphanumerisch"
        ? [["upperLetter", "%1."], ["upperRoman", "%2."], ["decimal", "%3."], ["lowerLetter", "%4)"]]
        : [["decimal", "%1"], ["decimal", "%1.%2"], ["decimal", "%1.%2.%3"], ["decimal", "%1.%2.%3.%4"]];
  const lvls = levels
    .map(([fmt, text], i) => `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:pStyle w:val="Heading${i + 1}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${(i + 1) * 567}" w:hanging="${567 + i * 140}"/></w:pPr></w:lvl>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering ${W_NS}><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="multilevel"/>${lvls}</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;
}

function footerXml(f: Formvorgaben, fmt: "decimal" | "upperRoman" | null): string {
  const jc = f.seitenzahlen.position === "unten-mitte" ? "center" : "right";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr ${W_NS}>${fmt ? para(field("PAGE", "1"), "Footer", `<w:jc w:val="${jc}"/>`) : para("", "Footer")}</w:ftr>`;
}

function headerXml(f: Formvorgaben, fmt: "decimal" | "upperRoman" | null): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr ${W_NS}>${fmt && f.seitenzahlen.position === "oben-rechts" ? para(field("PAGE", "1"), "Footer", '<w:jc w:val="right"/>') : para("", "Footer")}</w:hdr>`;
}

export function docxTemplate(input: VorlageInput): Buffer {
  const { ref } = input;
  const a = ref.arbeit;
  const f = a.formvorgaben;
  const top = f.seitenzahlen.position === "oben-rechts";
  const margins = `<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="${cmTw(f.rand.oben)}" w:right="${cmTw(f.rand.rechts)}" w:bottom="${cmTw(f.rand.unten)}" w:left="${cmTw(f.rand.links)}" w:header="709" w:footer="709" w:gutter="0"/>`;
  const refs = (kind: "front" | "main") => (top ? `<w:headerReference w:type="default" r:id="rIdHdr${kind === "front" ? "Front" : "Main"}"/>` : `<w:footerReference w:type="default" r:id="rIdFtr${kind === "front" ? "Front" : "Main"}"/>`);
  const frontFmt = f.seitenzahlen.vorspann === "roemisch" ? "upperRoman" : f.seitenzahlen.vorspann === "arabisch" ? "decimal" : null;
  const body: string[] = [];
  // Deckblatt
  for (const d of f.deckblatt) {
    if (d === "Titel") body.push(para(run(a.title), "Title"));
    else if (d === "Art der Arbeit") body.push(para(run(ARBEIT_TYP_LABEL[a.typ]), "Deckblatt"));
    else body.push(para(run(placeholder(d)), "Deckblatt"));
  }
  body.push(para('<w:r><w:br w:type="page"/></w:r>'));
  const textIdx = f.gliederung.indexOf("Text");
  const exampleFootnote = a.stil.class === "note";
  const parts = f.gliederung.filter((g) => g !== "Deckblatt");
  let frontClosed = false;
  const closeFront = () => {
    if (frontClosed) return;
    frontClosed = true;
    // section break: the front matter ends here (title page without a number)
    body.push(`<w:p><w:pPr><w:sectPr>${refs("front")}${margins}${frontFmt ? `<w:pgNumType w:fmt="${frontFmt}" w:start="1"/>` : ""}<w:titlePg/></w:sectPr></w:pPr></w:p>`);
  };
  for (const part of parts) {
    const idx = f.gliederung.indexOf(part);
    if (idx >= textIdx && textIdx > -1) closeFront();
    if (part === "Inhaltsverzeichnis") {
      body.push(para(run("Inhaltsverzeichnis"), "HeadingUnnumbered"), para(field('TOC \\o "1-3" \\h \\z \\u', "Rechtsklick → Feld aktualisieren, um das Inhaltsverzeichnis zu erzeugen.")));
    } else if (part === "Abbildungsverzeichnis") {
      body.push(para(run("Abbildungsverzeichnis"), "HeadingUnnumbered"), para(field('TOC \\h \\z \\c "Abbildung"', "Rechtsklick → Feld aktualisieren.")));
    } else if (part === "Tabellenverzeichnis") {
      body.push(para(run("Tabellenverzeichnis"), "HeadingUnnumbered"), para(field('TOC \\h \\z \\c "Tabelle"', "Rechtsklick → Feld aktualisieren.")));
    } else if (part === "Text") {
      textSections(f).forEach((s, i) => {
        body.push(para(run(s), "Heading1"));
        if (i === 0) {
          const cite = input.exampleCite;
          if (exampleFootnote) {
            body.push(para(`${run("Text. Ein Beleg steht in der Fußnote.")}<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="1"/></w:r>`));
          } else {
            body.push(para(run(`Text. Ein Beleg steht so im Text: ${cite ?? "(Autor, Jahr, S. 12)"}.`)));
          }
          body.push(para(run("Ein direktes Zitat ab der in den Formvorgaben genannten Länge steht eingerückt als Blockzitat."), "Blockzitat"));
        } else body.push(para(run("Text.")));
      });
    } else if (part === "Literaturverzeichnis") {
      body.push(para(run("Literaturverzeichnis"), "HeadingUnnumbered"));
      const entries = input.bibliographyHtml ?? [];
      if (entries.length) for (const e of entries) body.push(para(htmlToRuns(e), "Literaturverzeichnis"));
      else body.push(para(run("[Literaturverzeichnis: imstudium literatur --format rtf, oder das Literaturverzeichnis aus Zotero einfügen]")));
    } else if (part === "Eigenständigkeitserklärung") {
      if (!f.erklaerung.erforderlich) continue;
      body.push(para(run("Eigenständigkeitserklärung"), "HeadingUnnumbered"), para(run(DECLARATION_HINT)));
      if (a.hilfsmittel.length) {
        const width = cmTw(21 - f.rand.links - f.rand.rechts);
        const cols = [0.3, 0.4, 0.18, 0.12].map((p) => Math.round(width * p));
        const cell = (t: string, w: number, bold = false) => `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/></w:tcPr>${para(run(t, bold ? "<w:b/>" : ""), undefined, '<w:jc w:val="left"/><w:ind w:firstLine="0"/><w:spacing w:after="0" w:line="240" w:lineRule="auto"/>')}</w:tc>`;
        const rows = [["Werkzeug", "Zweck", "Teile", "Datum"], ...hilfsmittelRows(a.hilfsmittel)];
        body.push(para(run("Verwendete Hilfsmittel", "<w:b/>")));
        body.push(`<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="${width}" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${cols.map((c) => `<w:gridCol w:w="${c}"/>`).join("")}</w:tblGrid>${rows.map((r, i) => `<w:tr>${r.map((c, j) => cell(c, cols[j]!, i === 0)).join("")}</w:tr>`).join("")}</w:tbl>`);
        body.push(para(""));
      }
    } else {
      body.push(para(run(part), "HeadingUnnumbered"), para(run(`[${part}]`)));
    }
  }
  closeFront();
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W_NS}><w:body>${body.join("")}<w:sectPr>${refs("main")}${margins}<w:pgNumType w:fmt="decimal" w:start="1"/></w:sectPr></w:body></w:document>`;
  const footnoteText = input.exampleCite ?? "Beleg in der Fußnote.";
  const footnotes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:footnotes ${W_NS}><w:footnote w:type="separator" w:id="-1"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:continuationSeparator/></w:r></w:p></w:footnote><w:footnote w:id="1"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r>${run(" ")}${htmlToRuns(footnoteText)}</w:p></w:footnote></w:footnotes>`;
  const settings = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings ${W_NS}>${f.silbentrennung ? "<w:autoHyphenation/>" : ""}<w:updateFields w:val="true"/><w:defaultTabStop w:val="708"/><w:footnotePr><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/word/footer2.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/header2.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/><Relationship Id="rIdNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/><Relationship Id="rIdFootnotes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/><Relationship Id="rIdFtrFront" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/><Relationship Id="rIdFtrMain" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer2.xml"/><Relationship Id="rIdHdrFront" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rIdHdrMain" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header2.xml"/></Relationships>`;
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(a.title)}</dc:title><dc:language>${xml(a.sprache)}</dc:language></cp:coreProperties>`;
  return writeZip([
    { name: "[Content_Types].xml", data: contentTypes },
    { name: "_rels/.rels", data: rels },
    { name: "docProps/core.xml", data: core },
    { name: "word/document.xml", data: document },
    { name: "word/styles.xml", data: stylesXml(f, a.sprache, input.hangingIndent ?? true) },
    { name: "word/settings.xml", data: settings },
    { name: "word/numbering.xml", data: numberingXml(f) },
    { name: "word/footnotes.xml", data: footnotes },
    { name: "word/footer1.xml", data: footerXml(f, top ? null : frontFmt) },
    { name: "word/footer2.xml", data: footerXml(f, top ? null : "decimal") },
    { name: "word/header1.xml", data: headerXml(f, top ? frontFmt : null) },
    { name: "word/header2.xml", data: headerXml(f, top ? "decimal" : null) },
    { name: "word/_rels/document.xml.rels", data: docRels },
  ]);
}

// ── Writing the files ───────────────────────────────────────────────────────

export interface VorlageWritten {
  format: VorlageFormat;
  path: string;
  skipped: boolean;
}

/**
 * Write templates into `<arbeit>/vorlage/`. The style's CSL is copied into
 * `stil/` so Typst and Pandoc find it; existing files stay unless `force`.
 */
export async function writeVorlagen(input: VorlageInput, formats: VorlageFormat[], opts: { force?: boolean } = {}): Promise<VorlageWritten[]> {
  const { ref } = input;
  const dir = join(ref.dir, "vorlage");
  await mkdir(dir, { recursive: true });
  const styleFile = join(ref.dir, "stil", `${ref.arbeit.stil.id}.csl`);
  if (!existsSync(styleFile) && (formats.includes("typst") || formats.includes("pandoc") || formats.includes("latex"))) {
    const style = await loadStyle(ref.arbeit.stil.id, ref.dir);
    await mkdir(join(ref.dir, "stil"), { recursive: true });
    if (style.info.parent) await writeFile(styleFile, style.xml);
    else await copyFile(style.info.path, styleFile);
  }
  const files: Array<[VorlageFormat, string, () => string | Buffer]> = [];
  for (const f of formats) {
    if (f === "docx") files.push([f, "arbeit.docx", () => docxTemplate(input)]);
    if (f === "latex") files.push([f, "arbeit.tex", () => latexTemplate(input)]);
    if (f === "typst") files.push([f, "arbeit.typ", () => typstTemplate(input)]);
    if (f === "pandoc") {
      files.push([f, "pandoc.yaml", () => pandocDefaults(input)]);
      files.push([f, "arbeit.md", () => markdownSkeleton(input)]);
      if (!formats.includes("docx")) files.push(["docx", "arbeit.docx", () => docxTemplate(input)]);
    }
  }
  const out: VorlageWritten[] = [];
  for (const [format, name, make] of files) {
    const path = join(dir, name);
    if (existsSync(path) && !opts.force) {
      out.push({ format, path: relative(ref.dir, path), skipped: true });
      continue;
    }
    await writeFile(path, make());
    out.push({ format, path: relative(ref.dir, path), skipped: false });
  }
  return out;
}

