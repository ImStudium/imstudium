/**
 * Written work (Hausarbeit, Seminararbeit, Bachelor- and Masterarbeit) and
 * its citation registry. Everything here lives on the student's machine:
 * `arbeit.json` describes the work, `quellen.json` holds its sources as
 * CSL-JSON (the format Zotero, Pandoc, Typst and citeproc share), and
 * `quellen.bib` is regenerated from it for LaTeX, Typst and Pandoc.
 */

/** A CSL name: a person (family/given) or an institution (literal). */
export interface CslName {
  family?: string;
  given?: string;
  literal?: string;
  "non-dropping-particle"?: string;
  "dropping-particle"?: string;
  suffix?: string;
}

export interface CslDate {
  "date-parts"?: Array<Array<number | string>>;
  literal?: string;
  raw?: string;
  circa?: boolean;
}

/** The CSL item types ImStudium maps; any other CSL type passes through. */
export type CslType =
  | "article-journal"
  | "article-magazine"
  | "article-newspaper"
  | "book"
  | "chapter"
  | "paper-conference"
  | "thesis"
  | "report"
  | "webpage"
  | "post-weblog"
  | "dataset"
  | "software"
  | "legislation"
  | "legal_case"
  | "standard"
  | "patent"
  | "manuscript"
  | "speech"
  | "entry-encyclopedia"
  | "entry-dictionary"
  | "periodical"
  | "document"
  | (string & {});

/** The fields of a CSL-JSON item, before it has a citekey. Unknown fields are kept as they are. */
export interface CslFields {
  type: CslType;
  title?: string;
  "title-short"?: string;
  author?: CslName[];
  editor?: CslName[];
  translator?: CslName[];
  "container-author"?: CslName[];
  "collection-editor"?: CslName[];
  issued?: CslDate;
  accessed?: CslDate;
  "original-date"?: CslDate;
  "container-title"?: string;
  "collection-title"?: string;
  "collection-number"?: string | number;
  "event-title"?: string;
  publisher?: string;
  "publisher-place"?: string;
  edition?: string | number;
  volume?: string | number;
  issue?: string | number;
  page?: string;
  "number-of-pages"?: string | number;
  number?: string | number;
  genre?: string;
  DOI?: string;
  ISBN?: string;
  ISSN?: string;
  URL?: string;
  PMID?: string;
  language?: string;
  abstract?: string;
  note?: string;
  [field: string]: unknown;
}

/** One CSL-JSON item; `id` is the citekey. */
export interface CslItem extends CslFields {
  id: string;
}

/** How a source entered the registry. */
export type QuelleVia = "doi" | "isbn" | "arxiv" | "url" | "bibtex" | "ris" | "csl-json" | "manual" | "course";

export interface QuelleOrigin {
  via: QuelleVia;
  /** The identifier or file it came from (a DOI, an ISBN, an import file name). */
  ref?: string;
  /** The service that answered, when one did. */
  service?: "doi.org" | "crossref" | "dnb" | "openlibrary" | "web" | null;
  at: string;
}

/**
 * Result of the last check against a metadata service:
 * - `verified`: the record exists and matches title, first author and year
 * - `mismatch`: it exists, but differs (see `differences`)
 * - `not-found`: the identifier or reference is unknown (a typo, or a reference that does not exist)
 * - `retracted`: the publisher or Retraction Watch retracted it
 * - `unverified`: nothing to check against (no identifier, no close search hit)
 */
export type QuelleCheckStatus = "verified" | "mismatch" | "not-found" | "retracted" | "unverified";

export interface QuelleDifference {
  field: string;
  ours: string;
  theirs: string;
}

export interface QuelleNotice {
  /** retraction · correction · expression_of_concern · withdrawal · … (Crossref update types) */
  type: string;
  doi?: string;
  date?: string;
  source?: string;
}

export interface QuelleCheck {
  status: QuelleCheckStatus;
  at: string;
  service?: string;
  detail?: string;
  differences?: QuelleDifference[];
  notices?: QuelleNotice[];
  /** A DOI found by search for an entry that had none. */
  suggestedDoi?: string;
}

/** One entry of the registry. */
export interface Quelle {
  key: string;
  csl: CslItem;
  origin: QuelleOrigin;
  check?: QuelleCheck;
  /** The full text on disk: relative to the Arbeit folder, or absolute. */
  file?: string | null;
  tags?: string[];
  /** The student's own notes on the source. */
  notes?: string;
  added: string;
  updated: string;
}

export interface QuellenFile {
  schema: "imstudium/quellen/v1";
  updatedAt: string;
  items: Quelle[];
}

export const ARBEIT_TYPEN = [
  "hausarbeit",
  "seminararbeit",
  "bachelorarbeit",
  "masterarbeit",
  "projektarbeit",
  "essay",
  "protokoll",
  "referat",
  "dissertation",
  "sonstige",
] as const;
export type ArbeitTyp = (typeof ARBEIT_TYPEN)[number];

export const ARBEIT_TYP_LABEL: Record<ArbeitTyp, string> = {
  hausarbeit: "Hausarbeit",
  seminararbeit: "Seminararbeit",
  bachelorarbeit: "Bachelorarbeit",
  masterarbeit: "Masterarbeit",
  projektarbeit: "Projektarbeit",
  essay: "Essay",
  protokoll: "Protokoll",
  referat: "Referat / Handout",
  dissertation: "Dissertation",
  sonstige: "Arbeit",
};

export type UmfangEinheit = "seiten" | "woerter" | "zeichen";

export interface Umfang {
  value: number;
  unit: UmfangEinheit;
  /** Allowed deviation in percent (often ±10 %). */
  toleranz?: number;
}

/** The citation style of the work: a bundled CSL style or one vendored into `stil/`. */
export interface ArbeitStil {
  id: string;
  title: string;
  /** `stil/<id>.csl` inside the Arbeit folder when vendored; null for a bundled style. */
  file: string | null;
  class: "in-text" | "note";
}

export type Nummerierung = "dekadisch" | "alphanumerisch" | "juristisch" | "keine";

/**
 * The formal rules of a Lehrstuhl or Prüfungsordnung beyond the citation
 * style: page, type, structure and the declaration. Presets are starting
 * points; the student's Leitfaden wins.
 */
export interface Formvorgaben {
  preset: string;
  /** Margins in cm. */
  rand: { oben: number; unten: number; links: number; rechts: number };
  schrift: { familie: string; groesse: number; fussnoten: number };
  zeilenabstand: number;
  ausrichtung: "blocksatz" | "links";
  silbentrennung: boolean;
  /** First-line indent in cm and space after a paragraph in pt. */
  absatz: { einzug: number; abstand: number };
  nummerierung: Nummerierung;
  seitenzahlen: { position: "unten-mitte" | "unten-rechts" | "oben-rechts"; vorspann: "roemisch" | "keine" | "arabisch" };
  /** Direct quotes from this many words on are set as an indented block. */
  blockzitat: { abWoertern: number; einzug: number; zeilenabstand: number };
  deckblatt: string[];
  /** The parts of the work in order, from Deckblatt to Erklärung. */
  gliederung: string[];
  /** Headings the text itself must have (any of the alternatives, separated by "|"). */
  pflichtabschnitte: string[];
  erklaerung: { erforderlich: boolean; kiAngabe: boolean };
  /** Rules from the Leitfaden that no field covers, one line each. */
  hinweise: string[];
  /** Where these rules come from: the Leitfaden's path or URL. */
  quelle: string | null;
}

/**
 * A tool used while writing, for the declaration many Prüfungsordnungen now
 * require (an AI list with product and version, purpose and the parts of the
 * work it touched, as HTW Berlin and FU Berlin ask for it).
 */
export interface Hilfsmittel {
  /** Product and version, e.g. "ChatGPT (GPT-5)" or "DeepL Write". */
  werkzeug: string;
  /** What it was used for, e.g. "Gliederung besprochen", "Korrektur der Rechtschreibung". */
  zweck: string;
  /** The parts of the work it touched, e.g. "Kapitel 2". */
  teile?: string;
  at: string;
}

export interface ArbeitCourse {
  id: string | null;
  title: string;
  path: string | null;
}

export interface Arbeit {
  schema: "imstudium/arbeit/v1";
  slug: string;
  title: string;
  typ: ArbeitTyp;
  /** CSL locale, e.g. de-DE or en-US. */
  sprache: string;
  course: ArbeitCourse | null;
  betreuung: string | null;
  /** YYYY-MM-DD */
  abgabe: string | null;
  umfang: Umfang | null;
  stil: ArbeitStil;
  formvorgaben: Formvorgaben;
  /** The manuscript `arbeit check` reads by default, relative to the Arbeit folder or absolute. */
  manuskript: string | null;
  hilfsmittel: Hilfsmittel[];
  created: string;
  updated: string;
}

/** An Arbeit as found on disk. */
export interface ArbeitRef {
  dir: string;
  arbeit: Arbeit;
  /** Inside `<workspace>/arbeiten/` (false: a folder elsewhere, e.g. a LaTeX project). */
  inWorkspace: boolean;
}
