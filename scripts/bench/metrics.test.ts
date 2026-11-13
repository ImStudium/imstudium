import { describe, expect, it } from "vitest";
import { cer, editDistance, latexSimilarity, latexTokens, mathmlTokens, plainText, renderedSimilarity, scoreFormulas, wordRecall } from "./metrics.ts";

describe("bench metrics", () => {
  it("editDistance", () => {
    expect(editDistance("kitten", "sitting")).toBe(3);
    expect(editDistance("", "abc")).toBe(3);
    expect(editDistance(["\\frac", "{"], ["\\frac", "{"])).toBe(0);
  });

  it("plainText strips markdown, markers and formula blocks", () => {
    const md = "# Titel\n\n**Fett** und *kursiv* mit x<sub>i</sub>\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n- Punkt\n\n_Formulas on this page, read on this machine as LaTeX (PP-FormulaNet+ S): check against the original._\n\n$$a^{2}$$\n\n_(image-only page — no text layer)_";
    expect(plainText(md)).toBe("Titel Fett und kursiv mit xi A B 1 2 Punkt");
  });

  it("cer and wordRecall", () => {
    expect(cer("Varianz", "Varianz")).toBe(0);
    expect(cer("Varianx", "Varianz")).toBeCloseTo(1 / 7);
    expect(cer("", "abc")).toBe(1);
    expect(wordRecall("die Varianz ist groß", "Groß ist die Varianz")).toBe(1);
    expect(wordRecall("die Varianz", "die die Varianz")).toBeCloseTo(2 / 3);
  });

  it("latexTokens braces scripts, drops spacing and unifies synonyms", () => {
    expect(latexTokens("x_i^2")).toEqual(latexTokens("x_{i}^{2}"));
    expect(latexTokens("\\left( a \\right)\\,\\varepsilon")).toEqual(["(", "a", ")", "\\epsilon"]);
    expect(latexTokens("\\operatorname{Var}(X)")).toEqual(latexTokens("\\mathrm{Var}(X)"));
  });

  it("latexSimilarity and scoreFormulas", () => {
    expect(latexSimilarity("E[X]=\\sum_{i=1}^{n}x_{i}p(x_{i})", "E[X] = \\sum_{i=1}^{n} x_i \\, p(x_i)")).toBe(1);
    expect(latexSimilarity("a+b", "a-b")).toBeCloseTo(2 / 3);
    const s = scoreFormulas(["a+b", "\\sqrt{2}", "zzz"], ["\\sqrt{2}", "a-b", "e^{i\\pi}+1=0"]);
    expect(s).toMatchObject({ found: 2, exactLatex: 1, sameRendering: 1, extra: 1 });
    expect(s.similarity).toBeGreaterThan(0.5);
    expect(s.similarity).toBeLessThan(1);
  });

  it("rendered similarity treats spellings of the same formula as equal", () => {
    expect(renderedSimilarity("\\operatorname*{lim}_{n\\to\\infty}x", "\\lim_{n \\to \\infty} x")).toBe(1);
    expect(renderedSimilarity("\\left(\\begin{matrix}{a}&{b}\\\\ {c}&{d}\\\\ \\end{matrix}\\right)", "\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}")).toBe(1);
    expect(renderedSimilarity("x+1", "x-1")).toBeLessThan(1);
    expect(mathmlTokens("\\frac{")).toBeNull();
    expect(renderedSimilarity("\\frac{", "\\frac{1}{2}")).toBe(latexSimilarity("\\frac{", "\\frac{1}{2}"));
  });
});
