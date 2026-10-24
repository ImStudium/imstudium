---
name: imstudium-arbeiten
description: |
  Written work with ImStudium: Hausarbeit, Seminararbeit, Bachelor- and Masterarbeit, Referat, Protokoll. The citation registry per Arbeit (add by DOI/ISBN/URL, import from Zotero or Citavi, check against doi.org, Crossref and the DNB, retractions included), citations and the Literaturverzeichnis in the Lehrstuhl's CSL style, Formvorgaben and templates for Word, LaTeX, Typst and Pandoc, and the manuscript check before the Abgabe.
  Use when the student mentions a Hausarbeit, Seminararbeit, thesis, Literaturverzeichnis, Zitieren, Quellen, Zitierstil, Fußnoten, Formvorgaben, Deckblatt, Eigenständigkeitserklärung, KI-Angabe, Zotero, Citavi, BibTeX, or asks whether a reference is real.
---

# imstudium arbeit · quellen · zitieren · literatur · stile

An Arbeit is a folder (`~/Studium/arbeiten/<slug>/`, or the student's LaTeX/Typst project) with:

- `ARBEIT.md`: the brief. Read it first: deadline, length, style, Formvorgaben, sources and their check status.
- `quellen.json`: the registry (CSL-JSON plus origin and check). Change it only through `imstudium quellen …`.
- `quellen.bib`: BibLaTeX, regenerated on every change, for `\addbibresource`, Typst `#bibliography` and Pandoc `--bibliography`.

## The rules

1. **The text is the student's.** Help find, read, check and cite sources, discuss structure and arguments, and keep the form. Never write paragraphs, chapters or a whole Arbeit for submission. North star rule 2.
2. **Cited or silent.** Only cite what is in the registry. Never invent a source, a DOI, a page or a quote, and never type metadata from memory. Take it from the authority with `imstudium quellen add <DOI|ISBN|URL>`.
3. **Verify before citing.** `imstudium quellen check --save` checks every entry. `not-found`, `mismatch` and `retracted` are blockers: tell the student and don't cite the entry.
4. **Direct quotes need the page.** Use `key@page` and check the quote against the source the student has open. If you can't see the page, say so.
5. **Declare AI use.** If you helped, suggest `imstudium arbeit hilfsmittel add "<tool and version>" --zweck "<what for>" --teile "<which parts>"`. Many Prüfungsordnungen require this list, and the template prints it under the Erklärung.

## Start an Arbeit

```bash
imstudium arbeit new "Titel" --typ hausarbeit --course "<course>" --abgabe 15.03.2027 --umfang 12s
imstudium arbeit leitfaden --course "<course>"       # finds the Lehrstuhl's Leitfaden in the synced course files
```

Read the Leitfaden the search finds, then set what it says:

- the style: `imstudium stile find "<Uni> <Institut>"` → `imstudium stile add <id>`, or a bundled id with `imstudium arbeit set stil=<id>`
- the Formvorgaben: `imstudium arbeit formvorgaben set rand.links=4 schrift.familie=Arial zeilenabstand=1,5 quelle=<Leitfaden.pdf>`

Presets give a starting point (`imstudium arbeit formvorgaben preset juristisch|apa7|geisteswissenschaft|technik|standard`). The Leitfaden always wins.

Bundled styles cover the usual cases:

- `apa`, `deutsche-gesellschaft-fur-psychologie`: author-date
- `chicago-notes-bibliography`, `juristische-zitierweise`: footnotes
- `ieee`, `din-1505-2-numeric`, `elsevier-vancouver`: numeric
- `modern-language-association`, `harvard-cite-them-right`, `iso690-author-date-de`, `din-1505-2`, `chicago-author-date-de`

`imstudium stile` lists them all. Any of the ~10,000 CSL repository styles (many Lehrstuhl styles) comes in with `stile add`.

## Collect sources

| Situation | Command |
|---|---|
| DOI, ISBN, arXiv id or web address | `imstudium quellen add 10.1000/xyz123 "ISBN 978-…" arXiv:2101.01234 https://…` |
| A half-remembered or AI-suggested reference | `imstudium quellen find "Autor Titelwörter Jahr"`, then add the DOI of the real match. No match means don't cite it |
| Literature named in the course material | `imstudium quellen kurs "<course>"` (DOIs and ISBNs found in the extracted files, with page) |
| An existing Zotero, Citavi, Mendeley or JabRef library | export as BibTeX, RIS or CSL JSON, then `imstudium quellen import <file>` (Better BibTeX keys are kept) |
| No identifier (old book, grey literature, law, interview) | `imstudium quellen add --manual --type book --title … --author "Müller, Anna" --year … --publisher … --place …` |
| Fix a field | `imstudium quellen edit <key> ort=Augsburg seiten=45-67` |

`imstudium quellen --json` lists the registry; `imstudium quellen show <key>` shows one entry with its reference and BibLaTeX.

## Cite and build the Literaturverzeichnis

```bash
imstudium zitieren mueller2021digitale@12                  # (Müller, 2021, S. 12), or the footnote in note styles
imstudium zitieren mueller2021digitale@12 --vgl            # indirect quote: „Vgl.“
imstudium zitieren mueller2021digitale@13 --position ebd   # ebd./ibid. form, note styles only
imstudium literatur --format rtf --save literatur.rtf      # opens in Word with italics and hanging indent
imstudium literatur --nur-zitiert arbeit.docx              # only what the manuscript cites
```

In LaTeX, Typst or Pandoc the student cites by key: `\autocite[S.~12]{key}`, `@key[S. 12]` or `[@key, S. 12]`. In Word with Zotero the citation fields are recognised; without them, ImStudium matches by author and year.

## Templates and the check before the Abgabe

```bash
imstudium arbeit vorlage --format docx        # also: latex, typst, pandoc, all
imstudium arbeit set manuskript=~/Studium/arbeiten/<slug>/arbeit.docx
imstudium arbeit check                        # .docx, .md, .tex or .typ
```

`arbeit check` reports:

- cites that are not in the registry
- registry entries the text never cites
- printed works cited without a page
- unchecked and problem sources, and incomplete fields
- length against `umfang`
- missing parts: Einleitung, Fazit, Literaturverzeichnis, Eigenständigkeitserklärung
- days left until the Abgabe

It exits 1 when a check fails. Walk the student through each `fail` first, then the `warn`s.

## Privacy

Everything stays on the student's machine. Only the identifier or the search words go to doi.org, Crossref, the DNB or Open Library, and `--offline` checks send nothing. Never upload the manuscript anywhere.
