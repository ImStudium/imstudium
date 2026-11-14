import { z } from "zod";
import { DayKey, IsoDateTime } from "../common.js";
import { DoctorCheck } from "./doctor.js";

/**
 * Written work and its citation registry: `imstudium arbeit`, `quellen`,
 * `zitieren`, `literatur` and `stile`. Sources are CSL-JSON (the format
 * Zotero, Pandoc, Typst and citeproc share) with ImStudium's provenance
 * and check status beside them.
 */

export const CslItemJson = z.record(z.string(), z.unknown()).describe("CSL-JSON item; `id` is the citekey");

export const QuelleCheckStatus = z.enum(["verified", "mismatch", "not-found", "retracted", "unverified"]);

export const QuelleCheckJson = z.object({
  status: QuelleCheckStatus.describe("verified · mismatch (exists, differs) · not-found (identifier unknown) · retracted · unverified (nothing to check against)"),
  at: IsoDateTime,
  service: z.string().optional(),
  detail: z.string().optional(),
  differences: z.array(z.object({ field: z.string(), ours: z.string(), theirs: z.string() })).optional(),
  notices: z.array(z.object({ type: z.string(), doi: z.string().optional(), date: z.string().optional(), source: z.string().optional() })).optional().describe("Crossref update notices: retraction, correction, expression_of_concern, …"),
  suggestedDoi: z.string().optional(),
});

export const QuelleJson = z.object({
  key: z.string().describe("Citekey, e.g. mueller2021digitale"),
  csl: CslItemJson,
  origin: z.object({
    via: z.string().describe("doi · isbn · arxiv · url · bibtex · ris · csl-json · manual · course"),
    ref: z.string().optional(),
    service: z.string().nullable().optional(),
    at: IsoDateTime,
  }),
  check: QuelleCheckJson.optional(),
  file: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
  added: IsoDateTime,
  updated: IsoDateTime,
});
export type QuelleJson = z.infer<typeof QuelleJson>;

export const FormvorgabenJson = z.object({
  preset: z.string(),
  rand: z.object({ oben: z.number(), unten: z.number(), links: z.number(), rechts: z.number() }).describe("Margins in cm"),
  schrift: z.object({ familie: z.string(), groesse: z.number(), fussnoten: z.number() }),
  zeilenabstand: z.number(),
  ausrichtung: z.enum(["blocksatz", "links"]),
  silbentrennung: z.boolean(),
  absatz: z.object({ einzug: z.number(), abstand: z.number() }),
  nummerierung: z.enum(["dekadisch", "alphanumerisch", "juristisch", "keine"]),
  seitenzahlen: z.object({ position: z.enum(["unten-mitte", "unten-rechts", "oben-rechts"]), vorspann: z.enum(["roemisch", "keine", "arabisch"]) }),
  blockzitat: z.object({ abWoertern: z.number(), einzug: z.number(), zeilenabstand: z.number() }),
  deckblatt: z.array(z.string()),
  gliederung: z.array(z.string()),
  pflichtabschnitte: z.array(z.string()),
  erklaerung: z.object({ erforderlich: z.boolean(), kiAngabe: z.boolean() }),
  hinweise: z.array(z.string()),
  quelle: z.string().nullable(),
});

export const ArbeitJson = z.object({
  schema: z.literal("imstudium/arbeit/v1"),
  slug: z.string(),
  title: z.string(),
  typ: z.enum(["hausarbeit", "seminararbeit", "bachelorarbeit", "masterarbeit", "projektarbeit", "essay", "protokoll", "referat", "dissertation", "sonstige"]),
  sprache: z.string(),
  course: z.object({ id: z.string().nullable(), title: z.string(), path: z.string().nullable() }).nullable(),
  betreuung: z.string().nullable(),
  abgabe: DayKey.nullable(),
  umfang: z.object({ value: z.number(), unit: z.enum(["seiten", "woerter", "zeichen"]), toleranz: z.number().optional() }).nullable(),
  stil: z.object({ id: z.string(), title: z.string(), file: z.string().nullable(), class: z.enum(["in-text", "note"]) }),
  formvorgaben: FormvorgabenJson,
  manuskript: z.string().nullable(),
  hilfsmittel: z.array(z.object({ werkzeug: z.string(), zweck: z.string(), teile: z.string().optional(), at: IsoDateTime })),
  created: IsoDateTime,
  updated: IsoDateTime,
});

const QuellenCounts = z.object({
  total: z.number().int(),
  verified: z.number().int(),
  problems: z.number().int().describe("mismatch, not-found or retracted"),
  unverified: z.number().int(),
});

export const ArbeitSummaryJson = z.object({
  slug: z.string(),
  title: z.string(),
  typ: z.string(),
  dir: z.string(),
  current: z.boolean(),
  inWorkspace: z.boolean(),
  abgabe: DayKey.nullable(),
  daysLeft: z.number().int().nullable(),
  stil: z.string(),
  course: z.string().nullable(),
  quellen: QuellenCounts,
});
export type ArbeitSummaryJson = z.infer<typeof ArbeitSummaryJson>;

/** `imstudium arbeit --json` (and `arbeit list`) */
export const ArbeitListOutput = z
  .object({
    workspace: z.string(),
    current: z.string().nullable().describe("Folder of the Arbeit commands use by default"),
    count: z.number().int(),
    arbeiten: z.array(ArbeitSummaryJson),
  })
  .describe("Every Arbeit: <workspace>/arbeiten/ plus folders elsewhere (LaTeX or Typst projects)");
export type ArbeitListOutput = z.infer<typeof ArbeitListOutput>;

/** `imstudium arbeit show --json` (also `arbeit new`, `arbeit set`) */
export const ArbeitShowOutput = z
  .object({
    dir: z.string(),
    arbeit: ArbeitJson,
    daysLeft: z.number().int().nullable(),
    quellen: QuellenCounts,
    files: z.object({ registry: z.string(), bib: z.string(), brief: z.string() }).describe("Absolute paths of quellen.json, quellen.bib and ARBEIT.md"),
  })
  .describe("One Arbeit: type, deadline, length, style, Formvorgaben, declared aids and the registry's state");
export type ArbeitShowOutput = z.infer<typeof ArbeitShowOutput>;

/** `imstudium arbeit check --json` */
export const ArbeitCheckOutput = z
  .object({
    ok: z.boolean().describe("No check failed"),
    dir: z.string(),
    manuscript: z
      .object({ path: z.string(), format: z.enum(["markdown", "latex", "typst", "docx", "text"]), words: z.number().int(), chars: z.number().int(), footnoteWords: z.number().int(), pages: z.number(), headings: z.array(z.string()) })
      .nullable(),
    citations: z
      .object({
        count: z.number().int(),
        cited: z.array(z.string()),
        unknown: z.array(z.string()).describe("Cited in the manuscript, not in the registry"),
        uncited: z.array(z.string()).describe("In the registry, never cited"),
        withoutLocator: z.array(z.object({ key: z.string(), line: z.number().int().nullable() })),
        matchedBy: z.record(z.string(), z.enum(["key", "field", "heuristic"])),
      })
      .nullable(),
    summary: z.object({ ok: z.number().int(), warn: z.number().int(), fail: z.number().int(), skip: z.number().int() }),
    checks: z.array(DoctorCheck),
  })
  .describe("The registry and the manuscript against each other and against the Formvorgaben");
export type ArbeitCheckOutput = z.infer<typeof ArbeitCheckOutput>;

/** `imstudium quellen --json` (and `quellen list`) */
export const QuellenListOutput = z
  .object({
    arbeit: z.string().describe("Slug"),
    count: z.number().int(),
    quellen: z.array(QuelleJson),
  })
  .describe("The citation registry of one Arbeit");
export type QuellenListOutput = z.infer<typeof QuellenListOutput>;

/** `imstudium quellen add --json` (also `quellen import`) */
export const QuellenAddOutput = z
  .object({
    arbeit: z.string(),
    added: z.array(QuelleJson),
    duplicates: z.array(z.object({ input: z.string(), key: z.string() })).describe("Already in the registry; nothing changed"),
    failed: z.array(z.object({ input: z.string(), code: z.string(), message: z.string() })),
    dryRun: z.boolean(),
  })
  .describe("Sources taken into the registry from DOIs, ISBNs, arXiv ids, URLs, files or by hand");
export type QuellenAddOutput = z.infer<typeof QuellenAddOutput>;

/** `imstudium quellen check --json` */
export const QuellenCheckOutput = z
  .object({
    arbeit: z.string(),
    offline: z.boolean(),
    saved: z.boolean(),
    ok: z.boolean().describe("No mismatch, not-found or retracted source"),
    results: z.array(
      z.object({
        key: z.string(),
        short: z.string(),
        check: QuelleCheckJson.nullable(),
        missing: z.array(z.string()).describe("Fields the reference lacks for its type"),
        duplicateOf: z.string().nullable(),
      }),
    ),
  })
  .describe("Every source against doi.org, Crossref (incl. retractions) and the DNB, plus completeness and duplicates");
export type QuellenCheckOutput = z.infer<typeof QuellenCheckOutput>;

/** `imstudium zitieren --json` */
export const ZitierenOutput = z
  .object({
    style: z.object({ id: z.string(), title: z.string(), class: z.enum(["in-text", "note"]) }),
    position: z.enum(["first", "subsequent", "ibid"]),
    format: z.enum(["text", "html", "rtf", "markdown"]),
    citation: z.string().describe("The cite as it goes into the text, or the footnote's text for note styles"),
    keys: z.array(z.string()),
  })
  .describe("A formatted citation in the Arbeit's style");
export type ZitierenOutput = z.infer<typeof ZitierenOutput>;

/** `imstudium literatur --json` */
export const LiteraturOutput = z
  .object({
    style: z.object({ id: z.string(), title: z.string(), class: z.enum(["in-text", "note"]) }),
    format: z.enum(["text", "html", "rtf", "markdown"]),
    count: z.number().int(),
    entries: z.array(z.object({ key: z.string(), text: z.string() })),
    text: z.string(),
    hangingIndent: z.boolean(),
  })
  .describe("The bibliography in the Arbeit's style, sorted and numbered by the style");
export type LiteraturOutput = z.infer<typeof LiteraturOutput>;

/** `imstudium stile --json` */
export const StileOutput = z
  .object({
    current: z.string().nullable().describe("The style of the selected Arbeit, if any"),
    count: z.number().int(),
    styles: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        class: z.enum(["in-text", "note"]),
        locale: z.string().nullable(),
        source: z.enum(["bundled", "arbeit", "file"]),
        note: z.string().nullable(),
      }),
    ),
  })
  .describe("Citation styles: the bundled set and those vendored into the Arbeit");
export type StileOutput = z.infer<typeof StileOutput>;
