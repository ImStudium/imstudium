import { existsSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";
import type { Command } from "commander";
import {
  checkExtractedFormula,
  describeVerdict,
  expandPath,
  extractSlug,
  findFormula,
  fixExtractedFormula,
  ImstudiumError,
  loadExtractedFormulas,
  resolveCourseDir,
  slugify,
  type ExtractedFormulas,
  type FormulaEntry,
} from "@imstudium/sdk";
import type { FormulasCheckOutput, FormulasFixOutput, FormulasListOutput } from "@imstudium/contract";
import { act, getSdk, output, type Sdk } from "../runtime.js";
import { workspaceCourse } from "../course-arg.js";
import { courseOption, outputOption, workspaceDir } from "../kit/args.js";
import { requireWorkspace } from "./workspace.js";

/**
 * The extracted folder for `target`: the folder itself, a file in it
 * (content.md, math.json), an original under a course's files/, or a name
 * fragment matched against the extracted files of the workspace.
 */
async function resolveExtracted(sdk: Sdk, target: string, opts: { course?: string; output?: string }): Promise<ExtractedFormulas> {
  const path = expandPath(target);
  let dir: string | null = null;
  if (existsSync(path)) {
    if (statSync(path).isDirectory()) dir = path;
    else if (["content.md", "math.json", "manifest.json", "formulas.checked.json"].includes(basename(path))) dir = dirname(path);
    else {
      // An original: <course>/files/<…>/<name> → <course>/extracted/<slug of the path below files/>.
      const parts = path.split(sep);
      const at = parts.lastIndexOf("files");
      if (at > 0) dir = join(parts.slice(0, at).join(sep), "extracted", extractSlug(parts.slice(at + 1).join(sep)));
    }
  } else {
    const ws = workspaceDir(sdk, opts);
    const workspace = await requireWorkspace(sdk, ws);
    const courses = opts.course ? [workspaceCourse(sdk, workspace, opts.course)] : workspace.courses;
    const needle = slugify(target).toLowerCase();
    const hits: string[] = [];
    for (const course of courses) {
      const root = join(resolveCourseDir(ws, course, workspace), "extracted");
      for (const name of await readdir(root).catch(() => [] as string[])) {
        if (name.toLowerCase().includes(needle) && existsSync(join(root, name, "math.json"))) hits.push(join(root, name));
      }
    }
    if (hits.length > 1) {
      throw new ImstudiumError(`"${target}" matches ${hits.length} files with formulas`, "BAD_ARGS", undefined, `Be more specific, or pass the folder: ${hits.slice(0, 4).map((h) => relative(ws, h)).join(" · ")}`);
    }
    dir = hits[0] ?? null;
  }
  const x = dir ? await loadExtractedFormulas(dir) : null;
  if (!x) {
    throw new ImstudiumError(`No recognised formulas for "${target}"`, "FORMULA_NOT_FOUND", 404);
  }
  return x;
}

function item(x: ExtractedFormulas, f: FormulaEntry): FormulasListOutput["formulas"][number] {
  const verdict = f.corrected?.verdict ?? { issues: f.issues, glyphs: f.glyphs, check: f.check };
  return {
    id: f.id,
    page: f.page + 1,
    latex: f.corrected?.latex ?? f.latex,
    modelLatex: f.latex,
    verdict,
    why: describeVerdict(verdict),
    crop: f.crop ? join(x.dir, f.crop) : null,
    confidence: f.confidence ?? null,
    otherReadings: f.otherReadings ?? [],
    corrected: f.corrected ? { by: f.corrected.by, at: f.corrected.at } : null,
  };
}

const short = (s: string, n = 70) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function registerFormulas(program: Command): void {
  const formulas = program
    .command("formulas")
    .description("Formulas read from a file: each with its check against the PDF and its image; check or store a correction");

  formulas
    .command("list")
    .description("Every display formula of one extracted file, with its check against the PDF and the path of its image")
    .argument("<file>", "Extracted folder, its content.md, the original under files/, or a name fragment")
    .option("--needs-look", "Only formulas whose check didn't pass and that aren't corrected yet")
    .addOption(courseOption("Search only this course for the name fragment"))
    .addOption(outputOption())
    .action(
      act(async (target: string, opts: { needsLook?: boolean; course?: string; output?: string }) => {
        const sdk = await getSdk();
        const x = await resolveExtracted(sdk, target, opts);
        const all = x.formulas.map((f) => item(x, f));
        const shown = opts.needsLook ? all.filter((f) => !f.corrected && f.verdict.check !== "match") : all;
        const payload: FormulasListOutput = {
          dir: x.dir,
          source: x.source,
          model: x.model,
          layoutModel: x.layoutModel,
          summary: {
            total: all.length,
            match: all.filter((f) => !f.corrected && f.verdict.check === "match").length,
            differs: all.filter((f) => !f.corrected && f.verdict.check === "differs").length,
            unchecked: all.filter((f) => !f.corrected && f.verdict.check === "unchecked").length,
            corrected: all.filter((f) => f.corrected).length,
          },
          formulas: shown,
        };
        const s = payload.summary;
        const lines = [
          `${basename(x.source)}: ${s.total} formula(s) · ${s.match} check against the PDF · ${s.differs} need a look · ${s.unchecked} unchecked · ${s.corrected} corrected`,
          ...shown.map((f) => {
            const state = f.corrected ? `corrected by ${f.corrected.by}` : f.verdict.check === "match" ? "checks" : f.verdict.check === "differs" ? "NEEDS A LOOK" : "unchecked";
            return `  ${f.id.padEnd(7)} ${state.padEnd(22)} ${short(f.latex)}${f.why && !f.corrected ? `\n          ${f.why}` : ""}${f.crop && !f.corrected && f.verdict.check !== "match" ? `\n          image: ${f.crop}` : ""}`;
          }),
        ];
        if (s.differs + s.unchecked > 0) lines.push("", "Look at each image, write only what it shows, then: imstudium formulas check <file> <id> --latex '…'");
        output(payload, lines.join("\n"));
      }),
    );

  formulas
    .command("check")
    .description("Check a reading of one formula against the PDF without storing it (letters and digits must match what the page has in that box)")
    .argument("<file>", "Extracted folder, its content.md, the original, or a name fragment")
    .argument("<id>", "Formula id, e.g. p3-2 (imstudium formulas list)")
    .requiredOption("--latex <latex>", "The LaTeX to check")
    .addOption(courseOption("Search only this course for the name fragment"))
    .addOption(outputOption())
    .action(
      act(async (target: string, id: string, opts: { latex: string; course?: string; output?: string }) => {
        const sdk = await getSdk();
        const x = await resolveExtracted(sdk, target, opts);
        const f = findFormula(x, id);
        const verdict = await checkExtractedFormula(x, id, opts.latex.trim());
        const payload: FormulasCheckOutput = {
          id,
          latex: opts.latex.trim(),
          modelLatex: f.latex,
          verdict,
          why: describeVerdict(verdict),
          accepted: verdict.check !== "differs",
        };
        const head =
          verdict.check === "match"
            ? `${id}: checks. Every letter and digit matches the PDF (positions are not compared: compare the image).`
            : verdict.check === "unchecked"
              ? `${id}: well-formed; the page has no text to compare with, so only the image can tell.`
              : `${id}: doesn't check: ${payload.why}`;
        output(payload, head);
      }),
    );

  formulas
    .command("fix")
    .description("Store a correction of one formula, made from its image: refused unless it checks; content.md then shows it, marked as corrected")
    .argument("<file>", "Extracted folder, its content.md, the original, or a name fragment")
    .argument("<id>", "Formula id, e.g. p3-2 (imstudium formulas list)")
    .requiredOption("--latex <latex>", "The corrected LaTeX: only what the image shows")
    .option("--by <name>", "Who corrected it (the harness, e.g. claude-code or codex, or student)", "agent")
    .addOption(courseOption("Search only this course for the name fragment"))
    .addOption(outputOption())
    .action(
      act(async (target: string, id: string, opts: { latex: string; by: string; course?: string; output?: string }) => {
        const sdk = await getSdk();
        const x = await resolveExtracted(sdk, target, opts);
        const { entry, verdict, contentUpdated } = await fixExtractedFormula(x, id, opts.latex, opts.by);
        const payload: FormulasFixOutput = {
          id,
          latex: entry.corrected!.latex,
          modelLatex: entry.latex,
          verdict,
          by: opts.by,
          dir: x.dir,
          contentUpdated,
        };
        output(
          payload,
          `${id} corrected${verdict.check === "match" ? " (letters and digits match the PDF)" : " (no text on the page to compare with)"}; ${contentUpdated ? "content.md shows it" : "content.md not changed (formula block not found)"}. Search sees it after: imstudium index`,
        );
      }),
    );
}
