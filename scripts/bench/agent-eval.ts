/**
 * Agent correction eval: can a coding agent, with the imstudium-visual skill
 * and `imstudium formulas`, write down every formula of the hard Beamer decks
 * correctly, and invent nothing?
 *
 *   node scripts/bench/agent-eval.ts prepare <dir> [--decks=beamer-sans,beamer-sans-scan]
 *       Extracts each deck into <dir>/<deck>/ (files/ and extracted/, as sync
 *       --extract would) and writes <dir>/<deck>/TASK.md. No ground truth goes
 *       into <dir>: the agent sees what a student's workspace would hold.
 *   node scripts/bench/agent-eval.ts score <dir> [--write]
 *       Scores <dir>/<deck>/answers.json ([{ page, id?, latex }]) against
 *       .bench/fixtures/truth.json, next to the model's own readings, and with
 *       --write puts the table into docs/BENCHMARKS.md.
 *
 * Runs under Node with the math runtime installed (IMSTUDIUM_OCR_DIR to point
 * elsewhere), after `bun run bench -- --regen` has built the Beamer decks.
 */
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Truth } from "./fixtures.ts";
import { mathmlTokens, sameSymbols, scoreFormulas } from "./metrics.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIX = join(ROOT, ".bench", "fixtures");
const CLI = join(ROOT, "packages", "cli", "dist", "cli.js");
const SKILL = join(ROOT, "packages", "cli", "skills", "imstudium-visual", "SKILL.md");
const [mode, dirArg, ...rest] = process.argv.slice(2);
const flags = new Set(rest);
const decksFlag = rest.find((a) => a.startsWith("--decks="))?.slice("--decks=".length);

if (!mode || !dirArg || !["prepare", "score"].includes(mode)) {
  console.error("usage: agent-eval.ts prepare|score <dir> [--decks=a,b] [--write]");
  process.exit(2);
}
const dir = resolve(dirArg);
const truth = JSON.parse(await readFile(join(FIX, "truth.json"), "utf-8")) as Truth;
const setOf = (deck: string) => truth.sets.find((s) => s.name === deck.replace(/-scan$/, ""));

interface Answer {
  page: number;
  id?: string | null;
  latex: string;
}

if (mode === "prepare") {
  const sdk = (await import(join(ROOT, "packages", "sdk", "dist", "index.js"))) as typeof import("../../packages/sdk/src/index.ts");
  if (!sdk.mathRuntimeStatus().ready) {
    console.error("agent-eval: the math runtime is not installed (imstudium setup ocr --math)");
    process.exit(2);
  }
  const decks = (decksFlag ?? "beamer-sans,beamer-sans-scan").split(",");
  const extractor = new sdk.Extractor();
  for (const deck of decks) {
    const pdf = join(FIX, `${deck}.pdf`);
    if (!existsSync(pdf) || !setOf(deck)) throw new Error(`no fixture ${deck} (run: bun run bench -- --regen)`);
    const files = join(dir, deck, "files");
    await mkdir(files, { recursive: true });
    const src = join(files, "Vorlesung-Mathe.pdf");
    await copyFile(pdf, src);
    const out = join(dir, deck, "extracted", sdk.extractSlug("Vorlesung-Mathe.pdf"));
    const r = await extractor.extractFile(src, out, { force: true });
    console.error(`· ${deck}: ${r.pages} pages, ${r.mathFormulas ?? 0} formulas → ${out}`);
    const cli = `IMSTUDIUM_OCR_DIR=${process.env.IMSTUDIUM_OCR_DIR ?? "~/.local/share/imstudium/ocr"} node ${CLI}`;
    await writeFile(
      join(dir, deck, "TASK.md"),
      [
        `# Write down the formulas of Vorlesung-Mathe.pdf`,
        "",
        "A student asked: \"Write down every display formula from these slides for my notes, page by page, as LaTeX, exactly as on the slides. Correct the notes where the extraction got a formula wrong.\"",
        "",
        `Follow the formula procedure in the imstudium-visual skill: ${SKILL}`,
        "",
        `The deck is ${src}; it was extracted to ${out} (content.md, math.json, formulas/*.png).`,
        `Run the CLI as: ${cli} <command>`,
        "",
        `Write what you would give the student to ${join(dir, deck, "answers.json")}: a JSON array of { "page": <1-based>, "id": "<formula id or null>", "latex": "<LaTeX>" }, one entry per display formula, in reading order.`,
        "",
        `Work only with the files in ${join(dir, deck)}, the skill file and the CLI.`,
        "",
      ].join("\n"),
    );
  }
  console.log(`prepared ${decks.join(", ")} in ${dir}`);
} else {
  const decks = (decksFlag?.split(",") ?? ["beamer-sans", "beamer-sans-scan", "beamer-serif", "beamer-serif-scan", "beamer-bullets", "beamer-bullets-scan"]).filter((d) => existsSync(join(dir, d, "answers.json")));
  const rows: string[] = [];
  const pct = (x: number) => `${(x * 100).toFixed(1)} %`;
  const score = (deck: string, byPage: Map<number, string[]>) => {
    const set = setOf(deck)!;
    let right = 0;
    let found = 0;
    let sim = 0;
    let n = 0;
    let invented = 0;
    let added = 0;
    let dropped = 0;
    let lookOnly = 0;
    const wrong: string[] = [];
    set.pages.forEach((p, i) => {
      const s = scoreFormulas(byPage.get(i + 1) ?? [], p.formulas);
      right += s.sameRendering;
      found += s.found;
      sim += s.similarity * p.formulas.length;
      n += p.formulas.length;
      invented += s.extra;
      for (const pair of s.pairs) {
        if (pair.predicted === null) {
          wrong.push(`p${i + 1}: missing ${pair.truth}`);
          continue;
        }
        if (pair.similarity === 1) continue;
        const look = sameSymbols(pair.predicted, pair.truth);
        if (look) lookOnly++;
        wrong.push(`p${i + 1} (${look ? "look only" : "meaning"}): ${pair.truth}  →  ${pair.predicted}`);
        // Symbols and structure (scripts, fractions, roots, boxes), not operator or cell markup.
        const symbols = (latex: string) => (mathmlTokens(latex) ?? []).filter((t) => !t.startsWith("</") && !/^<(mo|mtd|mtext|mtr|mtable)>$/.test(t));
        const a = symbols(pair.predicted);
        const b = symbols(pair.truth);
        const count = (xs: string[]) => xs.reduce((m, t) => m.set(t, (m.get(t) ?? 0) + 1), new Map<string, number>());
        const ca = count(a);
        const cb = count(b);
        for (const [t, k] of ca) added += Math.max(0, k - (cb.get(t) ?? 0));
        for (const [t, k] of cb) dropped += Math.max(0, k - (ca.get(t) ?? 0));
      }
    });
    return { right, found, n, similarity: sim / n, invented, added, dropped, wrong, lookOnly, meaning: n - right - lookOnly };
  };
  const report: string[] = [];
  for (const deck of decks) {
    const answers = JSON.parse(await readFile(join(dir, deck, "answers.json"), "utf-8")) as Answer[];
    const byPage = new Map<number, string[]>();
    for (const a of answers) byPage.set(a.page, [...(byPage.get(a.page) ?? []), a.latex]);
    const math = JSON.parse(await readFile(join(dir, deck, "extracted", (await readdir(join(dir, deck, "extracted")))[0]!, "math.json"), "utf-8")) as { formulas: Array<{ page: number; latex: string; check: string; corrected?: unknown }> };
    const model = new Map<number, string[]>();
    for (const f of math.formulas) model.set(f.page + 1, [...(model.get(f.page + 1) ?? []), f.latex]);
    const m = score(deck, model);
    const a = score(deck, byPage);
    // What the student's notes now say: the formula blocks of content.md, corrections included.
    const content = await readFile(join(dir, deck, "extracted", (await readdir(join(dir, deck, "extracted")))[0]!, "content.md"), "utf-8");
    const notes = new Map<number, string[]>();
    let page = 1;
    let inBlock = false;
    for (const line of content.split("\n")) {
      const head = /^## (?:Page|Slide) (\d+)$/.exec(line);
      if (head) [page, inBlock] = [Number(head[1]), false];
      else if (line.startsWith("_Formulas on this page")) inBlock = true;
      else if (inBlock && /^\$\$.*\$\$$/.test(line)) notes.set(page, [...(notes.get(page) ?? []), line.slice(2, -2)]);
    }
    const c = score(deck, notes);
    // Corrections the CLI stored that don't render as the slide's formula: the harm a passing check could let through.
    let wrongFixes = 0;
    const fixed = math.formulas.filter((f) => f.corrected) as Array<{ page: number; corrected: { latex: string } }>;
    setOf(deck)!.pages.forEach((p, i) => {
      const mine = fixed.filter((f) => f.page === i).map((f) => f.corrected.latex);
      if (!mine.length) return;
      const s = scoreFormulas(mine, p.formulas);
      const off = s.pairs.filter((x) => x.index !== undefined && x.similarity < 1 && !sameSymbols(x.predicted!, x.truth));
      wrongFixes += s.unmatched.length + off.length;
      for (const x of off) report.push(`  stored with a wrong meaning p${i + 1}: ${x.truth}  →  ${x.predicted}`);
      for (const k of s.unmatched) report.push(`  stored for no formula of the slide p${i + 1}: ${mine[k]}`);
    });
    const label = `${deck.replace(/-scan$/, "")} · ${deck.endsWith("-scan") ? "scan" : "text layer"}`;
    rows.push(`| ${label} | ${a.n} | ${m.right} · ${m.meaning} | **${a.right}** · ${a.lookOnly} · **${a.meaning}** | ${c.right} · ${c.meaning} | **${a.invented}** | **${a.added}** | ${a.dropped} | ${fixed.length} | **${wrongFixes}** |`);
    report.push(`${label}: model ${m.right}/${m.n} right (${m.meaning} meaning wrong), agent ${a.right}/${a.n} (${a.meaning}), notes ${c.right}/${c.n} (${c.meaning})`, ...a.wrong.map((w) => `  agent ${w}`), ...c.wrong.map((w) => `  notes ${w}`));
  }
  const table = [
    "| Deck | Formulas | Model alone: right · meaning wrong | **Agent's answer: right · look only · meaning wrong** | Notes after correction: right · meaning wrong | **Invented formulas** | **Added symbols** | Dropped symbols | Stored corrections | **Wrong corrections stored** |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows,
  ].join("\n");
  console.log(table);
  console.log("");
  console.log(report.join("\n"));
  await writeFile(join(dir, "score.txt"), `${table}\n\n${report.join("\n")}\n`);
  if (flags.has("--write")) {
    const docs = join(ROOT, "docs", "BENCHMARKS.md");
    const current = await readFile(docs, "utf-8");
    if (!current.includes("<!-- agent:start -->")) throw new Error("docs/BENCHMARKS.md has no <!-- agent:start --> marker");
    await writeFile(docs, current.replace(/<!-- agent:start -->[\s\S]*<!-- agent:end -->/, `<!-- agent:start -->\n${table}\n<!-- agent:end -->`));
    console.error(`· wrote ${docs}`);
  }
}
