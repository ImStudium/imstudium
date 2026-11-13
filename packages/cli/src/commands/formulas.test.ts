import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { FormulasCheckOutput, FormulasFixOutput, FormulasListOutput } from "@imstudium/contract";
import { makeFixture, runCli, type Fixture } from "../test/harness.js";

/** `imstudium formulas` on a synthetic extracted photo (no PDF text layer, so no PDFium needed). */

let fx: Fixture;
let dir: string;
const formula = (id: string, latex: string, check: string, extra: object = {}) => ({
  id,
  page: 0,
  bbox: [0, 0, 10, 10],
  latex,
  score: 0.9,
  issues: check === "differs" ? ["\\right without a delimiter"] : [],
  glyphs: null,
  check,
  crop: `formulas/${id}.png`,
  ...extra,
});

beforeEach(async () => {
  fx = await makeFixture();
  dir = join(fx.workspace, "WS2026-27", "statistik-i", "extracted", "tafel-png");
  await mkdir(join(dir, "formulas"), { recursive: true });
  await writeFile(join(dir, "manifest.json"), JSON.stringify({ source: join(fx.workspace, "WS2026-27", "statistik-i", "files", "tafel.png"), kind: "image" }));
  await writeFile(
    join(dir, "math.json"),
    JSON.stringify({ model: "pp-formulanet_plus-l (oar-ocr v0.3.0)", layoutModel: "pp-doclayoutv2 (oar-ocr v0.3.0)", formulas: [formula("p1-1", "a^{2}+b^{2}", "unchecked"), formula("p1-2", "|x|=\\left\\{x\\right", "differs")] }),
  );
  await writeFile(
    join(dir, "content.md"),
    "# tafel.png\n\n> image · 1 page(s)\n\nTafel\n\n_Formulas on this page, read on this machine as LaTeX (PP-FormulaNet+ L): check against the original._\n\n$$a^{2}+b^{2}$$\n_(formula p1-1 unchecked: no text on the page to compare with. Image: formulas/p1-1.png)_\n\n$$|x|=\\left\\{x\\right$$\n_(formula p1-2 needs a look: \\right without a delimiter. Image: formulas/p1-2.png)_\n",
  );
});

describe("imstudium formulas", () => {
  it("list: every formula with its check and absolute image path; --needs-look filters", () => {
    const out = FormulasListOutput.parse(runCli(fx, ["--json", "formulas", "list", dir]).json());
    expect(out.summary).toEqual({ total: 2, match: 0, differs: 1, unchecked: 1, corrected: 0 });
    expect(out.formulas[1]).toMatchObject({ id: "p1-2", page: 1, why: "\\right without a delimiter", crop: join(dir, "formulas", "p1-2.png") });
    const human = runCli(fx, ["formulas", "list", join(dir, "content.md")]);
    expect(human.stdout).toContain("p1-2    NEEDS A LOOK");
    expect(human.stdout).toContain("imstudium formulas check");
  });

  it("check never writes; fix refuses what doesn't check and stores what does", async () => {
    const before = await readFile(join(dir, "content.md"), "utf-8");
    const bad = FormulasCheckOutput.parse(runCli(fx, ["--json", "formulas", "check", dir, "p1-2", "--latex", "|x|=\\left\\{x"]).json());
    expect(bad).toMatchObject({ accepted: false, verdict: { check: "differs" } });
    expect(await readFile(join(dir, "content.md"), "utf-8")).toBe(before);

    const refused = runCli(fx, ["--json", "formulas", "fix", dir, "p1-2", "--latex", "|x|=\\left\\{x"]);
    expect(refused.status).toBe(2);
    expect(JSON.parse(refused.stderr).error.code).toBe("FORMULA_MISMATCH");

    const latex = "|x|=\\begin{cases}x&x\\geq0\\\\-x&x<0\\end{cases}";
    const fixed = runCli(fx, ["--json", "formulas", "fix", dir, "p1-2", "--latex", latex, "--by", "claude-code"]);
    expect(fixed.status, fixed.stderr).toBe(0);
    expect(FormulasFixOutput.parse(fixed.json())).toMatchObject({ id: "p1-2", latex, by: "claude-code", contentUpdated: true });
    const content = await readFile(join(dir, "content.md"), "utf-8");
    expect(content).toContain(`$$${latex}$$\n_(formula p1-2 corrected by claude-code from its image;`);
    expect(content).toContain("$$a^{2}+b^{2}$$\n_(formula p1-1 unchecked");
    const list = FormulasListOutput.parse(runCli(fx, ["--json", "formulas", "list", dir, "--needs-look"]).json());
    expect(list.formulas.map((f) => f.id)).toEqual(["p1-1"]);
    expect(list.summary.corrected).toBe(1);
  });

  it("a name fragment finds the file in the workspace; an unknown id is FORMULA_NOT_FOUND", () => {
    const r = runCli(fx, ["--json", "formulas", "list", "tafel"]);
    expect(r.status, r.stderr).toBe(0);
    expect(FormulasListOutput.parse(r.json()).dir).toBe(dir);
    const missing = runCli(fx, ["--json", "formulas", "check", dir, "p7-1", "--latex", "x"]);
    expect(JSON.parse(missing.stderr).error.code).toBe("FORMULA_NOT_FOUND");
  });
});
