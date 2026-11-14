import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyFormulaFixes,
  describeVerdict,
  fixExtractedFormula,
  formulaNote,
  loadExtractedFormulas,
  readFormulaFixes,
  replaceFormulaInContent,
  type FormulaEntry,
} from "./formulas.js";

const base = { score: 0.9, bbox: [0, 0, 10, 10] as [number, number, number, number], issues: [] as string[] };
const f = (id: string, latex: string, extra: Partial<FormulaEntry> = {}): FormulaEntry => ({
  ...base,
  id,
  page: Number(id.slice(1).split("-")[0]) - 1,
  latex,
  glyphs: null,
  check: "unchecked",
  ...extra,
});

const CONTENT = [
  "# deck.pdf",
  "",
  "> slides · 2 page(s)",
  "",
  "## Page 1",
  "",
  "Intro",
  "",
  "## Page 2",
  "",
  "Formeln",
  "",
  "_Formulas on this page, read on this machine as LaTeX (UniRec-0.1B): check against the original._",
  "",
  "$$a+b$$",
  "",
  "$$\\sum_{j=1}^{n}x_{i}$$",
  "_(formula p2-2 needs a look: the LaTeX has j j, the PDF doesn't. Image: formulas/p2-2.png)_",
  "",
].join("\n");

describe("formula notes", () => {
  it("describeVerdict says what differs, or nothing when the check passed", () => {
    expect(describeVerdict({ issues: [], glyphs: { missing: [], extra: [], pdf: 3 }, check: "match" })).toBeNull();
    expect(describeVerdict({ issues: ["unbalanced braces"], glyphs: { missing: ["p"], extra: ["k", "k"], pdf: 3 }, check: "differs" })).toBe(
      "unbalanced braces; the PDF has p here, the LaTeX doesn't; the LaTeX has k k, the PDF doesn't",
    );
    expect(describeVerdict({ issues: [], glyphs: null, check: "unchecked" })).toBe("no text on the page to compare with");
    expect(describeVerdict({ issues: [], glyphs: null, check: "unchecked", picture: true })).toBe("the formula is a picture in the PDF, with no text to compare with");
    expect(describeVerdict({ issues: [], glyphs: { missing: [], extra: ["a", "n"], pdf: 4 }, check: "partial" })).toBe(
      "partly a picture in the PDF: the characters that are there agree, and it draws a n as shapes",
    );
  });

  it("formulaNote: none for a passing check, the reason and image otherwise, and who corrected it", () => {
    expect(formulaNote(f("p1-1", "x", { check: "match", glyphs: { missing: [], extra: [], pdf: 1 } }))).toBeNull();
    expect(formulaNote(f("p1-1", "x", { crop: "formulas/p1-1.png" }))).toBe("_(formula p1-1 unchecked: no text on the page to compare with. Image: formulas/p1-1.png)_");
    expect(formulaNote(f("p1-1", "x_{1}", { check: "partial", glyphs: { missing: [], extra: ["x"], pdf: 1 } }))).toBe(
      "_(formula p1-1 partly checked: partly a picture in the PDF: the characters that are there agree, and it draws x as shapes.)_",
    );
    const corrected = f("p1-1", "x", { corrected: { latex: "y", by: "codex", at: "t", verdict: { issues: [], glyphs: null, check: "unchecked" } } });
    expect(formulaNote(corrected)).toBe("_(formula p1-1 corrected by codex from its image; the page has no text to compare with.)_");
  });
});

describe("corrections", () => {
  it("applyFormulaFixes attaches a fix only while the model still reads the same", () => {
    const fix = { id: "p2-2", modelLatex: "\\sum_{j=1}^{n}x_{i}", latex: "\\sum_{i=1}^{n}x_{i}", by: "agent", at: "t", verdict: { issues: [], glyphs: null, check: "unchecked" as const } };
    expect(applyFormulaFixes([f("p2-2", "\\sum_{j=1}^{n}x_{i}")], [fix])[0]!.corrected?.latex).toBe("\\sum_{i=1}^{n}x_{i}");
    expect(applyFormulaFixes([f("p2-2", "\\sum_{k=1}^{n}x_{i}")], [fix])[0]!.corrected).toBeUndefined();
  });

  it("replaceFormulaInContent swaps the n-th formula of the page and its note, nothing else", () => {
    const fixed = f("p2-2", "\\sum_{j=1}^{n}x_{i}", {
      corrected: { latex: "\\sum_{i=1}^{n}x_{i}", by: "agent", at: "t", verdict: { issues: [], glyphs: { missing: [], extra: [], pdf: 4 }, check: "match" } },
    });
    const next = replaceFormulaInContent(CONTENT, fixed)!;
    expect(next).toContain("$$\\sum_{i=1}^{n}x_{i}$$\n_(formula p2-2 corrected by agent from its image; its letters and digits match the PDF.)_\n");
    expect(next).not.toContain("needs a look");
    expect(next).toContain("$$a+b$$");
    expect(next.split("\n").length).toBe(CONTENT.split("\n").length);
    expect(replaceFormulaInContent(CONTENT, f("p1-1", "x"))).toBeNull();
    expect(replaceFormulaInContent(CONTENT, f("p2-3", "x"))).toBeNull();
  });

  it("fixExtractedFormula stores a correction that checks and refuses one that doesn't", async () => {
    const dir = await mkdtemp(join(tmpdir(), "imstudium-formulas-"));
    await writeFile(join(dir, "manifest.json"), JSON.stringify({ source: join(dir, "deck.png"), kind: "image" }));
    await writeFile(join(dir, "math.json"), JSON.stringify({ model: "m", layoutModel: "l", formulas: [f("p2-1", "a+b"), f("p2-2", "\\sum_{j=1}^{n}x_{i}")] }));
    await writeFile(join(dir, "content.md"), CONTENT);
    const x = (await loadExtractedFormulas(dir))!;
    await expect(fixExtractedFormula(x, "p2-2", "\\sum_{i=1}^{n}x_{i", "agent")).rejects.toMatchObject({ code: "FORMULA_MISMATCH" });
    await expect(fixExtractedFormula(x, "p9-9", "x", "agent")).rejects.toMatchObject({ code: "FORMULA_NOT_FOUND" });
    const r = await fixExtractedFormula(x, "p2-2", " \\sum_{i=1}^{n}x_{i} ", "claude-code");
    expect(r).toMatchObject({ contentUpdated: true, verdict: { check: "unchecked" } });
    expect(await readFile(join(dir, "content.md"), "utf-8")).toContain("$$\\sum_{i=1}^{n}x_{i}$$\n_(formula p2-2 corrected by claude-code from its image;");
    expect((await readFormulaFixes(dir)).map((x) => [x.id, x.modelLatex, x.latex])).toEqual([["p2-2", "\\sum_{j=1}^{n}x_{i}", "\\sum_{i=1}^{n}x_{i}"]]);
    const math = JSON.parse(await readFile(join(dir, "math.json"), "utf-8")) as { formulas: FormulaEntry[] };
    expect(math.formulas[1]!.latex).toBe("\\sum_{j=1}^{n}x_{i}");
    expect(math.formulas[1]!.corrected?.by).toBe("claude-code");
  });
});
