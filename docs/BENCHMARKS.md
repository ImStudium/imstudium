# Extraction benchmark

The one measure of how well ImStudium reads documents on the student's machine, and how fast. `bun run bench` produces every number on this page from synthetic fixtures only; no university material is involved.

## In short

- **Born-digital PDFs lose no words**, with or without OCR installed. Prose comes out character-perfect; slides keep every word, in a different reading order. Installing OCR never touches pages that have a text layer.
- **Scans go from nothing to readable.** Without OCR a scanned page is an image-only marker. With on-device OCR, synthetic scans come back nearly character-perfect for prose and with almost all words for slides, at about half a second per page.
- **Display formulas come back as LaTeX, mostly right.** Most render exactly as the source; the rest are listed below, and some of them change the meaning. That is why content.md always says to check formulas against the original.

## Results

<!-- bench:start -->
Run on AMD Ryzen 9 7950X3D 16-Core Processor · 32 threads · linux-x64 · Node 24.22.1, synthetic fixtures (seed 2026, Chromium 156.0.8078.4).

### Scorecard

What a student gets from each kind of document, without and with the on-device runtime (`imstudium setup ocr --math`). Time is per page with the runtime installed.

| Document | Pages | Without OCR | With on-device OCR and math | Time per page |
| --- | ---: | --- | --- | ---: |
| Born-digital lecture notes | 8 | 100.0 % of words · 0.0 % CER | 100.0 % of words · 0.0 % CER | 2.3 ms |
| Born-digital slides | 8 | 100.0 % of words · 18.0 % CER | 100.0 % of words · 18.0 % CER | 1.1 ms |
| Scanned lecture notes | 8 | nothing (image-only page marker) | 100.0 % of words · 0.0 % CER | 0.73 s |
| Scanned slides | 8 | nothing (image-only page marker) | 97.6 % of words · 13.8 % CER | 0.49 s |
| Born-digital display formulas | 6 | not read as LaTeX | 21 of 24 formulas render exactly as the source · 23 found | 0.57 s |
| Scanned display formulas | 6 | not read as LaTeX | 23 of 24 formulas render exactly as the source · 24 found | 0.43 s |

Words = share of the page's words found, order ignored (higher is better). CER = character error rate against the laid-out text (lower is better). A formula renders exactly as the source when KaTeX turns both into the same MathML.

### Text, every engine

| Fixture | Pages | Engine | CER | Word recall | Time per page | Pages via OCR |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| prose · text layer | 8 | native | 0.0 % | 100.0 % | 1.8 ms | 0 |
| prose · text layer | 8 | native + OCR | 0.0 % | 100.0 % | 2.3 ms | 0 |
| prose · scan | 8 | native | 100.0 % | 0.0 % | 0.5 ms | 0 |
| prose · scan | 8 | native + OCR | 0.0 % | 100.0 % | 0.73 s | 8 |
| slides · text layer | 8 | native | 18.0 % | 100.0 % | 1.1 ms | 0 |
| slides · text layer | 8 | native + OCR | 18.0 % | 100.0 % | 1.1 ms | 0 |
| slides · scan | 8 | native | 100.0 % | 0.0 % | 0.1 ms | 0 |
| slides · scan | 8 | native + OCR | 13.8 % | 97.6 % | 0.49 s | 8 |

### Display formulas

| Fixture | Formulas | Found | Same rendering | Exact LaTeX | Similarity | Extra boxes | Time per page |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| formulas · text layer | 24 | 23 | 21 | 16 | 94.4 % | 1 | 0.57 s |
| formulas · scan | 24 | 24 | 23 | 18 | 99.8 % | 0 | 0.43 s |

### Every formula that did not render as its source

Some only change the look (`\overline` for `\bar`, a dropped thin space); others change the meaning. Rendered similarity says how far apart they are, not which kind they are.

| Fixture | Page | Source | Read as | Rendered similarity |
| --- | ---: | --- | --- | ---: |
| formulas · text layer | 1 | `E[X] = \sum_{i=1}^{n} x_i \, p(x_i)` | `E[X]=\sum_{i=1}^{n}x_{i}\ (x_{i})` | 97.3 % |
| formulas · text layer | 3 | `\sum_{k=0}^{n} \binom{n}{k} = 2^n` | `\sum_{k=0}^{n}\ binom n k k=2^{n}` | 67.9 % |
| formulas · text layer | 5 | `\|x - x_0\| < \delta \Rightarrow \|f(x) - f(x_0)\| < \varepsilon` | `\left lvert x-x_{0}\right\rvert<\delta\Rightarrow\left\lvert f\big(x\big)-f\big(x_{0}\big)\right\rvert<\left\{\begin{array}{l l}{\vdots{}}\\ \end{array}\right` (too far off to count as found) | 45.8 % |
| formulas · scan | 3 | `P(A \mid B) = \frac{P(B \mid A)\,P(A)}{P(B)}` | `P(A\mid B)=\frac{P(B\mid A)P\big A(A)}{P(B)}` | 96.3 % |
<!-- bench:end -->

## How it is measured

`scripts/bench/fixtures.ts` writes three sets from a fixed seed, and Chromium (through the SDK's Playwright) typesets them, with KaTeX for the formulas:

- **prose**: A4 pages of lecture-style German text, a heading and six paragraphs each
- **slides**: 16:9 slides with bullets, a table and a box-and-arrow diagram
- **formulas**: A4 pages with four display formulas each, every one after a sentence of text

Every set exists twice. The **text layer** variant is Chromium's own PDF, as a born-digital lecture PDF would be. The **scan** variant is the same pages as JPEG screenshots, grey, slightly blurred and tilted by 0.35°, one image per page with no text layer.

The ground truth is the text Chromium laid out, read back from the page, and the LaTeX source of every formula. Text is extracted with `convertLocalDocument`, the function `sync --extract` uses, once without and once with OCR. Formulas go through `recognizeMath`.

- **CER** (character error rate): edit distance between the extracted and the true plain text, divided by the length of the truth. Markdown syntax and page markers are stripped first. 0 % is perfect. Reading order counts: the same words in another order raise the CER.
- **Word recall**: the share of the true words found, order ignored.
- **Found**: a true formula matched to a recognised one at 50 % rendered similarity or more.
- **Same rendering**: both formulas, rendered with KaTeX to MathML, give identical tokens. `\lim` and `\operatorname*{lim}`, or `pmatrix` and `\left(\begin{matrix}`, count as the same.
- **Exact LaTeX**: identical source after normalising spacing, `\left`/`\right` and script braces.
- **Similarity**: mean rendered similarity over all true formulas, missed ones counting 0.
- **Extra boxes**: regions the layout model took for a formula where there is none.
- **Time per page**: wall time of the whole call divided by the pages, after a warm-up so model loading is not counted.

## Reading the results

- **The slide CER comes from layout, not from missing text.** pdf-inspector reads a slide with a table next to a diagram as one wide table, so cells and diagram labels interleave differently from the DOM order. Word recall shows nothing is lost.
- **Real scans are harder than these.** They have skew, shadows, handwriting, stamps and copies of copies. Expect lower numbers and check the original when content.md says `read by OCR with low confidence`.
- **Text-layer and scanned formulas differ only in how the page reached the model**, so the few misses move between the two sets from run to run of the fixtures.
- **Inline math is not read as LaTeX.** The layout model (PP-DocLayout-S) only finds display formulas. Math inside a sentence stays pdf-inspector's text, with garbled sub- and superscripts (`*x<sub>i</sub>*`).
- **Not covered:** handwriting, camera photos, dense derivations, multi-line `align` blocks, chemistry, and fonts other than DejaVu and KaTeX. For comparison, upstream reports PP-FormulaNet-S at 0.869 BLEU on simple printed and 0.807 on complex printed formulas (UniMER-Test).
- **Speed depends on the CPU.** The machine is named above the scorecard; compare runs on the same machine only.

## Run it

```bash
imstudium setup ocr --math   # once, on the machine you measure on
bun run bench                # fixtures in .bench/ (git-ignored), results on stdout and in .bench/results.json
bun run bench -- --write     # also refresh the results on this page
bun run bench -- --no-ocr    # native text only
bun run bench -- --regen     # rebuild the fixtures
```

The bench runs under Node and uses the OCR runtime in `~/.local/share/imstudium/ocr`, or `IMSTUDIUM_OCR_DIR` if set. Chromium comes from Playwright: run `npx playwright install chromium` if it is missing, or point `IMSTUDIUM_BENCH_CHROMIUM` at a Chrome binary. A change to OCR, math or the PDF path runs the bench before and after, and the pull request shows both scorecards.
