# Extraction benchmark

The one measure of how well ImStudium reads documents on the student's machine, and how fast. `bun run bench` produces every number on this page from synthetic fixtures only; no university material is involved.

## In short

- **Born-digital PDFs lose no words**, with or without OCR installed. Prose comes out character-perfect; slides keep every word, in a different reading order. Installing OCR never touches pages that have a text layer.
- **Scans go from nothing to readable.** Without OCR a scanned page is an image-only marker. With on-device OCR, synthetic scans come back nearly character-perfect for prose and with almost all words for slides, at about half a second per page.
- **Display formulas come back as LaTeX, and every reading is checked.** On the clean A4 pages and on Beamer slides typeset by pdflatex, the way maths lecturers make them, all 192 formulas are found, formulas inside bullets included, and all render exactly as the source. The decision model that picks among three readings was fitted on these decks; scored on decks it wasn't fitted on, the result is the same. No reading whose meaning is wrong passes the check, and two right readings are marked for a look. Scans have no text to check against, so their formulas are marked unchecked. These are synthetic slides; real ones are harder.
- **After the agent's look, nothing was wrong and nothing invented.** This was measured with PP-FormulaNet+ L, the formula reader pinned before UniRec-0.1B. A coding agent with the `imstudium-visual` skill and the CLI, and no ground truth, looked at every formula's image on the six Beamer decks. Its answers render exactly for 140 of 144 formulas; the other 4 differ only in look, and none has a wrong meaning. It invented no formula and no symbol, and all 36 corrections it stored are right. UniRec-0.1B alone now reads all 144 exactly, so far less is left for the agent; the run has not been repeated with it.

## Results

<!-- bench:start -->
Run on AMD Ryzen 9 7950X3D 16-Core Processor · 32 threads · linux-x64 · Node 24.22.1, synthetic fixtures (seed 2026, Chromium 156.0.8078.4).

### Scorecard

What a student gets from each kind of document, without and with the on-device runtime (`imstudium setup ocr --math`). Time is per page with the runtime installed.

| Document | Pages | Without OCR | With on-device OCR and math | Time per page |
| --- | ---: | --- | --- | ---: |
| Born-digital lecture notes | 8 | 100.0 % of words · 0.0 % CER | 100.0 % of words · 0.0 % CER | 2.0 ms |
| Born-digital slides | 8 | 100.0 % of words · 18.0 % CER | 100.0 % of words · 18.0 % CER | 1.0 ms |
| Scanned lecture notes | 8 | nothing (image-only page marker) | 100.0 % of words · 0.0 % CER | 0.56 s |
| Scanned slides | 8 | nothing (image-only page marker) | 97.6 % of words · 13.8 % CER | 0.54 s |
| Display formulas on A4 pages, born-digital | 6 | not read as LaTeX | 24 of 24 formulas render exactly as the source · 24 found | 5.47 s |
| Display formulas on A4 pages, scanned | 6 | not read as LaTeX | 24 of 24 formulas render exactly as the source · 24 found | 4.96 s |
| Beamer slides, sans-serif math (hard), born-digital | 10 | not read as LaTeX | 28 of 28 formulas render exactly as the source · 28 found | 4.81 s |
| Beamer slides, sans-serif math (hard), scanned | 10 | not read as LaTeX | 28 of 28 formulas render exactly as the source · 28 found | 4.84 s |
| Beamer slides, serif math (hard), born-digital | 10 | not read as LaTeX | 28 of 28 formulas render exactly as the source · 28 found | 4.40 s |
| Beamer slides, serif math (hard), scanned | 10 | not read as LaTeX | 28 of 28 formulas render exactly as the source · 28 found | 4.46 s |
| Beamer slides 4:3, formulas in bullets, sans-serif math, born-digital | 8 | not read as LaTeX | 16 of 16 formulas render exactly as the source · 16 found | 2.69 s |
| Beamer slides 4:3, formulas in bullets, sans-serif math, scanned | 8 | not read as LaTeX | 16 of 16 formulas render exactly as the source · 16 found | 2.81 s |

Words = share of the page's words found, order ignored (higher is better). CER = character error rate against the laid-out text (lower is better). A formula renders exactly as the source when KaTeX turns both into the same MathML.

### Text, every engine

| Fixture | Pages | Engine | CER | Word recall | Time per page | Pages via OCR |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| prose · text layer | 8 | native | 0.0 % | 100.0 % | 2.5 ms | 0 |
| prose · text layer | 8 | native + OCR | 0.0 % | 100.0 % | 2.0 ms | 0 |
| prose · scan | 8 | native | 100.0 % | 0.0 % | 0.5 ms | 0 |
| prose · scan | 8 | native + OCR | 0.0 % | 100.0 % | 0.56 s | 8 |
| slides · text layer | 8 | native | 18.0 % | 100.0 % | 1.1 ms | 0 |
| slides · text layer | 8 | native + OCR | 18.0 % | 100.0 % | 1.0 ms | 0 |
| slides · scan | 8 | native | 100.0 % | 0.0 % | 0.2 ms | 0 |
| slides · scan | 8 | native + OCR | 13.8 % | 97.6 % | 0.54 s | 8 |

### Display formulas

| Fixture | Formulas | Found | Same rendering | Exact LaTeX | Similarity | Extra boxes | Time per page |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| formulas · text layer | 24 | 24 | 24 | 23 | 100.0 % | 0 | 5.47 s |
| formulas · scan | 24 | 24 | 24 | 21 | 100.0 % | 0 | 4.96 s |
| beamer-sans · text layer | 28 | 28 | 28 | 23 | 100.0 % | 0 | 4.81 s |
| beamer-sans · scan | 28 | 28 | 28 | 23 | 100.0 % | 0 | 4.84 s |
| beamer-serif · text layer | 28 | 28 | 28 | 27 | 100.0 % | 0 | 4.40 s |
| beamer-serif · scan | 28 | 28 | 28 | 27 | 100.0 % | 0 | 4.46 s |
| beamer-bullets · text layer | 16 | 16 | 16 | 9 | 100.0 % | 0 | 2.69 s |
| beamer-bullets · scan | 16 | 16 | 16 | 8 | 100.0 % | 0 | 2.81 s |

### Does the check catch the wrong ones?

Every recognised formula is checked on the machine: its LaTeX must be well-formed, and on born-digital pages its letters and digits must be the ones the PDF has in that box. A formula whose meaning is wrong and that passes this check would reach the student unflagged, so that column has to stay at 0. Look only = the same symbols in the same structure, rendered a little differently (`\left|x\right|` for `|x|`, an alignment point moved). Scans have no text to compare with, so their formulas stay unchecked and go to the agent's visual check.

| Fixture | Right, check passes | Right, flagged | Right, unchecked | Look only, check passes | **Meaning wrong, check passes** | Wrong, flagged | Wrong, unchecked |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| formulas · text layer | 24 | 0 | 0 | 0 | **0** | 0 | 0 |
| formulas · scan | 0 | 0 | 24 | 0 | **0** | 0 | 0 |
| beamer-sans · text layer | 28 | 0 | 0 | 0 | **0** | 0 | 0 |
| beamer-sans · scan | 0 | 0 | 28 | 0 | **0** | 0 | 0 |
| beamer-serif · text layer | 26 | 2 | 0 | 0 | **0** | 0 | 0 |
| beamer-serif · scan | 0 | 0 | 28 | 0 | **0** | 0 | 0 |
| beamer-bullets · text layer | 16 | 0 | 0 | 0 | **0** | 0 | 0 |
| beamer-bullets · scan | 0 | 0 | 16 | 0 | **0** | 0 | 0 |

### Every formula that did not render as its source

None: every formula rendered as its source.
<!-- bench:end -->

## How it is measured

`scripts/bench/fixtures.ts` writes three sets from a fixed seed, and Chromium (through the SDK's Playwright) typesets them, with KaTeX for the formulas:

- **prose**: A4 pages of lecture-style German text, a heading and six paragraphs each
- **slides**: 16:9 slides with bullets, a table and a box-and-arrow diagram
- **formulas**: A4 pages with four display formulas each, every one after a sentence of text

`scripts/bench/beamer.ts` adds the hard case: two **Beamer decks** typeset by pdflatex (Madrid theme, 16:9), the way most maths and CS lecturers make slides. Each has ten frames and 28 display formulas. The formulas include:
- multi-line `aligned` derivations, `cases`, a 3×3 and a general m×n matrix, a nested fraction
- `\binom`, norms, ε-δ quantifiers, `\limsup` with an n-th root, `\underbrace`, double integrals, `\pmod`, `\mathcal`
- Leibniz, Fourier and Bayes formulas

The frames mix dense stacks, coloured `block`s, two columns and `\small` type, with inline math in the bullets. One deck keeps Beamer's default sans-serif math, the other uses serif math.

A third deck, **beamer-bullets**, is the everyday lecture slide: 4:3, Beamer's default theme and sans-serif math, eight frames with 16 formulas inside the bullets. Some are displayed under an item, some follow the item's text as `$\displaystyle …$`, and some are an item on their own. It has bold vectors (`\mathbf`, `\boldsymbol`), `\min`/`\max` and machine-learning formulas, among them the three a live run on real Beamer slides read badly with the small models.

The decks are built when pdflatex with beamer is installed, and skipped otherwise.

Every set exists twice. The **text layer** variant is the PDF itself, as a born-digital lecture PDF would be. The **scan** variant is the same pages as JPEG images, grey, slightly blurred and tilted by 0.35°, one image per page with no text layer. The Beamer pages are rendered at 200 dpi first.

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
- **Why these models.** On the Beamer decks, the small layout model PP-DocLayout-S found only 17–22 of 28 formulas. It merged three formulas into one box on dense frames and missed `\underbrace`, `\pmod` and `\mathcal` entirely. The larger PP-DocLayoutV2 finds all 28 in every variant. The formula reader, UniRec-0.1B, was chosen against every current reader that runs fully on a CPU with a licence the CLI can ship; [Formula readers compared](#formula-readers-compared) has the numbers. The download is about 1 GB, once.
- **The check is what makes the rest safe.** No model reads every formula right, so each reading is checked on the machine. The LaTeX must be well-formed, and on a born-digital page its letters and digits must be the ones the PDF's own text has for the formula. A letter is missing when its centre is inside the detector's box and the LaTeX lacks it. It is invented when the LaTeX has it and no glyph of it is even partly in the formula's image, so a subscript the box cut off counts neither way. The check also catches:
  - garbage such as `\ binom n k k`, unclosed `\left` and empty fraction parts
  - characters that aren't math (`\overset{平平}`)
  - a `\boxed`, a one-sided brace or a bar over the whole formula that the model drew from a Beamer block's frame
  - an invented accent or bar: `\hat`, `\tilde`, `\bar`, `\dot` and vertical bars are compared with the PDF's own accent glyphs, so `\hat{TP}` for TP or a stray `|` is marked
  - a command name without its backslash, even glued to a letter (`Aboldsymbol`), a list bullet read into the formula, and anything KaTeX can't typeset (a text accent like `\=` in math)
  - bold that the PDF doesn't have: a letter in `\mathbf`, `\boldsymbol` or `\bm` that the PDF sets in regular type, or a bold letter read plain. The weight comes from the font's name (`CMMIB10`, `CMBX12`, `…-Bold`). pdfTeX's Type 3 bitmap fonts carry no name, and Beamer's sans-serif math is set in them, so bold is not judged there. The rendered comparison in the tables ignores weight as well.

  It cannot see a misplaced exponent, a swapped fraction, an invented operator such as `\int` or `\stackrel` (TeX sets those from its extension font, which a text layer doesn't name), or a letter dropped from just outside the box. Scans have no text to compare with, so their formulas stay unchecked. Either way, the image of every formula is saved for the agent's look.
- **Three readings and a decision model.** UniRec-0.1B makes different mistakes at different resolutions, and where it is right its readings tend to agree. Each box is read at the page's render scale and again at 3/4 and 1/2 of it (288, 216 and 144 dpi on slides). A logistic model then keeps the reading most likely to be right. Its inputs are signals the check already computes: whether the check passes, whether the letters and digits match, issues, glyphs the PDF doesn't have, how many of the other readings have the same LaTeX or the same symbols, the scale and the length. When some readings pass their check, it chooses among those only. A reading it gives less than 0.8 is marked for a look even when its check passed, and the note names the other reading. The weights were fitted on these decks, so they are scored leave-one-deck-out: fitted on three decks, scored on the fourth.

  | | Born-digital Beamer (72): right | wrong and not marked | right but marked | Scanned Beamer (72): right | A4 (48): right |
  | --- | ---: | ---: | ---: | ---: | ---: |
  | One reading at 288 dpi | 70 | 0 | 0 | 72 | 47 |
  | Three readings and the model | **72** | **0** | 2 | 72 | **48** |

  The full-scale reading gets three formulas wrong, and the check marks each: a bar over a whole integral, drawn from the frame of the block it sits in; `\sum_{n}` for `\sum_{x}`; and a matrix with unbalanced braces. A lower resolution reads each of them right, and the model takes that reading. In the first two the other two readings agreed on the wrong one, so the right reading is marked for a look with the other one named. On the A4 page the full-scale reading also sets the plain x of a mean in bold twice (`\bar{\bm{x}}`). The tables ignore weight, the bold check marks them, and the model takes the plain reading. With PP-FormulaNet+ L, the reader pinned before, the same model lifted born-digital Beamer slides from 53 to 61 of 72 and scans from 62 to 63. The cost is three formula reads per box, about three times the math time. `IMSTUDIUM_MATH_READINGS=1` reads once, to compare.
- **Look only is not wrong.** A reading that renders differently from the source but has the same symbols in the same structure counts as look only, for example `\left|x\right|` for `|x|`, `aligned` in a brace for `cases`, or an alignment point on the other side of `=`. The tables keep it apart from readings whose meaning differs.
- **The agent is the last check, and it is measured.** The agent runs were made with PP-FormulaNet+ L, the reader pinned before UniRec-0.1B. That model alone got 24 of the 144 Beamer formulas wrong in meaning, including a whole invented line on a scan and hats over every TP and FN of an accuracy formula. In the agent runs the skill's rule held: look at the image of every formula, write only what it shows, and store a correction only if it checks. The agents removed every invented box, brace, bar and line, read `y` where the model had `\gamma`, and left look-only differences alone. One agent's correct reading was refused because the check then compared only the detector's box. The agent kept the subscript rather than drop it to pass, which led to the visible-glyph rule above.
- **Formulas in bullets.** The layout model calls a formula that follows an item's text, or is an item of its own, an inline formula. Reading display formulas only, the bullets deck lost half of its 16. Inline formulas taller than 1.3 text lines or alone in their item are now read too, and 15–16 of 16 are found. Math inside a sentence is still not read as LaTeX: it stays pdf-inspector's text, with garbled sub- and superscripts (`*x<sub>i</sub>*`).
- **288 dpi stays the render scale.** PP-FormulaNet+ L read born-digital sans-serif slides worse than their scans, inventing hats and bars on crisp thin strokes, and did better on them at 144 dpi. UniRec-0.1B reads best at the full scale. On its own, the 288 dpi reading gets 70 of 72 born-digital and 72 of 72 scanned Beamer formulas right, the 216 dpi reading 70 and 71, and the 144 dpi reading 65 and 66, where one wrong reading also passes the check. `IMSTUDIUM_MATH_RENDER_SCALE` and `IMSTUDIUM_MATH_READINGS=1` repeat the comparison.
- **Not covered:** handwriting, camera photos, chemistry, and fonts other than DejaVu, KaTeX and Computer Modern (serif and sans).
- **Speed depends on the CPU.** The machine is named above the scorecard; compare runs on the same machine only.

## Formula readers compared

Before UniRec-0.1B was pinned, the current formula readers that run fully on a CPU were run on the same 191 formula crops from these decks: 71 from born-digital Beamer pages, 72 from scanned ones and 48 from the A4 pages, each cut out by PP-DocLayoutV2 as the product cuts it, every one with its source LaTeX. Right means the reading renders exactly as the source, as in the tables above. Each model ran on ONNX Runtime or PyTorch on the CPU with greedy decoding, at 2 to 4 threads, on the benchmark machine while other jobs loaded it heavily, so the times compare the models with each other, not with a laptop.

| Reader | Licence | Download | Beamer born-digital (71) | Beamer scanned (72) | A4 (48) | Time per formula | Runs under the CLI's Node runtime |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| **UniRec-0.1B, as ImStudium runs it** | Apache-2.0 | 729 MB | **69** | **72** | **47** | 1.4 s | yes, the authors' ONNX export |
| UniRec-0.1B, raw output | | | 66 | 68 | 44 | | |
| PP-FormulaNet+ L (pinned before) | Apache-2.0 | 734 MB | 53 | 62 | 48 | | yes, ONNX |
| PaddleOCR-VL-1.6 (0.9B) | Apache-2.0 | 1.9 GB | 69 | 67 | 48 | 24 s | no: a community ONNX of 1.5 needs a hand-written pipeline, the official build is GGUF for llama.cpp |
| pix2text-mfr-1.5 | MIT | 120 MB | 44 | 56 | 41 | 0.9 s | yes, ONNX |
| GLM-OCR (0.9B), first 160 crops | MIT | 2.7 GB | 43 of 51 | 52 of 61 | 42 of 48 | 31 s | community ONNX |
| TexTeller 3, first 100 crops | Apache-2.0 | 1.2 GB | 25 of 34 | 25 of 33 | 24 of 33 | 9.6 s | community ONNX |

- **UniRec-0.1B reads the most exactly at about a second per formula.** It matches PaddleOCR-VL on born-digital slides, beats it on scans, and takes about a seventeenth of its time. Its official ONNX export runs on the ONNX Runtime the CLI already ships, with about 90 lines of glue and no Python. Its raw output needs two clean-ups, which ImStudium makes: aligned lines come back as separate display formulas (`\]\[`) and are joined into one `aligned` block at their leading relation, and an appended equation number `(1)` is dropped. The three wrong readings left are all marked by the check: a bar over a whole integral from a block's frame, `\sum_{n}` for `\sum_{x}`, and a matrix with unbalanced braces. On two of them a reading at a lower resolution is right, and the decision model below takes it.
- **PaddleOCR-VL-1.6** is the strongest of the larger models. It writes `cases` as an `array` KaTeX rejects and aligned equations as centred arrays without alignment points. At 16 to 24 s per formula and 1.9 GB, with no build Node can load, it would cost more than it gains.
- **GLM-OCR and TexTeller 3** were stopped part of the way, to free the machine; the counts are on the crops they reached. GLM-OCR writes `\dots` for the slides' `\cdots` in matrices. TexTeller writes notation KaTeX can't typeset (`\mbox{\boldmath$…$}`) and typewriter digits on sans-serif slides.
- **Not run to the end:** UniMERNet base (Apache-2.0, 1.3 GB) and MinerU2.5-Pro-2605-1.2B (Apache-2.0, 2.3 GB) were stopped before their first ten crops when the machine ran out of memory. Neither has an ONNX build Node could load without a port.
- **Left out for their licence:** texify (CC BY-NC-SA 4.0, non-commercial), Surya (OpenRAIL-M, with use restrictions), MinerU2.5-2509-1.2B (AGPL-3.0).
- **Speed in the product.** Pages are read with three readings per formula box, layout included. With PP-FormulaNet+ L a Beamer page took 4.4 to 6.5 s and an A4 page 8.7 to 9.9 s; with UniRec-0.1B a Beamer page takes 2.7 to 4.8 s and an A4 page 5.0 to 5.5 s on the same machine.

Every model ran from a pinned revision with its SHA-256 recorded, on synthetic crops only.

## Agent correction

The last step is the agent's. A coding agent gets a hard deck the way a student's workspace holds it (content.md, math.json and the formula images) with the `imstudium-visual` skill and the CLI, and is asked to write down every formula for the student's notes and correct the extraction. `scripts/bench/agent-eval.ts` prepares the decks without any ground truth and scores what the agent wrote against the source LaTeX.

<!-- agent:start -->
| Deck | Formulas | Model alone: right · meaning wrong | **Agent's answer: right · look only · meaning wrong** | Notes after correction: right · meaning wrong | **Invented formulas** | **Added symbols** | Dropped symbols | Stored corrections | **Wrong corrections stored** |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| beamer-sans · text layer | 28 | 21 · 5 | **27** · 1 · **0** | 26 · 0 | **0** | **0** | 0 | 7 | **0** |
| beamer-sans · scan | 28 | 25 · 1 | **26** · 2 · **0** | 26 · 0 | **0** | **0** | 0 | 3 | **0** |
| beamer-serif · text layer | 28 | 22 · 5 | **27** · 1 · **0** | 27 · 0 | **0** | **0** | 0 | 7 | **0** |
| beamer-serif · scan | 28 | 22 · 6 | **28** · 0 · **0** | 28 · 0 | **0** | **0** | 0 | 8 | **0** |
| beamer-bullets · text layer | 16 | 10 · 6 | **16** · 0 · **0** | 16 · 0 | **0** | **0** | 0 | 8 | **0** |
| beamer-bullets · scan | 16 | 15 · 1 | **16** · 0 · **0** | 16 · 0 | **0** | **0** | 0 | 3 | **0** |
<!-- agent:end -->

Right = renders exactly as the source. Agent's answer = the formulas the agent hands the student. Notes after correction = the formula blocks of content.md once the agent's corrections are stored, which is what search and later sessions read. Invented formulas = written down but not on the slide. Added symbols = rendered symbols in a written formula that the source doesn't have. Dropped symbols = the opposite. Look only and meaning wrong are defined as in the check table above. Stored corrections = `imstudium formulas fix` calls that passed the check; wrong corrections stored = those whose meaning still differs from the slide's formula.

These runs were made with PP-FormulaNet+ L, the formula reader pinned before UniRec-0.1B, so "model alone" is that reader. With UniRec-0.1B far fewer formulas are left for the agent; the runs have not been repeated with it. Bold and other font variants (`\mathbf{w}` against `\mathsf{w}`) are not scored: the rendered comparison sees the symbol, not its weight. The agents were Claude Code subagents (Opus 5.5), one fresh agent per deck, told to work only with the deck folder, the skill and the CLI. The four decks of the first run were prepared before the check compared accents and bars. Each reported every file it read, and none read the repository, the fixtures or the ground truth. An agent run is not deterministic; rerun it after a change to the skill, the check or the models.

## Run it

```bash
imstudium setup ocr --math   # once, on the machine you measure on
bun run bench                # fixtures in .bench/ (git-ignored), results on stdout and in .bench/results.json
bun run bench -- --write     # also refresh the results on this page
bun run bench -- --no-ocr    # native text only
bun run bench -- --regen     # rebuild the fixtures
bun run bench -- --sets=beamer-sans,beamer-serif   # only these sets (no --write)
node scripts/bench/agent-eval.ts prepare /tmp/eval     # decks for an agent, no ground truth inside
node scripts/bench/agent-eval.ts score /tmp/eval --write
```

The bench runs under Node and uses the OCR runtime in `~/.local/share/imstudium/ocr`, or `IMSTUDIUM_OCR_DIR` if set. Chromium comes from Playwright: run `npx playwright install chromium` if it is missing, or point `IMSTUDIUM_BENCH_CHROMIUM` at a Chrome binary. A change to OCR, math or the PDF path runs the bench before and after, and the pull request shows both scorecards.
