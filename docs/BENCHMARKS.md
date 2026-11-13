# Extraction benchmark

`bun run bench` measures how well ImStudium's local pipeline reads documents, and how fast. It uses synthetic fixtures only. The generator (`scripts/bench/fixtures.ts`) writes lecture-style German prose, 16:9 slides with bullets, a table and a box-and-arrow diagram, and pages with display formulas, all from a fixed seed. Chromium (through the SDK's Playwright) typesets them, with KaTeX for the formulas. Every set exists twice:

- **text layer**: Chromium's own PDF, as a born-digital lecture PDF would be
- **scan**: the same pages as JPEG screenshots, grey, slightly blurred and tilted by 0.35°, wrapped one image per page with no text layer

The ground truth is the text Chromium laid out, read back from the page, plus the LaTeX source of every formula. No university material is involved.

```bash
imstudium setup ocr --math   # once, on the machine you measure on
bun run bench                # fixtures in .bench/ (git-ignored), table on stdout
bun run bench -- --write     # also refresh the table below
bun run bench -- --no-ocr    # native text only
```

The bench runs under Node and uses the OCR runtime in `~/.local/share/imstudium/ocr`, or `IMSTUDIUM_OCR_DIR` if set. Chromium comes from Playwright: run `npx playwright install chromium` if it is missing, or point `IMSTUDIUM_BENCH_CHROMIUM` at a Chrome binary.

## Results

<!-- bench:start -->
Synthetic fixtures (seed 2026, Chromium 156.0.8078.4), AMD Ryzen 9 7950X3D 16-Core Processor · 32 threads · linux-x64 · Node 24.22.1. CER = character error rate against the laid-out text (lower is better); word recall = share of the page's words found, order ignored.

| Fixture | Pages | Engine | CER | Word recall | Pages/s | Pages via OCR |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| prose · text layer | 8 | native | 0.0 % | 100.0 % | 541.0 | 0 |
| prose · text layer | 8 | native + OCR | 0.0 % | 100.0 % | 632.4 | 0 |
| prose · scan | 8 | native | 100.0 % | 0.0 % | 3675.2 | 0 |
| prose · scan | 8 | native + OCR | 0.0 % | 100.0 % | 1.8 | 8 |
| slides · text layer | 8 | native | 18.0 % | 100.0 % | 982.7 | 0 |
| slides · text layer | 8 | native + OCR | 18.0 % | 100.0 % | 882.6 | 0 |
| slides · scan | 8 | native | 100.0 % | 0.0 % | 7716.3 | 0 |
| slides · scan | 8 | native + OCR | 13.8 % | 97.6 % | 2.2 | 8 |

Display formulas (PP-DocLayout-S finds them, PP-FormulaNet+ S reads them). Both sides are rendered with KaTeX to MathML and compared token by token, so different spellings of the same formula count as equal. Found = matched to a true formula at ≥ 50 % rendered similarity; same rendering = identical MathML; exact LaTeX = identical source after normalising spacing, `\left`/`\right` and script braces; similarity = mean rendered similarity over all true formulas (missed ones count 0).

| Fixture | Formulas | Found | Same rendering | Exact LaTeX | Similarity | Extra boxes | s/page |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| formulas · text layer | 24 | 23 | 21 | 16 | 94.4 % | 1 | 0.52 |
| formulas · scan | 24 | 24 | 23 | 18 | 99.8 % | 0 | 0.43 |
<!-- bench:end -->

## Reading the numbers

- **Born-digital text is exact.** pdf-inspector's text layer gives 0 % CER on prose. Installing OCR changes nothing on these pages: only pages that native extraction flags as having no usable text layer go to the OCR engine.
- **The slide CER comes from layout, not from missing text.** Every word is found (100 % word recall). The CER of about 18 % is reading order: pdf-inspector reads a slide with a table next to a diagram as one wide table, so cells and diagram labels interleave differently from the DOM order.
- **Scans are where OCR earns its place.** Without OCR, a scanned page is an image-only marker (100 % CER). With on-device OCR, synthetic prose scans come back almost character-perfect and slide scans keep about 98 % of their words. Real scans are harder than these, with skew, shadows, handwriting, stamps and photocopies of photocopies. Expect lower numbers on them and check the original when content.md says `read by OCR with low confidence`.
- **Speed.** Native extraction runs at hundreds of pages per second. OCR costs about half a second per scanned page on this CPU, and the 173-page deck from the first laptop prototype took 46 s on an Apple-silicon CPU. Formula pages add about 0.4–0.6 s each: render, layout pass, then one model call per formula batch.
- **Math is good on clean display formulas, not perfect.** On these 24 formulas, 21 of the text-layer and 23 of the scanned ones render exactly as the source. The text-layer and scan sets differ only in how the page was rendered for the model, and the few misses move between them. They fall into two kinds. Some only change the look: `\overline` for `\bar`, `\operatorname*{lim}` for `\lim`, an `\left(\begin{matrix}` for `pmatrix`, a dropped thin space. Those are counted as the same rendering. Others change the content. In this run `\binom{n}{k}` came back as `\ binom n k k`, a factor `p` went missing in `x_i p(x_i)`, and absolute-value bars turned into `\left\lvert … \right\rvert` with an invented `\left\{\begin{array}…` tail. A wrong exponent or a missed minus sign changes meaning, so content.md always says to check the original, and math.json keeps each formula's page and box for that.
- **Inline math is not read as LaTeX.** The small layout model only finds display formulas. Math inside a sentence stays pdf-inspector's native text, which garbles sub- and superscripts (`∑ *n* *E*[*X*] = *x<sub>i</sub>*`). The larger PP-DocLayoutV3 (130 MB) also finds inline formulas, but it is not pinned here.
- **What the fixtures don't cover.** Handwriting, real camera photos, very dense formula derivations, multi-line `align` blocks, chemistry, and fonts other than DejaVu and KaTeX. Published numbers for PP-FormulaNet+ S are 88.7 BLEU on PaddleOCR's English formula set. Upstream reports PP-FormulaNet-S at 0.869 BLEU on simple printed and 0.807 on complex printed formulas (UniMER-Test), so expect lower numbers on long derivations.
