# Written work: Hausarbeit, Seminararbeit, Bachelor- and Masterarbeit

ImStudium gives each Arbeit a folder with three things:

- a citation registry that checks every source before you cite it
- your Lehrstuhl's citation style
- the Formvorgaben your manuscript is checked against

It works with Word, LaTeX, Typst and Markdown, and with what you already use: a Zotero, Citavi or Mendeley library comes in as a file. Everything stays on your machine. ImStudium never writes the text of your Arbeit. Finding, checking and citing sources and keeping the form is what it helps with.

Every example below is synthetic.

## In five commands

```bash
imstudium arbeit new "Digitale Lehre im Vergleich" --typ seminararbeit --course statistik --abgabe 15.03.2027 --umfang 12s
imstudium quellen add 10.5555/beispiel.2020.12 "ISBN 978-3-16-148410-0"
imstudium zitieren schmidt2020lernen@50          # (Schmidt & Weber, 2020, S. 50)
imstudium literatur                              # the Literaturverzeichnis in your style
imstudium arbeit check ~/Studium/arbeiten/digitale-lehre-im-vergleich/arbeit.docx
```

## The folder

```
~/Studium/arbeiten/digitale-lehre-im-vergleich/
├── ARBEIT.md        # the brief: deadline, length, style, Formvorgaben, sources and their check status
├── arbeit.json      # the same as data
├── quellen.json     # the citation registry (CSL-JSON, with origin and check status per source)
├── quellen.bib      # BibLaTeX, written anew on every change, for LaTeX, Typst and Pandoc
├── stil/            # the CSL styles of this Arbeit (added, or copied for the templates)
└── vorlage/         # templates from imstudium arbeit vorlage
```

Writing in LaTeX or Typst in your own project folder? Start the Arbeit there with `imstudium arbeit new "…" --dir ~/thesis`. Commands run inside that folder use it automatically. Elsewhere, `imstudium arbeit use <slug>` picks one, and every command takes `--arbeit <slug>`.

`ARBEIT.md` keeps a `## Student notes` section across rewrites, like `COURSE.md`.

## Sources

### Add by identifier

```bash
imstudium quellen add 10.5555/beispiel.2020.12              # DOI: metadata from doi.org (Crossref, DataCite, mEDRA)
imstudium quellen add "ISBN 978-3-16-148410-0"              # ISBN: Deutsche Nationalbibliothek, then Open Library
imstudium quellen add arXiv:2101.01234                      # arXiv: through its DataCite DOI
imstudium quellen add https://example.org/artikel           # a web page: its citation tags, today as Abrufdatum
```

Metadata comes from the authority, never from memory, so a source added this way counts as checked. For a DOI, ImStudium also asks Crossref whether the work was retracted or corrected (Retraction Watch included), and warns you before you cite it.

Each source gets a citekey like `mueller2021digitale`, which works in Word templates, BibLaTeX, Pandoc and Typst. Keys never change unless you rename them (`quellen edit <key> --key <new>`).

### Import a library

```bash
imstudium quellen import ~/Downloads/meine-bibliothek.bib   # Zotero (Better BibTeX keys kept), JabRef, BibTeX/BibLaTeX
imstudium quellen import ~/Downloads/citavi-export.ris      # Citavi, EndNote, Mendeley (RIS)
imstudium quellen import ~/Downloads/zotero.json            # CSL JSON from Zotero
```

Duplicates are recognised by DOI, ISBN, or author, year and title, and are skipped. Run `imstudium quellen check --save` afterwards: imported data has not been checked against the authorities yet.

### By hand

Old books without an ISBN, grey literature, laws, interviews:

```bash
imstudium quellen add --manual --type book --title "Digitale Lehre: Ein Handbuch" --author "Müller, Anna" --year 2021 --publisher "Synthetik Verlag" --place Augsburg
imstudium quellen add --manual --type webpage --title "Leitfaden Zitieren" --container "Beispieluni" --url https://example.org/zitieren
```

### Is this reference real?

Language models make up references: in published studies, a fifth to half of the sources a chatbot names do not exist ([Walters & Wilder 2023](https://www.nature.com/articles/s41598-023-41032-5)). Before you cite a reference you did not find yourself:

```bash
imstudium quellen find "Schmidt Weber Lernen im Netz 2020"   # Crossref search: the real works that come closest
imstudium quellen check --save                               # every source against doi.org, Crossref and the DNB
```

Each source then has one of five check statuses:

| Status | Means |
|---|---|
| `verified` | The record exists and matches title, first author and year |
| `mismatch` | The identifier exists but belongs to another work, or the details differ |
| `not-found` | doi.org does not know the DOI, or the ISBN's checksum is wrong. The source probably doesn't exist like this |
| `retracted` | The publisher or Retraction Watch retracted it. Don't cite it as evidence |
| `unverified` | Nothing to check against (web pages, books without an ISBN). Check it in the library catalogue |

`quellen check --offline` checks only completeness (Verlagsort, Seiten, Abrufdatum, …) and duplicates, and sends nothing.

### From your course

Reading lists and slide references usually name their literature. ImStudium already has your course files extracted:

```bash
imstudium quellen kurs statistik     # DOIs and ISBNs in the course's files, with file and page
```

## Style

Twelve CSL styles ship with ImStudium:

| Style | For |
|---|---|
| `apa` | APA 7: psychology, education, social and economic sciences |
| `deutsche-gesellschaft-fur-psychologie` | DGPs 5, the German APA version |
| `harvard-cite-them-right` | Harvard |
| `chicago-author-date-de` · `chicago-notes-bibliography` | Chicago, author-date (German) and footnotes |
| `iso690-author-date-de` · `din-1505-2` · `din-1505-2-numeric` | ISO 690 and DIN 1505-2 |
| `ieee` | computer science and engineering |
| `modern-language-association` | MLA 9: English and literary studies |
| `juristische-zitierweise` | law, footnotes |
| `elsevier-vancouver` | medicine |

Many institutes and chairs have their own style in the [CSL repository](https://github.com/citation-style-language/styles), which holds about 10,000:

```bash
imstudium stile find "TU Dresden" Linguistik
imstudium stile add technische-universitat-dresden-linguistik    # copies it into stil/ and uses it
imstudium stile add ~/Downloads/lehrstuhl.csl                    # or a file from your Lehrstuhl
imstudium stile show juristische-zitierweise                     # see a style on examples before you pick it
```

Formatting runs on your machine through citeproc-js, the same processor Zotero uses, so a reference looks exactly as it would in Zotero.

```bash
imstudium zitieren mueller2021digitale@12                    # one source with page
imstudium zitieren mueller2021digitale@12-14 schmidt2020lernen   # several sources in one citation
imstudium zitieren mueller2021digitale@12 --vgl              # indirect quote: „Vgl.“
imstudium zitieren mueller2021digitale@13 --position ebd     # footnote styles: ebd./ibid. form
imstudium zitieren mueller2021digitale@Kap. 3                # locators: S., Kap., Abschn., Rn., §, Abs., Bd., Sp., Z.
imstudium literatur --format rtf --save literatur.rtf        # into Word with italics and hanging indent
imstudium literatur --nur-zitiert arbeit.docx                # only what the manuscript cites
```

## Formvorgaben

Every Lehrstuhl has its own rules. An Arbeit starts from a preset, and you then set what your Leitfaden says:

| Preset | Starting point |
|---|---|
| `standard` | A4, Times New Roman 12 pt, 1.5 line spacing, justified, correction margin right 3.5 cm, decimal numbering |
| `apa7` | 2.54 cm margins, double spacing, left-aligned, 1.27 cm indent, page number top right |
| `geisteswissenschaft` | like standard, citations in footnotes |
| `juristisch` | correction margin left 7 cm, outline A. I. 1. a) aa), Literaturverzeichnis before the analysis |
| `technik` | 2.5 cm margins, 11 pt, 1.15 line spacing, numeric citations |

The Leitfaden is often in the course files on Stud.IP, so ImStudium has it already:

```bash
imstudium arbeit leitfaden --course statistik     # files that look like a Leitfaden or Formvorgaben
imstudium arbeit formvorgaben                     # what is set now
imstudium arbeit formvorgaben set rand.links=4 rand.rechts=2 schrift.familie=Arial schrift.groesse=11 quelle=Leitfaden.pdf
imstudium arbeit formvorgaben set "pflichtabschnitte=Einleitung;Fazit|Schluss" "hinweise+=Internetquellen höchstens 20 %"
```

The fields you can set:

- **Page:** `rand.oben`, `rand.unten`, `rand.links`, `rand.rechts` (cm)
- **Type:** `schrift.familie`, `schrift.groesse`, `schrift.fussnoten` (pt)
- **Paragraphs:** `zeilenabstand`, `ausrichtung` (blocksatz, links), `silbentrennung`, `absatz.einzug`, `absatz.abstand`
- **Structure:** `nummerierung` (dekadisch, alphanumerisch, juristisch, keine), `seitenzahlen.position`, `seitenzahlen.vorspann` (roemisch, keine, arabisch)
- **Block quotes:** `blockzitat.abWoertern`, `blockzitat.einzug`, `blockzitat.zeilenabstand`
- **Parts:** `deckblatt`, `gliederung`, `pflichtabschnitte`
- **Declaration:** `erklaerung.erforderlich`, `erklaerung.kiAngabe`
- **Other:** `hinweise`, `quelle`

## Templates

```bash
imstudium arbeit vorlage --format docx     # Word: margins, font, spacing, numbered headings, footnote style, Deckblatt, TOC, Roman then Arabic page numbers
imstudium arbeit vorlage --format all      # also LaTeX (KOMA-Script, biblatex), Typst (with the CSL style) and Pandoc (defaults + markdown)
```

The Word template also serves Pandoc as its reference document: `pandoc -d vorlage/pandoc.yaml vorlage/arbeit.md -o arbeit.docx`. The Deckblatt has placeholders. The wording of the Eigenständigkeitserklärung comes from your Prüfungsordnung, so the template leaves room for it.

## Aids and AI

More and more Prüfungsordnungen ask for a list of the AI tools you used: product and version, purpose, and which parts. Keep it as you go:

```bash
imstudium arbeit hilfsmittel add "DeepL Write" --zweck "Rechtschreibung und Ausdruck" --teile "ganze Arbeit"
imstudium arbeit hilfsmittel
```

The templates print the list under the declaration.

## Before the Abgabe

```bash
imstudium arbeit set manuskript=~/Studium/arbeiten/digitale-lehre-im-vergleich/arbeit.docx
imstudium arbeit check
```

`arbeit check` reads `.docx` (including Zotero and Mendeley citation fields; without them it matches author and year in the text), `.md` (Pandoc, Quarto), `.tex` (biblatex and natbib commands, `\input` followed) and `.typ`. It reports:

- citations that are not in the registry, and registry entries the text never cites
- citations of printed works without a page
- sources that are retracted, not found or don't match; unchecked and incomplete ones
- the length against `umfang` (words, characters, or pages estimated from the Formvorgaben)
- missing parts: the required headings, the Literaturverzeichnis, the Eigenständigkeitserklärung
- days until the Abgabe

It exits 1 when a check fails, so it also works in a script or a pre-commit hook.

## Privacy

Your Arbeit, your manuscript and your registry stay on your machine. Only an identifier (DOI, ISBN, arXiv id, URL) or your search words go to doi.org, api.crossref.org, services.dnb.de, openlibrary.org, or the CSL repository on GitHub, when you add, check, search or fetch a style. `--offline` checks send nothing.

## For agents

The `imstudium-arbeiten` skill teaches the workflow. Agents read `ARBEIT.md` first, use `--json` everywhere (`imstudium schema "arbeit check"`), cite only what the registry holds and has checked, and never write text for submission. Over MCP the reading commands are open (`arbeit`, `arbeit show`, `arbeit check`, `quellen`, `quellen check`, `quellen find`, `zitieren`, `literatur`, `stile`). Everything that changes the registry or writes files is a terminal step.

## Licences

The CSL styles and locales in `packages/sdk/csl/` come from the Citation Style Language project under CC BY-SA 3.0. citeproc-js (CPAL-1.0 or AGPL-3.0) is a separate, unmodified dependency of `@imstudium/sdk` and loads only when something is formatted.
