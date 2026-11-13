import { z } from "zod";

const GlyphDiff = z.object({
  missing: z.array(z.string()).describe("Letters/digits the PDF has in the formula's box that the LaTeX doesn't show"),
  extra: z.array(z.string()).describe("Letters/digits the LaTeX shows that the PDF doesn't have there"),
  pdf: z.number().int().describe("Letters/digits the PDF has in the box"),
});

export const FormulaVerdict = z.object({
  issues: z.array(z.string()).describe("Structural problems in the LaTeX (unbalanced braces, \\left without \\right, a bare command name, …)"),
  glyphs: GlyphDiff.nullable().describe("Against the PDF's own text in the box; null when the box has none (scan, picture)"),
  check: z
    .enum(["match", "differs", "unchecked"])
    .describe("match: well-formed, and every letter and digit agrees with the PDF (positions are not compared) · differs: it doesn't · unchecked: nothing to compare with, only the image can tell"),
});

export const FormulaItem = z.object({
  id: z.string().describe("p<page>-<n>: page and position on the page, both 1-based"),
  page: z.number().int().describe("1-based, as in citations"),
  latex: z.string().describe("What content.md shows: the correction if there is one, else the model's reading"),
  modelLatex: z.string().describe("What the model read"),
  verdict: FormulaVerdict.describe("The check of `latex`"),
  why: z.string().nullable().describe("Why it needs a look, in one line; null when the check passed"),
  crop: z.string().nullable().describe("Absolute path of the formula's image"),
  corrected: z.object({ by: z.string(), at: z.string() }).nullable(),
});

/** `imstudium formulas list <file> --json` */
export const FormulasListOutput = z
  .object({
    dir: z.string().describe("The extracted folder (content.md, math.json, formulas/)"),
    source: z.string().describe("The original file"),
    model: z.string(),
    layoutModel: z.string(),
    summary: z.object({
      total: z.number().int(),
      match: z.number().int(),
      differs: z.number().int(),
      unchecked: z.number().int(),
      corrected: z.number().int(),
    }),
    formulas: z.array(FormulaItem),
  })
  .describe("The display formulas read from one file, each with its check against the PDF and its image");

/** `imstudium formulas check <file> <id> --latex … --json` */
export const FormulasCheckOutput = z
  .object({
    id: z.string(),
    latex: z.string(),
    modelLatex: z.string(),
    verdict: FormulaVerdict,
    why: z.string().nullable(),
    accepted: z.boolean().describe("formulas fix would store it (check is not differs)"),
  })
  .describe("Checks a reading of one formula against the PDF, without storing anything");

/** `imstudium formulas fix <file> <id> --latex … --json` */
export const FormulasFixOutput = z
  .object({
    id: z.string(),
    latex: z.string(),
    modelLatex: z.string(),
    verdict: FormulaVerdict,
    by: z.string(),
    dir: z.string(),
    contentUpdated: z.boolean().describe("content.md now shows the correction"),
  })
  .describe("A correction stored in formulas.checked.json and shown in content.md");

export type FormulasListOutput = z.infer<typeof FormulasListOutput>;
export type FormulasCheckOutput = z.infer<typeof FormulasCheckOutput>;
export type FormulasFixOutput = z.infer<typeof FormulasFixOutput>;
