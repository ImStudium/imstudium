/**
 * `bun run bench`: extraction quality and speed on synthetic fixtures only.
 *
 *   node scripts/bench/run.ts [--regen] [--write] [--no-ocr]
 *
 * --regen   rebuild the fixtures (.bench/fixtures) even when present
 * --write   put the results table into docs/BENCHMARKS.md
 * --no-ocr  native text only
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
import { cer, plainText, scoreFormulas, wordRecall } from "./metrics.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, ".bench");
const FIX = join(OUT, "fixtures");
const args = new Set(process.argv.slice(2));
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
  truth = await generateFixtures(ROOT, FIX, sdk.imagesToPdf, log);
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
  pagesPerSecond: number;
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
          pagesPerSecond: set.pages.length / (ms / 1000),
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
      set.pages.forEach((p, i) => {
        const s = scoreFormulas(m.formulas.filter((f) => f.page === i).map((f) => f.latex), p.formulas);
        found += s.found;
        exactLatex += s.exactLatex;
        sameRendering += s.sameRendering;
        sim += s.similarity * p.formulas.length;
        extra += s.extra;
        n += p.formulas.length;
      });
      mathRows.push({ set: set.name, variant, formulas: n, found, exactLatex, sameRendering, similarity: sim / n, extra, secondsPerPage: ms / 1000 / set.pages.length });
      await writeFile(join(OUT, `math-${variant === "scan" ? "scan" : "text"}.json`), JSON.stringify(m.formulas, null, 2));
    }
  }
}

const pct = (x: number) => `${(x * 100).toFixed(1)} %`;
const machine = `${cpus()[0]?.model.trim() ?? "?"} · ${availableParallelism()} threads · ${platform()}-${arch()} · Node ${process.versions.node}`;
const lines = [
  `Synthetic fixtures (seed ${truth.seed}, Chromium ${truth.chromium}), ${machine}. CER = character error rate against the laid-out text (lower is better); word recall = share of the page's words found, order ignored.`,
  "",
  "| Fixture | Pages | Engine | CER | Word recall | Pages/s | Pages via OCR |",
  "| --- | ---: | --- | ---: | ---: | ---: | ---: |",
  ...textRows.map((r) => `| ${r.set} · ${r.variant} | ${r.pages} | ${r.engine} | ${pct(r.cer)} | ${pct(r.wordRecall)} | ${r.pagesPerSecond.toFixed(1)} | ${r.ocrPages} |`),
];
if (mathRows.length) {
  lines.push(
    "",
    "Display formulas (PP-DocLayout-S finds them, PP-FormulaNet+ S reads them). Both sides are rendered with KaTeX to MathML and compared token by token, so different spellings of the same formula count as equal. Found = matched to a true formula at ≥ 50 % rendered similarity; same rendering = identical MathML; exact LaTeX = identical source after normalising spacing, `\\left`/`\\right` and script braces; similarity = mean rendered similarity over all true formulas (missed ones count 0).",
    "",
    "| Fixture | Formulas | Found | Same rendering | Exact LaTeX | Similarity | Extra boxes | s/page |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...mathRows.map((r) => `| ${r.set} · ${r.variant} | ${r.formulas} | ${r.found} | ${r.sameRendering} | ${r.exactLatex} | ${pct(r.similarity)} | ${r.extra} | ${r.secondsPerPage.toFixed(2)} |`),
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
