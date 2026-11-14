/**
 * Formulas in an extracted file: what the model read, how it checks against
 * the PDF, and corrections an agent made from the formula's image.
 *
 *   extracted/<slug>/math.json               every formula: id, page, box, LaTeX, check, crop
 *   extracted/<slug>/formulas/<id>.png       the formula as the model saw it
 *   extracted/<slug>/formulas.checked.json   corrections, kept across re-extraction
 *
 * A correction is only stored when it checks: well-formed LaTeX and, on a
 * born-digital page, exactly the letters and digits the PDF has in that box.
 * So a correction can fix structure and symbols the PDF can't name, but it
 * can't add a letter or digit that isn't on the page.
 */
import { readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { ImstudiumError } from "./errors.js";
import { checkFormula, judgeFormula, type Formula, type FormulaVerdict } from "./ingest/math.js";

export const FORMULA_FIXES_FILE = "formulas.checked.json";

export interface FormulaFix {
  id: string;
  /** What the model read; the fix only applies while the model still reads exactly this. */
  modelLatex: string;
  latex: string;
  /** Who corrected it, e.g. "claude-code" or "student". */
  by: string;
  at: string;
  verdict: FormulaVerdict;
}

export interface FormulaFixFile {
  schemaVersion: "1";
  fixes: FormulaFix[];
}

/** A formula as math.json lists it: the model's reading, its check, its image, and a correction if one applies. */
export interface FormulaEntry extends Formula {
  /** Relative to the extracted folder, e.g. formulas/p3-2.png. */
  crop?: string;
  corrected?: { latex: string; by: string; at: string; verdict: FormulaVerdict };
}

export async function readFormulaFixes(outDir: string): Promise<FormulaFix[]> {
  try {
    const raw = JSON.parse(await readFile(join(outDir, FORMULA_FIXES_FILE), "utf-8")) as FormulaFixFile;
    return Array.isArray(raw.fixes) ? raw.fixes : [];
  } catch {
    return [];
  }
}

export async function writeFormulaFixes(outDir: string, fixes: FormulaFix[]): Promise<void> {
  const file: FormulaFixFile = { schemaVersion: "1", fixes };
  await writeFile(join(outDir, FORMULA_FIXES_FILE), `${JSON.stringify(file, null, 2)}\n`);
}

/** Attaches each fix to its formula while the model's reading is unchanged; other fixes are left out (they no longer apply). */
export function applyFormulaFixes<T extends Formula>(formulas: T[], fixes: FormulaFix[]): Array<T & Pick<FormulaEntry, "corrected">> {
  return formulas.map((f) => {
    const fix = fixes.find((x) => x.id === f.id && x.modelLatex === f.latex);
    return fix ? { ...f, corrected: { latex: fix.latex, by: fix.by, at: fix.at, verdict: fix.verdict } } : f;
  });
}

/** One line on why a formula needs a look, or null when its check passed. */
export function describeVerdict(v: FormulaVerdict): string | null {
  if (v.check === "match") return null;
  if (v.check === "unchecked") return v.issues.length ? v.issues.join("; ") : v.picture ? "the formula is a picture in the PDF, with no text to compare with" : "no text on the page to compare with";
  const parts = [...v.issues];
  if (v.glyphs?.missing.length) parts.push(`the PDF has ${v.glyphs.missing.join(" ")} here, the LaTeX doesn't`);
  if (v.glyphs?.extra.length) parts.push(`the LaTeX has ${v.glyphs.extra.join(" ")}, the PDF doesn't`);
  return parts.join("; ");
}

/** The note under a formula in content.md, or null for a formula whose check passed. */
export function formulaNote(f: FormulaEntry): string | null {
  const image = f.crop ? ` Image: ${f.crop}` : "";
  if (f.corrected) {
    const how = f.corrected.verdict.check === "match" ? "its letters and digits match the PDF" : f.corrected.verdict.picture ? "the formula is a picture in the PDF" : "the page has no text to compare with";
    return `_(formula ${f.id} corrected by ${f.corrected.by} from its image; ${how}.${image})_`;
  }
  const why = describeVerdict(f);
  if (!why) return null;
  return f.check === "unchecked" ? `_(formula ${f.id} unchecked: ${why}.${image})_` : `_(formula ${f.id} needs a look: ${why}.${image})_`;
}

// ── One extracted folder: list, check and correct its formulas ─────────────────

export interface ExtractedFormulas {
  dir: string;
  source: string;
  kind: string;
  model: string;
  layoutModel: string;
  formulas: FormulaEntry[];
}

/** math.json and manifest.json of an extracted folder; null when the folder has no formulas. */
export async function loadExtractedFormulas(dir: string): Promise<ExtractedFormulas | null> {
  try {
    const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf-8")) as { source: string; kind: string };
    const math = JSON.parse(await readFile(join(dir, "math.json"), "utf-8")) as { model: string; layoutModel: string; formulas: FormulaEntry[] };
    return { dir, source: manifest.source, kind: manifest.kind, model: math.model, layoutModel: math.layoutModel, formulas: math.formulas ?? [] };
  } catch {
    return null;
  }
}

/** Formula `id` in an extracted folder, or a FORMULA_NOT_FOUND error. */
export function findFormula(x: ExtractedFormulas, id: string): FormulaEntry {
  const f = x.formulas.find((e) => e.id === id);
  if (!f) {
    throw new ImstudiumError(`No formula ${id} in ${basename(x.source)}`, "FORMULA_NOT_FOUND", 404, `It has ${x.formulas.map((e) => e.id).join(", ") || "none"}`);
  }
  return f;
}

/** The check `latex` gets as a reading of formula `id`: against the PDF's text in its box (PDFs) or on its own (images, scans). */
export async function checkExtractedFormula(x: ExtractedFormulas, id: string, latex: string): Promise<FormulaVerdict> {
  const f = findFormula(x, id);
  if (x.kind !== "pdf") return judgeFormula(latex, null);
  const pdf = new Uint8Array(await readFile(x.source));
  return checkFormula(pdf, f.page, f.bbox, latex);
}

/**
 * Stores a correction of formula `id`, refused (FORMULA_MISMATCH) unless it
 * checks. Writes formulas.checked.json, marks the formula in math.json and
 * shows the correction in content.md with a note saying who made it.
 */
export async function fixExtractedFormula(
  x: ExtractedFormulas,
  id: string,
  latex: string,
  by: string,
): Promise<{ entry: FormulaEntry; verdict: FormulaVerdict; contentUpdated: boolean }> {
  const f = findFormula(x, id);
  const clean = latex.trim();
  const verdict = await checkExtractedFormula(x, id, clean);
  if (verdict.check === "differs") {
    throw new ImstudiumError(`The correction of ${id} doesn't check: ${describeVerdict(verdict)}`, "FORMULA_MISMATCH", undefined, undefined, { verdict });
  }
  const at = new Date().toISOString();
  const fixes = (await readFormulaFixes(x.dir)).filter((fx) => fx.id !== id);
  fixes.push({ id, modelLatex: f.latex, latex: clean, by, at, verdict });
  await writeFormulaFixes(x.dir, fixes);

  const entry: FormulaEntry = { ...f, corrected: { latex: clean, by, at, verdict } };
  const mathPath = join(x.dir, "math.json");
  const math = JSON.parse(await readFile(mathPath, "utf-8")) as { formulas: FormulaEntry[] };
  math.formulas = math.formulas.map((e) => (e.id === id ? entry : e));
  await writeFile(mathPath, `${JSON.stringify(math, null, 2)}\n`);

  const contentPath = join(x.dir, "content.md");
  const content = await readFile(contentPath, "utf-8").catch(() => null);
  const next = content === null ? null : replaceFormulaInContent(content, entry);
  if (next !== null) await writeFile(contentPath, next);
  x.formulas = math.formulas;
  return { entry, verdict, contentUpdated: next !== null };
}

/**
 * content.md with formula `f` shown as its correction (or its reading) and
 * its note: the n-th `$$…$$` line in the formula block of its page section
 * (`## Page N` / `## Slide N`, or the whole file for one page). Null when
 * the block isn't there.
 */
export function replaceFormulaInContent(content: string, f: FormulaEntry): string | null {
  const m = /^p(\d+)-(\d+)$/.exec(f.id);
  if (!m) return null;
  const pageNo = Number(m[1]);
  const nth = Number(m[2]);
  const lines = content.split("\n");
  const heads = lines.flatMap((l, i) => (/^## (Page|Slide) \d+$/.test(l) ? [i] : []));
  let start = 0;
  let end = lines.length;
  if (heads.length) {
    const h = heads.findIndex((i) => lines[i] === `## Page ${pageNo}` || lines[i] === `## Slide ${pageNo}`);
    if (h < 0) return null;
    start = heads[h]!;
    end = heads[h + 1] ?? lines.length;
  }
  const heading = lines.findIndex((l, i) => i >= start && i < end && l.startsWith("_Formulas on this page"));
  if (heading < 0) return null;
  const blocks = lines.flatMap((l, i) => (i > heading && i < end && /^\$\$.*\$\$$/.test(l) ? [i] : []));
  const at = blocks[nth - 1];
  if (at === undefined) return null;
  const note = formulaNote(f);
  const hasNote = lines[at + 1]?.startsWith("_(formula ") ?? false;
  lines.splice(at, hasNote ? 2 : 1, `$$${f.corrected?.latex ?? f.latex}$$`, ...(note ? [note] : []));
  return lines.join("\n");
}
