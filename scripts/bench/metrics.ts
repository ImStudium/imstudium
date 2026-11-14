/**
 * Benchmark metrics: character error rate and word recall for text, token
 * similarity for LaTeX, both as written and as rendered (KaTeX → MathML, so
 * `\operatorname*{lim}` and `\lim`, or `pmatrix` and `\left(\begin{matrix}`,
 * count as the same formula). Unit-tested in metrics.test.ts.
 */
import { createRequire } from "node:module";

const katex = createRequire(import.meta.url)("katex") as { renderToString(s: string, o: object): string };

/** Levenshtein distance over arrays of comparable items (chars or tokens). */
export function editDistance<T>(a: ArrayLike<T>, b: ArrayLike<T>): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = new Uint32Array(b.length + 1);
  let cur = new Uint32Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    const ai = a[i - 1];
    for (let j = 1; j <= b.length; j++) {
      const cost = ai === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length]!;
}

const IMAGE_ONLY = "_(image-only page — no text layer)_";
const LOW = "_(read by OCR with low confidence — check the original)_";

/**
 * Markdown → the plain text a reader sees: no heading marks, emphasis, table
 * pipes, sub/sup tags, our page markers or formula blocks; whitespace collapsed.
 */
export function plainText(markdown: string): string {
  return markdown
    .replace(IMAGE_ONLY, " ")
    .replace(LOW, " ")
    .replace(/^_Formulas on this page[^\n]*$/gm, " ")
    .replace(/^_\(formula p\d+-\d+ [^\n]*$/gm, " ")
    .replace(/\$\$[^$]*\$\$/g, " ")
    .replace(/<\/?(sub|sup|br)\s*\/?>/gi, "")
    .replace(/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/gm, " ")
    .replace(/\|/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/\*\*|__|\*|`/g, "")
    .replace(/(^|\s)_(\S)/g, "$1$2")
    .replace(/(\S)_(\s|$)/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

/** Character error rate of `predicted` against `truth` (both plain text). 0 is perfect; can exceed 1. */
export function cer(predicted: string, truth: string): number {
  if (!truth.length) return predicted.length ? 1 : 0;
  return editDistance(predicted, truth) / truth.length;
}

const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/** Share of the truth's words (as a multiset) found in the prediction, order ignored. */
export function wordRecall(predicted: string, truth: string): number {
  const want = words(truth);
  if (!want.length) return 1;
  const have = new Map<string, number>();
  for (const w of words(predicted)) have.set(w, (have.get(w) ?? 0) + 1);
  let found = 0;
  for (const w of want) {
    const n = have.get(w) ?? 0;
    if (n > 0) {
      found++;
      have.set(w, n - 1);
    }
  }
  return found / want.length;
}

const SYNONYMS: Record<string, string> = {
  "\\varepsilon": "\\epsilon",
  "\\le": "\\leq",
  "\\ge": "\\geq",
  "\\to": "\\rightarrow",
  "\\dfrac": "\\frac",
  "\\tfrac": "\\frac",
  "\\operatorname": "\\mathrm",
  "\\lvert": "|",
  "\\rvert": "|",
  "\\vert": "|",
  "\\mid": "|",
  "\\lbrace": "\\{",
  "\\rbrace": "\\}",
  "\\ne": "\\neq",
  "\\land": "\\wedge",
  "\\lor": "\\vee",
};
const DROP = new Set(["\\displaystyle", "\\left", "\\right", "\\big", "\\Big", "\\bigl", "\\bigr", "\\,", "\\;", "\\!", "\\:", "\\quad", "\\qquad", "~", "\\ "]);

/**
 * LaTeX → comparable tokens: commands and single characters, spacing and
 * sizing commands dropped, common synonyms unified, and every sub/superscript
 * braced (x_i ≡ x_{i}), so two spellings of the same formula compare equal.
 */
export function latexTokens(latex: string): string[] {
  const raw = latex.match(/\\[a-zA-Z]+|\\.|[^\s]/g) ?? [];
  const toks = raw.map((t) => SYNONYMS[t] ?? t).filter((t) => !DROP.has(t));
  const out: string[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    out.push(t);
    if ((t === "_" || t === "^") && toks[i + 1] !== undefined && toks[i + 1] !== "{") {
      out.push("{", toks[i + 1]!, "}");
      i++;
    }
  }
  return out;
}

/** 1 − token edit distance / longer length: 1 is identical after normalisation. */
export function latexSimilarity(predicted: string, truth: string): number {
  const a = latexTokens(predicted);
  const b = latexTokens(truth);
  const n = Math.max(a.length, b.length);
  return n ? 1 - editDistance(a, b) / n : 1;
}

/**
 * The formula as KaTeX lays it out, as MathML tokens without attributes,
 * grouping rows or annotations. Null when KaTeX can't parse it.
 */
export function mathmlTokens(latex: string): string[] | null {
  let mml: string;
  try {
    mml = katex.renderToString(latex, { output: "mathml", throwOnError: true, displayMode: true, strict: "ignore" });
  } catch {
    return null;
  }
  const body = mml
    .replace(/<annotation[\s\S]*?<\/annotation>/g, "")
    .replace(/<(\/?)(\w+)[^>]*>/g, "<$1$2>")
    .replace(/<\/?(mrow|semantics|math|mstyle|span)>/g, "");
  // What looks the same on the page compares the same: invisible operators, spacing
  // (\, renders as an <mtext> space), glyph variants, and identifier/number boundaries
  // (\mathrm{Var} gives three <mi>, \operatorname{Var} one).
  const variants: Record<string, string> = { "ϵ": "ε", "∣": "|", "‾": "ˉ", "ϕ": "φ" };
  const toks = (body.match(/<\/?\w+>|[^<]/gu) ?? [])
    .filter((t) => !/^[\u2061-\u2064\s\u00a0\u2000-\u200b\u205f]$/u.test(t) && !/^<\/?(mi|mn)>$/.test(t))
    .map((t) => variants[t] ?? t);
  const out: string[] = [];
  for (const t of toks) {
    const open = out[out.length - 1];
    if (open && /^<(mo|mtext)>$/.test(open) && t === `</${open.slice(1)}`) out.pop();
    else out.push(t);
  }
  return out;
}

/**
 * Same symbols in the same structure, while the look may differ: what is
 * left once operator and cell boundaries go (`\left|x\right|` for `|x|`,
 * `=&` for `&=` in `aligned`, an `aligned` in a brace for `cases`).
 * Scripts, fractions, roots, accents, boxes and every symbol still count.
 * False when either doesn't parse.
 */
export function sameSymbols(predicted: string, truth: string): boolean {
  // Delimiter sizing is look: \left\|x\right\|_2 groups x before the subscript, \|x\|_2 doesn't, and both print ‖x‖₂.
  const unsized = (latex: string) => latex.replace(/\\(left|right)\s*\./g, "").replace(/\\(left|right|[bB]igg?[lr]?)(?![a-zA-Z])/g, "");
  const strip = (latex: string) => mathmlTokens(unsized(latex))?.filter((t) => !/^<\/?(mo|mtd|mtext|mrow)>$/.test(t));
  const a = strip(predicted);
  const b = strip(truth);
  return !!a && !!b && a.join(" ") === b.join(" ");
}

/** Similarity of the rendered formulas (MathML tokens); falls back to the LaTeX tokens when either doesn't parse. */
export function renderedSimilarity(predicted: string, truth: string): number {
  const a = mathmlTokens(predicted);
  const b = mathmlTokens(truth);
  if (!a || !b) return latexSimilarity(predicted, truth);
  const n = Math.max(a.length, b.length);
  return n ? 1 - editDistance(a, b) / n : 1;
}

export interface FormulaScore {
  /** Truth formulas with a prediction of rendered similarity ≥ 0.5. */
  found: number;
  /** Identical LaTeX after normalising spacing and script braces. */
  exactLatex: number;
  /** Identical rendering (same MathML). */
  sameRendering: number;
  /** Mean rendered similarity over the truth formulas (unmatched count as 0). */
  similarity: number;
  /** Predictions that matched no truth formula. */
  extra: number;
  /**
   * Each truth formula with what it was matched to (null: nothing at ≥ 50 %)
   * and the rendered similarity; an unmatched one also gets the closest
   * leftover prediction, if any.
   */
  pairs: Array<{ truth: string; predicted: string | null; index?: number; similarity: number; closest?: { latex: string; similarity: number } }>;
  /** Indexes of predictions that matched no truth formula. */
  unmatched: number[];
}

/** Greedy best-first matching of predicted to truth formulas on one page, by rendered similarity. */
export function scoreFormulas(predicted: string[], truth: string[]): FormulaScore {
  const pairs: Array<{ p: number; t: number; s: number }> = [];
  predicted.forEach((p, i) => truth.forEach((t, j) => pairs.push({ p: i, t: j, s: renderedSimilarity(p, t) })));
  pairs.sort((x, y) => y.s - x.s);
  const usedP = new Set<number>();
  const best = new Array<number>(truth.length).fill(0);
  const match = new Array<number>(truth.length).fill(-1);
  for (const { p, t, s } of pairs) {
    if (usedP.has(p) || match[t]! >= 0 || s < 0.5) continue;
    usedP.add(p);
    match[t] = p;
    best[t] = s;
  }
  return {
    found: match.filter((m) => m >= 0).length,
    exactLatex: match.filter((m, t) => m >= 0 && latexSimilarity(predicted[m]!, truth[t]!) === 1).length,
    sameRendering: best.filter((s) => s === 1).length,
    similarity: truth.length ? best.reduce((a, b) => a + b, 0) / truth.length : 1,
    extra: predicted.length - usedP.size,
    pairs: truth.map((t, j) => {
      if (match[j]! >= 0) return { truth: t, predicted: predicted[match[j]!]!, index: match[j]!, similarity: best[j]! };
      const near = pairs.find((x) => x.t === j && !usedP.has(x.p));
      return { truth: t, predicted: null, similarity: 0, ...(near ? { closest: { latex: predicted[near.p]!, similarity: near.s } } : {}) };
    }),
    unmatched: predicted.map((_, i) => i).filter((i) => !usedP.has(i)),
  };
}
