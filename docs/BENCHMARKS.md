# Extraction benchmark

The one measure of how well ImStudium reads documents on the student's machine, and how fast. `bun run bench` produces every number on this page from synthetic fixtures only; no university material is involved.

## In short

- **Born-digital PDFs lose no words**, with or without OCR installed. Prose comes out character-perfect; slides keep every word, in a different reading order. Installing OCR never touches pages that have a text layer.
- **Scans go from nothing to readable.** Without OCR a scanned page is an image-only marker. With on-device OCR, synthetic scans come back nearly character-perfect for prose and with almost all words for slides, at about half a second per page.
- **Display formulas come back as LaTeX, and every reading is checked.** On clean pages all 24 render exactly as the source. On Beamer slides typeset by pdflatex, the way maths lecturers make them, 143 of 144 are found, formulas inside bullets included, and 115 render exactly: about four in five. On born-digital pages the check marks all but one of the readings whose meaning is wrong. That one is `\arg\max_c` with the `c` under "arg max" instead of "max". Scans have no text to check against, so their formulas are marked unchecked.
- **After the agent's look, nothing is wrong and nothing is invented.** A coding agent with the `imstudium-visual` skill and the CLI, and no ground truth, looked at every formula's image on the six Beamer decks. Its answers render exactly for 140 of 144 formulas; the other 4 differ only in look, and none has a wrong meaning. It invented no formula and no symbol, and all 36 corrections it stored are right.

## Results

<!-- bench:start -->
Run on AMD Ryzen 9 7950X3D 16-Core Processor · 32 threads · linux-x64 · Node 24.22.1, synthetic fixtures (seed 2026, Chromium 156.0.8078.4).

### Scorecard

What a student gets from each kind of document, without and with the on-device runtime (`imstudium setup ocr --math`). Time is per page with the runtime installed.

| Document | Pages | Without OCR | With on-device OCR and math | Time per page |
| --- | ---: | --- | --- | ---: |
| Born-digital lecture notes | 8 | 100.0 % of words · 0.0 % CER | 100.0 % of words · 0.0 % CER | 2.1 ms |
| Born-digital slides | 8 | 100.0 % of words · 18.0 % CER | 100.0 % of words · 18.0 % CER | 1.3 ms |
| Scanned lecture notes | 8 | nothing (image-only page marker) | 100.0 % of words · 0.0 % CER | 0.52 s |
| Scanned slides | 8 | nothing (image-only page marker) | 97.6 % of words · 13.8 % CER | 0.48 s |
| Display formulas on A4 pages, born-digital | 6 | not read as LaTeX | 24 of 24 formulas render exactly as the source · 24 found | 9.92 s |
| Display formulas on A4 pages, scanned | 6 | not read as LaTeX | 24 of 24 formulas render exactly as the source · 24 found | 8.73 s |
| Beamer slides, sans-serif math (hard), born-digital | 10 | not read as LaTeX | 21 of 28 formulas render exactly as the source · 28 found | 6.51 s |
| Beamer slides, sans-serif math (hard), scanned | 10 | not read as LaTeX | 25 of 28 formulas render exactly as the source · 28 found | 6.21 s |
| Beamer slides, serif math (hard), born-digital | 10 | not read as LaTeX | 22 of 28 formulas render exactly as the source · 28 found | 6.36 s |
| Beamer slides, serif math (hard), scanned | 10 | not read as LaTeX | 22 of 28 formulas render exactly as the source · 28 found | 6.45 s |
| Beamer slides 4:3, formulas in bullets, sans-serif math, born-digital | 8 | not read as LaTeX | 10 of 16 formulas render exactly as the source · 15 found | 4.67 s |
| Beamer slides 4:3, formulas in bullets, sans-serif math, scanned | 8 | not read as LaTeX | 15 of 16 formulas render exactly as the source · 16 found | 4.37 s |

Words = share of the page's words found, order ignored (higher is better). CER = character error rate against the laid-out text (lower is better). A formula renders exactly as the source when KaTeX turns both into the same MathML.

### Text, every engine

| Fixture | Pages | Engine | CER | Word recall | Time per page | Pages via OCR |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| prose · text layer | 8 | native | 0.0 % | 100.0 % | 1.9 ms | 0 |
| prose · text layer | 8 | native + OCR | 0.0 % | 100.0 % | 2.1 ms | 0 |
| prose · scan | 8 | native | 100.0 % | 0.0 % | 0.3 ms | 0 |
| prose · scan | 8 | native + OCR | 0.0 % | 100.0 % | 0.52 s | 8 |
| slides · text layer | 8 | native | 18.0 % | 100.0 % | 1.1 ms | 0 |
| slides · text layer | 8 | native + OCR | 18.0 % | 100.0 % | 1.3 ms | 0 |
| slides · scan | 8 | native | 100.0 % | 0.0 % | 0.1 ms | 0 |
| slides · scan | 8 | native + OCR | 13.8 % | 97.6 % | 0.48 s | 8 |

### Display formulas

| Fixture | Formulas | Found | Same rendering | Exact LaTeX | Similarity | Extra boxes | Time per page |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| formulas · text layer | 24 | 24 | 24 | 13 | 100.0 % | 0 | 9.92 s |
| formulas · scan | 24 | 24 | 24 | 23 | 100.0 % | 0 | 8.73 s |
| beamer-sans · text layer | 28 | 28 | 21 | 17 | 97.5 % | 0 | 6.51 s |
| beamer-sans · scan | 28 | 28 | 25 | 24 | 98.9 % | 0 | 6.21 s |
| beamer-serif · text layer | 28 | 28 | 22 | 15 | 98.4 % | 0 | 6.36 s |
| beamer-serif · scan | 28 | 28 | 22 | 19 | 96.5 % | 0 | 6.45 s |
| beamer-bullets · text layer | 16 | 15 | 10 | 7 | 88.7 % | 1 | 4.67 s |
| beamer-bullets · scan | 16 | 16 | 15 | 14 | 99.5 % | 0 | 4.37 s |

### Does the check catch the wrong ones?

Every recognised formula is checked on the machine: its LaTeX must be well-formed, and on born-digital pages its letters and digits must be the ones the PDF has in that box. A formula whose meaning is wrong and that passes this check would reach the student unflagged, so that column has to stay at 0. Look only = the same symbols in the same structure, rendered a little differently (`\left|x\right|` for `|x|`, an alignment point moved). Scans have no text to compare with, so their formulas stay unchecked and go to the agent's visual check.

| Fixture | Right, check passes | Right, flagged | Right, unchecked | Look only, check passes | **Meaning wrong, check passes** | Wrong, flagged | Wrong, unchecked |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| formulas · text layer | 24 | 0 | 0 | 0 | **0** | 0 | 0 |
| formulas · scan | 0 | 0 | 24 | 0 | **0** | 0 | 0 |
| beamer-sans · text layer | 21 | 0 | 0 | 2 | **0** | 5 | 0 |
| beamer-sans · scan | 0 | 0 | 25 | 0 | **0** | 0 | 3 |
| beamer-serif · text layer | 22 | 0 | 0 | 1 | **0** | 5 | 0 |
| beamer-serif · scan | 0 | 0 | 22 | 0 | **0** | 3 | 3 |
| beamer-bullets · text layer | 10 | 0 | 0 | 0 | **1** | 5 | 0 |
| beamer-bullets · scan | 0 | 0 | 15 | 0 | **0** | 0 | 1 |

### Every formula that did not render as its source

Look only = the same symbols in the same structure; meaning = a symbol, script, fraction or box differs. Rendered similarity says how far apart they are.

| Fixture | Page | Source | Read as | Rendered similarity | Differs in | Check |
| --- | ---: | --- | --- | ---: | --- | --- |
| beamer-sans · text layer | 1 | `\|x\| = \begin{cases} x & x \ge 0 \\ -x & x < 0 \end{cases}` | `\left\|x\right\|=\begin{cases}x&x\geq0\\ -x&x<0\end{cases}` | 91.1 % | look only | match |
| beamer-sans · text layer | 3 | `\int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi}` | `{\boxed{\int_{-\infty}^{\infty}\mathsf{e}^{-x^{2}}d x={\sqrt{\pi}}}}` | 93.3 % | meaning | differs |
| beamer-sans · text layer | 3 | `\\|x\\|_2 = \sqrt{\sum_{i=1}^{n} x_i^2}` | `\boxed{\\|x\\|_{2}={\sqrt{\sum_{i=1}^{n}x_{i}^{2}}}}` | 93.1 % | meaning | differs |
| beamer-sans · text layer | 7 | `T(n) = \begin{cases} 1 & n = 1 \\ 2\,T(n/2) + n & n > 1 \end{cases}` | `\boxed{T(n)=\begin{cases}{1}&{n=1}\\ {2\;T(n/2)+n}&{n>1}\end{cases}}` | 96.6 % | meaning | differs |
| beamer-sans · text layer | 9 | `\neg (A \land B) \equiv \neg A \lor \neg B` | `\left\{\begin{array}{l l}{\neg(A\land B)\equiv\neg A\lor\neg B}\end{array}\right.` | 71.0 % | meaning | differs |
| beamer-sans · text layer | 10 | `\det A = \sum_{\sigma \in S_n} \operatorname{sgn}(\sigma) \prod_{i=1}^{n} a_{i,\sigma(i)}` | `\operatorname*{det}A=\sum_{\sigma\in S_{n}}^{n}\operatorname{sgn}(\sigma)\prod_{i=1}^{n}a_{i,\sigma(i)}` | 94.7 % | meaning | differs |
| beamer-sans · text layer | 10 | `\begin{aligned} \operatorname{Var}(X) &= E[(X - \mu)^2] \\ &= E[X^2] - 2\mu E[X] + \mu^2 \\ &= E[X^2] - \mu^2 \end{aligned}` | `\begin{aligned}\mathsf{Var}(X)=&E[(X-\mu)^2]\\=&E[X^2]-2\mu E[X]+\mu^2\\=&E[X^2]-\mu^2\end{aligned}` | 89.0 % | look only | match |
| beamer-sans · scan | 2 | `x = \frac{1}{1 + \frac{1}{1 + \frac{1}{y}}}` | `x=\frac{1}{1+\frac{1}{1+\frac{1}{\gamma}}}` | 95.5 % | meaning | unchecked |
| beamer-sans · scan | 3 | `\\|x\\|_2 = \sqrt{\sum_{i=1}^{n} x_i^2}` | `\left\\|x\right\\|_2=\sqrt{\sum_{i=1}^{n}x_i^2}` | 83.9 % | look only | unchecked |
| beamer-sans · scan | 10 | `\begin{aligned} \operatorname{Var}(X) &= E[(X - \mu)^2] \\ &= E[X^2] - 2\mu E[X] + \mu^2 \\ &= E[X^2] - \mu^2 \end{aligned}` | `\begin{aligned}\operatorname{Var}(X)=&E[(X-\mu)^2]\\=&E[X^2]-2\mu E[X]+\mu^2\\=&E[X^2]-\mu^2\end{aligned}` | 89.0 % | look only | unchecked |
| beamer-serif · text layer | 1 | `\begin{aligned} (a+b)^2 &= (a+b)(a+b) \\ &= a^2 + 2ab + b^2 \end{aligned}` | `\begin{aligned}\overset{平平}{(a+b)^{2}}&=(a+b)(a+b)\\&=a^{2}+2ab+b^{2}\end{aligned}` | 90.1 % | meaning | differs |
| beamer-serif · text layer | 3 | `\int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi}` | `\boxed{\int_{-\infty}^{\infty}e^{-x^{2}}d x={\sqrt{\pi}}}` | 93.3 % | meaning | differs |
| beamer-serif · text layer | 3 | `\\|x\\|_2 = \sqrt{\sum_{i=1}^{n} x_i^2}` | `\boxed{\\|x\\|_{2}={\sqrt{\sum_{i=1}^{n}x_{i}^{2}}}}` | 93.1 % | meaning | differs |
| beamer-serif · text layer | 7 | `T(n) = \begin{cases} 1 & n = 1 \\ 2\,T(n/2) + n & n > 1 \end{cases}` | `T(n)=\left\{\begin{aligned}&1&n=1\\ &2T(n/2)+n&n>1\end{aligned}\right.` | 93.4 % | look only | match |
| beamer-serif · text layer | 7 | `P(B_j \mid A) = \frac{P(A \mid B_j)\,P(B_j)}{\sum_{i=1}^{m} P(A \mid B_i)\,P(B_i)}` | `\frac{P(B_{j}\mid A)=\frac{P(A\mid B_{j})P(B_{j})}{\sum_{i=1}^{m}P(A\mid B_{i})P(B_{i})}}{}` | 97.6 % | meaning | differs |
| beamer-serif · text layer | 9 | `\neg (A \land B) \equiv \neg A \lor \neg B` | `\left\{\neg(A\land B)\equiv\neg A\lor\neg B\right.` | 88.0 % | meaning | differs |
| beamer-serif · scan | 1 | `\begin{aligned} (a+b)^2 &= (a+b)(a+b) \\ &= a^2 + 2ab + b^2 \end{aligned}` | `\begin{aligned}(a+b)^{2}&=a^{2}\\(a+b)^{2}&=(a+b)(a+b)^{2}\\&=a^{2}+2ab+b^{2}\end{aligned}` | 70.9 % | meaning | unchecked |
| beamer-serif · scan | 3 | `\int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi}` | `\boxed{\int_{-\infty}^{\infty}e^{-x^2}dx=\sqrt{\pi}}` | 93.3 % | meaning | differs |
| beamer-serif · scan | 3 | `\\|x\\|_2 = \sqrt{\sum_{i=1}^{n} x_i^2}` | `\frac{\\|x\\|_2=\sqrt{\sum_{i=1}^{n}x_i^2}}{}` | 93.1 % | meaning | differs |
| beamer-serif · scan | 4 | `\forall \varepsilon > 0 \; \exists \delta > 0 : \|x - x_0\| < \delta \Rightarrow \|f(x) - f(x_0)\| < \varepsilon` | `\forall\varepsilon>0\;\exists\delta>0:\|x-x_{0}\|<\delta\Rightarrow\|\bar{f}(x)-\bar{f}(x_{0})\|<\varepsilon` | 87.8 % | meaning | unchecked |
| beamer-serif · scan | 5 | `\prod_{i=1}^{n} (1 + x_i) \ge 1 + \sum_{i=1}^{n} x_i` | `\begin{aligned}{}&{{}\overline{{(-1)}}}\\ {}&{{}\prod_{i=1}^{n}(1+x_{i})\geq1+\sum_{i=1}^{n}x_{i}.}\\ \end{aligned}` | 61.0 % | meaning | unchecked |
| beamer-serif · scan | 7 | `T(n) = \begin{cases} 1 & n = 1 \\ 2\,T(n/2) + n & n > 1 \end{cases}` | `\boxed{T(n)=\begin{cases}1&n=1\\2T(n/2)+n&n>1\end{cases}}` | 96.6 % | meaning | differs |
| beamer-bullets · text layer | 2 | `\tilde{x}=\frac{x-\bar{x}}{\sigma}` | `\tilde{x}=\frac{x-\bar{x}\|}{\sigma}` | 95.7 % | meaning | differs |
| beamer-bullets · text layer | 3 | `\\|x\\|_1=\sum_{i=1}^{n}\|x_i\|` | `\\|x\\|_{1}=\sum_{j=1}^{h}\|x_{j}\|` | 88.5 % | meaning | differs |
| beamer-bullets · text layer | 4 | `\hat{y}=\arg\max_{c}\sum_{i\in N_k(x)}[y_i=c]` | `\hat{y}=\underset{c}{\arg\operatorname*{max}}\sum_{i\in\mathcal{N}_{k}(x)}[y_{i}=c]` | 92.6 % | meaning | match |
| beamer-bullets · text layer | 5 | `\boldsymbol{\mu}=\frac{1}{n}\sum_{i=1}^{n}\boldsymbol{x}_i` | `\boldsymbol{\mu}=\frac{1}{n}\sum_{j=1}^{n}\mathsf{x}_{j}` | 91.3 % | meaning | differs |
| beamer-bullets · text layer | 6 | `\sigma(z)=\frac{1}{1+e^{-z}}` | `\begin{aligned}&\bullet\cdots\bullet\cdots\bullet\cdots\bullet\\&\sigma(z)=\frac{1}{1+e^{-z}}\\&\cdots\end{aligned}` (too far off to count as found) | 36.2 % | meaning | – |
| beamer-bullets · text layer | 8 | `\mathrm{Acc}=\frac{TP+TN}{TP+TN+FP+FN}` | `\mathrm{Acc}=\frac{\hat{TP}+\hat{TN}}{\hat{TP}+\hat{TN}+\hat{FP}+\hat{FN}}` | 51.6 % | meaning | differs |
| beamer-bullets · scan | 5 | `\boldsymbol{\mu}=\frac{1}{n}\sum_{i=1}^{n}\boldsymbol{x}_i` | `\mu=\frac{1}{n}\sum_{j=1}^{n}\mathsf{x}_{j}` | 91.3 % | meaning | unchecked |
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
- **Why these models.** On the Beamer decks, the small pair (PP-DocLayout-S with PP-FormulaNet+ S) found only 17–22 of 28 formulas and read 11–14 exactly. It merged three formulas into one box on dense frames and missed `\underbrace`, `\pmod` and `\mathcal` entirely. The larger layout model, PP-DocLayoutV2, finds all 28 in every variant. Of the formula readers, plus-M reads 17–20 exactly at about 2 s per page, and plus-L reads 21–25 at about 7 s per page, so plus-L is pinned. The download is about 1.1 GB, once.
- **The check is what makes the rest safe.** No model reads every formula right, so each reading is checked on the machine. The LaTeX must be well-formed, and on a born-digital page its letters and digits must be the ones the PDF's own text has for the formula. A letter is missing when its centre is inside the detector's box and the LaTeX lacks it. It is invented when the LaTeX has it and no glyph of it is even partly in the formula's image, so a subscript the box cut off counts neither way. The check also catches:
  - garbage such as `\ binom n k k`, unclosed `\left` and empty fraction parts
  - characters that aren't math (`\overset{平平}`)
  - a `\boxed` or a one-sided brace the model drew from a Beamer block's frame
  - an invented accent or bar: `\hat`, `\tilde`, `\bar`, `\dot` and vertical bars are compared with the PDF's own accent glyphs, so `\hat{TP}` for TP or a stray `|` is marked
  - a command name without its backslash, even glued to a letter (`Aboldsymbol`), a list bullet read into the formula, and anything KaTeX can't typeset (a text accent like `\=` in math)

  It cannot see a misplaced exponent, a swapped fraction, an invented operator such as `\int` or `\stackrel` (TeX sets those from its extension font, which a text layer doesn't name), or a letter dropped from just outside the box. Scans have no text to compare with, so their formulas stay unchecked. Either way, the image of every formula is saved for the agent's look.
- **Three readings and a decision model.** PP-FormulaNet+ L makes different mistakes at different resolutions, and where it is right its readings tend to agree. Each box is read at the page's render scale and again at 3/4 and 1/2 of it (288, 216 and 144 dpi on slides). A logistic model then keeps the reading most likely to be right. Its inputs are signals the check already computes: whether the check passes, whether the letters and digits match, issues, glyphs the PDF doesn't have, how many of the other readings have the same LaTeX or the same symbols, the scale and the length. A reading it gives less than 0.8 is marked for a look even when its check passed, and the note names the other reading. The weights were fitted on these decks, so they are scored leave-one-deck-out: fitted on three decks, scored on the fourth.

  | | Born-digital Beamer (72): right | wrong and not marked | Scanned Beamer (72): right | wrong and not marked | A4 (48): right |
  | --- | ---: | ---: | ---: | ---: | ---: |
  | One reading | 53 | 1 | 62 | 5 | 48 |
  | Three readings and the model | **61** | **0** | **63** | **3** | 48 |
  | Best of the three readings | 61 | | 64 | | 48 |

  On born-digital slides it finds every right reading there is among the three, and the one wrong reading that passed the check (`\arg\max_c` with the `c` under "arg max") is now marked. It marks 5 right readings there for a look, and 3 on scans. "Not marked" on a scan means not marked as needing a look: every scanned formula still says `unchecked`. The cost is three formula reads per box, about three times the math time. Reading at 144 dpi alone gets more of the sans-serif decks right but invents more elsewhere (see the point on sans-serif slides below). The model takes such a reading only where the other readings and the check back it. `IMSTUDIUM_MATH_READINGS=1` reads once, to compare.
- **Look only is not wrong.** A reading that renders differently from the source but has the same symbols in the same structure counts as look only, for example `\left|x\right|` for `|x|`, `aligned` in a brace for `cases`, or an alignment point on the other side of `=`. The tables keep it apart from readings whose meaning differs.
- **The agent is the last check, and it is measured.** The model alone gets 24 of the 144 Beamer formulas wrong in meaning, including a whole invented line on a scan and hats over every TP and FN of an accuracy formula. In the agent runs the skill's rule held: look at the image of every formula, write only what it shows, and store a correction only if it checks. The agents removed every invented box, brace, bar and line, read `y` where the model had `\gamma`, and left look-only differences alone. One agent's correct reading was refused because the check then compared only the detector's box. The agent kept the subscript rather than drop it to pass, which led to the visible-glyph rule above.
- **Formulas in bullets.** The layout model calls a formula that follows an item's text, or is an item of its own, an inline formula. Reading display formulas only, the bullets deck lost half of its 16. Inline formulas taller than 1.3 text lines or alone in their item are now read too, and 15–16 of 16 are found. Math inside a sentence is still not read as LaTeX: it stays pdf-inspector's text, with garbled sub- and superscripts (`*x<sub>i</sub>*`).
- **Born-digital sans-serif slides read worse than their scans.** On the bullets deck the scan reads 15 of 16 exactly and the PDF itself 10: on crisp renders of thin sans-serif strokes the model invents hats and bars. A sharper render does not help. At 432 dpi the sans and bullets decks read 20 and 12 exactly, against 21 and 10 at the default 288 dpi. At 144 dpi they read 23 and 14, but the serif deck and the clean A4 page each lose one and gain new inventions that pass the check (`\int_{\neg(A\wedge B)}`, `y_{\mid}^{\mid}`), so 288 dpi stays. `IMSTUDIUM_MATH_RENDER_SCALE` repeats the comparison.
- **Not covered:** handwriting, camera photos, chemistry, and fonts other than DejaVu, KaTeX and Computer Modern (serif and sans). For comparison, upstream reports PP-FormulaNet+ L at 92.2 BLEU on PaddleOCR's English formula set.
- **Speed depends on the CPU.** The machine is named above the scorecard; compare runs on the same machine only.

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

Bold and other font variants (`\mathbf{w}` against `\mathsf{w}`) are not scored: the rendered comparison sees the symbol, not its weight. The agents were Claude Code subagents (Opus 5.5), one fresh agent per deck, told to work only with the deck folder, the skill and the CLI. The four decks of the first run were prepared before the check compared accents and bars. Each reported every file it read, and none read the repository, the fixtures or the ground truth. An agent run is not deterministic; rerun it after a change to the skill, the check or the models.

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
