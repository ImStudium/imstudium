/**
 * `bun run bench`: extraction quality and speed on synthetic fixtures only.
 *
 *   node scripts/bench/run.ts [--regen] [--write] [--no-ocr]
 *
 * --regen   rebuild the fixtures (.bench/fixtures) even when present
 * --write   put the results (scorecard, details, formula misses) into docs/BENCHMARKS.md
 * --no-ocr  native text only
 * --sets=a,b  only these fixture sets (e.g. --sets=beamer-sans,beamer-serif), not with --write
 *
 * Runs under Node (the OCR runtime is pointed at through process.env, which
 * Bun does not pass to native code). Uses the built SDK (packages/sdk/dist)
 * and the OCR runtime installed by `imstudium setup ocr [--math]`
 * (IMSTUDIUM_OCR_DIR to point elsewhere).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { availableParallelism, cpus, platform, arch } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateFixtures, type Truth } from "./fixtures.ts";
import { cer, plainText, sameSymbols, scoreFormulas, wordRecall } from "./metrics.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, ".bench");
const FIX = join(OUT, "fixtures");
const args = new Set(process.argv.slice(2));
const only = [...args].find((a) => a.startsWith("--sets="))?.slice("--sets=".length).split(",").filter(Boolean);
if (only && args.has("--write")) {
  console.error("bench: --write needs every set; drop --sets");
  process.exit(2);
}
const log = (s: string) => console.error(`· ${s}`);

if (typeof (process.versions as Record<string, string | undefined>).bun === "string") {
  console.error("bench: run under Node (bun run bench does that), not bun directly");
  process.exit(2);
}
const sdkEntry = join(ROOT, "packages", "sdk", "dist", "index.js");
if (!existsSync(sdkEntry)) {
  console.error("bench: build first (bun run build)");
  process.exit(2);
}
const sdk = (await import(sdkEntry)) as typeof import("../../packages/sdk/src/index.ts");

let truth: Truth;
if (args.has("--regen") || !existsSync(join(FIX, "truth.json"))) {
  const math0 = sdk.mathRuntimeStatus();
  truth = await generateFixtures(ROOT, FIX, { imagesToPdf: sdk.imagesToPdf, ...(math0.ready ? { renderPdfPages: sdk.renderPdfPages, encodePng: sdk.encodePng } : {}) }, log);
} else {
  truth = JSON.parse(await readFile(join(FIX, "truth.json"), "utf-8")) as Truth;
}

const ocr = sdk.ocrRuntimeStatus();
const math = sdk.mathRuntimeStatus();
const useOcr = ocr.ready && !args.has("--no-ocr");
const useMath = math.ready && !args.has("--no-ocr");
if (!useOcr) log(`OCR not used (${args.has("--no-ocr") ? "--no-ocr" : ocr.reason}): imstudium setup ocr`);
if (!useMath) log(`math not used (${args.has("--no-ocr") ? "--no-ocr" : math.reason}): imstudium setup ocr --math`);

interface TextRow {
  set: string;
  variant: "text layer" | "scan";
  engine: "native" | "native + OCR";
  pages: number;
  cer: number;
  wordRecall: number;
  msPerPage: number;
  ocrPages: number;
}
interface MathRow {
  set: string;
  variant: "text layer" | "scan";
  formulas: number;
  found: number;
  exactLatex: number;
  sameRendering: number;
  similarity: number;
  extra: number;
  secondsPerPage: number;
  misses: Array<{ page: number; truth: string; predicted: string | null; similarity: number; closest?: { latex: string; similarity: number }; check?: string; lookOnly?: boolean }>;
  /**
   * Recognised formulas by the SDK's own check, split by whether they are right (render as the source),
   * differ only in their look (same symbols in the same structure), or differ in meaning.
   */
  checks: { rightMatch: number; rightFlagged: number; rightUnchecked: number; lookMatch: number; wrongMatch: number; wrongFlagged: number; wrongUnchecked: number };
}

const textRows: TextRow[] = [];
const mathRows: MathRow[] = [];

async function convert(bytes: Uint8Array, name: string, withOcr: boolean) {
  const t = performance.now();
  const r = await sdk.convertLocalDocument(bytes, name, { ocr: withOcr });
  const ms = performance.now() - t;
  if (!r.ok) throw r.error;
  return { r, ms };
}

// Warm up both paths so model loading is not counted as page time.
const warm = new Uint8Array(await readFile(join(FIX, "prose-scan.pdf")));
await convert(warm, "warm.pdf", false);
if (useOcr) await convert(warm, "warm.pdf", true);

for (const set of truth.sets) {
  if (only && !only.includes(set.name)) continue;
  for (const variant of ["text layer", "scan"] as const) {
    const file = join(FIX, `${set.name}${variant === "scan" ? "-scan" : ""}.pdf`);
    const bytes = new Uint8Array(await readFile(file));
    if (set.kind !== "formulas") {
      for (const engine of useOcr ? (["native", "native + OCR"] as const) : (["native"] as const)) {
        log(`${set.name} · ${variant} · ${engine}`);
        const { r, ms } = await convert(bytes, file, engine !== "native");
        let edits = 0;
        let chars = 0;
        let recall = 0;
        set.pages.forEach((p, i) => {
          const want = plainText(p.text);
          const got = plainText(r.pages[i]?.markdown ?? "");
          edits += cer(got, want) * want.length;
          chars += want.length;
          recall += wordRecall(got, want);
        });
        textRows.push({
          set: set.name,
          variant,
          engine,
          pages: set.pages.length,
          cer: edits / chars,
          wordRecall: recall / set.pages.length,
          msPerPage: ms / set.pages.length,
          ocrPages: r.pages.filter((p) => p.ocr).length,
        });
      }
    } else if (useMath) {
      log(`${set.name} · ${variant} · math`);
      const t = performance.now();
      const m = await sdk.recognizeMath(bytes);
      const ms = performance.now() - t;
      let found = 0;
      let exactLatex = 0;
      let sameRendering = 0;
      let sim = 0;
      let extra = 0;
      let n = 0;
      const misses: MathRow["misses"] = [];
      const checks = { rightMatch: 0, rightFlagged: 0, rightUnchecked: 0, lookMatch: 0, wrongMatch: 0, wrongFlagged: 0, wrongUnchecked: 0 };
      const tally = (right: boolean, check: string, lookOnly = false) => {
        if (!right && lookOnly && check === "match") return void checks.lookMatch++;
        const key = `${right ? "right" : "wrong"}${check === "match" ? "Match" : check === "differs" ? "Flagged" : "Unchecked"}` as keyof typeof checks;
        checks[key]++;
      };
      set.pages.forEach((p, i) => {
        const onPage = m.formulas.filter((f) => f.page === i);
        const s = scoreFormulas(onPage.map((f) => f.latex), p.formulas);
        for (const pair of s.pairs) {
          const check = pair.index !== undefined ? onPage[pair.index]!.check : undefined;
          const lookOnly = pair.predicted !== null && pair.similarity < 1 && sameSymbols(pair.predicted, pair.truth);
          if (check) tally(pair.similarity === 1, check, lookOnly);
          if (pair.similarity < 1) misses.push({ page: i + 1, ...pair, ...(check ? { check } : {}), lookOnly });
        }
        for (const k of s.unmatched) tally(false, onPage[k]!.check);
        found += s.found;
        exactLatex += s.exactLatex;
        sameRendering += s.sameRendering;
        sim += s.similarity * p.formulas.length;
        extra += s.extra;
        n += p.formulas.length;
      });
      mathRows.push({ set: set.name, variant, formulas: n, found, exactLatex, sameRendering, similarity: sim / n, extra, secondsPerPage: ms / 1000 / set.pages.length, misses, checks });
      await writeFile(join(OUT, `math-${set.name}-${variant === "scan" ? "scan" : "text"}.json`), JSON.stringify(m.formulas, null, 2));
    }
  }
}

const pct = (x: number) => `${(x * 100).toFixed(1)} %`;
const time = (ms: number) => (ms >= 100 ? `${(ms / 1000).toFixed(2)} s` : `${ms < 10 ? ms.toFixed(1) : ms.toFixed(0)} ms`);
const code = (latex: string) => `\`${latex.replace(/\|/g, "\\|")}\``;
const machine = `${cpus()[0]?.model.trim() ?? "?"} · ${availableParallelism()} threads · ${platform()}-${arch()} · Node ${process.versions.node}`;
const row = (set: string, variant: string, engine: TextRow["engine"]) => textRows.find((r) => r.set === set && r.variant === variant && r.engine === engine);
const reads = (r: TextRow | undefined) => (!r ? "not measured" : r.wordRecall === 0 ? "nothing (image-only page marker)" : `${pct(r.wordRecall)} of words · ${pct(r.cer)} CER`);
const FORMULA_SETS: Record<string, string> = {
  formulas: "Display formulas on A4 pages",
  "beamer-sans": "Beamer slides, sans-serif math (hard)",
  "beamer-serif": "Beamer slides, serif math (hard)",
  "beamer-bullets": "Beamer slides 4:3, formulas in bullets, sans-serif math",
};
const CASES = [
  { label: "Born-digital lecture notes", set: "prose", variant: "text layer" },
  { label: "Born-digital slides", set: "slides", variant: "text layer" },
  { label: "Scanned lecture notes", set: "prose", variant: "scan" },
  { label: "Scanned slides", set: "slides", variant: "scan" },
] as const;

const lines = [
  `Run on ${machine}, synthetic fixtures (seed ${truth.seed}, Chromium ${truth.chromium})${useOcr ? "" : ", without the OCR runtime"}${useMath || !truth.sets.some((x) => x.kind === "formulas") ? "" : ", without the math runtime"}.`,
  "",
  "### Scorecard",
  "",
  "What a student gets from each kind of document, without and with the on-device runtime (`imstudium setup ocr --math`). Time is per page with the runtime installed.",
  "",
  "| Document | Pages | Without OCR | With on-device OCR and math | Time per page |",
  "| --- | ---: | --- | --- | ---: |",
  ...CASES.map((c) => {
    const native = row(c.set, c.variant, "native");
    const withOcr = row(c.set, c.variant, "native + OCR") ?? native;
    return `| ${c.label} | ${native?.pages ?? "?"} | ${reads(native)} | ${useOcr ? reads(withOcr) : "not measured"} | ${withOcr ? time(withOcr.msPerPage) : "?"} |`;
  }),
  ...mathRows.map((m) => {
    const label = `${FORMULA_SETS[m.set] ?? m.set}, ${m.variant === "scan" ? "scanned" : "born-digital"}`;
    const pages = truth.sets.find((x) => x.name === m.set)?.pages.length ?? "?";
    return `| ${label} | ${pages} | not read as LaTeX | ${m.sameRendering} of ${m.formulas} formulas render exactly as the source · ${m.found} found | ${time(m.secondsPerPage * 1000)} |`;
  }),
  "",
  "Words = share of the page's words found, order ignored (higher is better). CER = character error rate against the laid-out text (lower is better). A formula renders exactly as the source when KaTeX turns both into the same MathML.",
  "",
  "### Text, every engine",
  "",
  "| Fixture | Pages | Engine | CER | Word recall | Time per page | Pages via OCR |",
  "| --- | ---: | --- | ---: | ---: | ---: | ---: |",
  ...textRows.map((r) => `| ${r.set} · ${r.variant} | ${r.pages} | ${r.engine} | ${pct(r.cer)} | ${pct(r.wordRecall)} | ${time(r.msPerPage)} | ${r.ocrPages} |`),
];
if (mathRows.length) {
  lines.push(
    "",
    "### Display formulas",
    "",
    "| Fixture | Formulas | Found | Same rendering | Exact LaTeX | Similarity | Extra boxes | Time per page |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...mathRows.map((r) => `| ${r.set} · ${r.variant} | ${r.formulas} | ${r.found} | ${r.sameRendering} | ${r.exactLatex} | ${pct(r.similarity)} | ${r.extra} | ${time(r.secondsPerPage * 1000)} |`),
    "",
    "### Does the check catch the wrong ones?",
    "",
    "Every recognised formula is checked on the machine: its LaTeX must be well-formed, and on born-digital pages its letters and digits must be the ones the PDF has in that box. A formula whose meaning is wrong and that passes this check would reach the student unflagged, so that column has to stay at 0. Look only = the same symbols in the same structure, rendered a little differently (`\\left|x\\right|` for `|x|`, an alignment point moved). Scans have no text to compare with, so their formulas stay unchecked and go to the agent's visual check.",
    "",
    "| Fixture | Right, check passes | Right, flagged | Right, unchecked | Look only, check passes | **Meaning wrong, check passes** | Wrong, flagged | Wrong, unchecked |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...mathRows.map((r) => `| ${r.set} · ${r.variant} | ${r.checks.rightMatch} | ${r.checks.rightFlagged} | ${r.checks.rightUnchecked} | ${r.checks.lookMatch} | **${r.checks.wrongMatch}** | ${r.checks.wrongFlagged} | ${r.checks.wrongUnchecked} |`),
    "",
    "### Every formula that did not render as its source",
    "",
    "Look only = the same symbols in the same structure; meaning = a symbol, script, fraction or box differs. Rendered similarity says how far apart they are.",
    "",
    "| Fixture | Page | Source | Read as | Rendered similarity | Differs in | Check |",
    "| --- | ---: | --- | --- | ---: | --- | --- |",
    ...mathRows.flatMap((r) => r.misses.map((x) => `| ${r.set} · ${r.variant} | ${x.page} | ${code(x.truth)} | ${x.predicted !== null ? code(x.predicted) : x.closest ? `${code(x.closest.latex)} (too far off to count as found)` : "(not found)"} | ${pct(x.predicted !== null ? x.similarity : (x.closest?.similarity ?? 0))} | ${x.lookOnly ? "look only" : "meaning"} | ${x.check ?? "–"} |`)),
  );
}
const table = lines.join("\n");
console.log(table);
await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, "results.json"), `${JSON.stringify({ machine, truth: { seed: truth.seed, chromium: truth.chromium }, ocr: useOcr, math: useMath, textRows, mathRows }, null, 2)}\n`);

if (args.has("--write")) {
  const docs = join(ROOT, "docs", "BENCHMARKS.md");
  const current = await readFile(docs, "utf-8");
  const next = current.replace(/<!-- bench:start -->[\s\S]*<!-- bench:end -->/, `<!-- bench:start -->\n${table}\n<!-- bench:end -->`);
  await writeFile(docs, next);
  log(`wrote ${docs}`);
}
