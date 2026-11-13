---
name: imstudium-visual
description: |
  MANDATORY when explaining slides, PDFs, diagrams, or formulas from ImStudium materials.
  content.md prose is markdown; $$…$$ formulas and OCR text are on-device model output. Check formulas and diagrams against the original in files/.
  Use after studium_read_material or when the user asks about slide content.
allowed-tools:
  - Bash(imstudium view *)
  - Bash(imstudium extract *)
  - Bash(imstudium formulas *)
  - Bash(npx playwright *)
---

# imstudium visual comprehension

Slides are **visual**. `content.md` text misses diagrams, plots, layout and often the exact form of a formula.

## What content.md holds

Everything is extracted on the student's machine. The header line says what ran (`on-device OCR on N page(s)`, `N formula(s) as LaTeX (on-device)`).

| Source | What you get in `content.md` |
|--------|------------------------------|
| Typed PDF | pdf-inspector markdown: tables and reading order. Inline math keeps garbled sub- and superscripts (`x<sub>i</sub>`) |
| Scanned page, OCR installed (`imstudium setup ocr`) | OCR text; `_(read by OCR with low confidence — check the original)_` where it read poorly |
| Scanned page, no OCR | `_(image-only page — no text layer)_`: open the original |
| Slide that is mostly a picture (chart, screenshot), no OCR | its own title and labels, then `_(mostly an image: only the page's own text is above, the image itself is not read)_`: open the original for the picture |
| Display formulas, math installed (`imstudium setup ocr --math`) | `$$…$$` blocks after the page text, under `_Formulas on this page, read on this machine as LaTeX …_`; a note under each one that needs a look; `math.json` and `formulas/<id>.png` (each formula's image) |
| PPTX / DOCX | AnyDoc native conversion |
| `.tex` source files | LaTeX passthrough as-is |

The `$$…$$` blocks are model output. On the benchmark's synthetic Beamer slides nearly all come back exactly right, and real slides are harder. A wrong reading can draw a bar over the whole formula from a Beamer block's frame, misread an index (`\sum_{n}` for `\sum_{x}`), set a plain letter in bold or drop a bold one, or, on a scan, invent a whole line. Every reading is checked on the machine, and the note under a formula says what the check found:

| Note under the formula | Meaning |
|---|---|
| none | Well-formed, and every letter and digit is one the PDF has in that box. Positions (exponent or index, numerator or denominator) are not compared, and bold only where the PDF's font says it (not in Beamer's sans-serif math) |
| `_(formula p3-2 needs a look: …)_` | Malformed, letters, digits or bold differ from the PDF, or the model read the box differently at lower resolution: the note says which, and names the other reading |
| `_(formula p3-2 unchecked: …)_` | Scanned page or picture: nothing to compare with, only the image can tell |
| `_(formula p3-2 corrected by … from its image …)_` | An agent or the student corrected it from the image, and the correction checks |

Handwriting and math inside a sentence are not read as LaTeX; a formula alone in a bullet, or set large there (`$\displaystyle …$`), is.

**corpus.jsonl** is for finding pages by keyword, not for answering math from OCR text alone.

## Rule (all agents)

**Never invent math from markdown.** Before you explain or quote a formula, diagram, plot or table:

1. Open the source PDF/PPTX in `files/` (the page number is in `content.md` and `math.json`), OR
2. Read `pageImages` when the material is a photo copy.

Use the `$$…$$` LaTeX as a draft to check against the page, and say when the page and the LaTeX disagree. If you can't open the original, say the formula comes from on-device recognition and may be wrong.

## Formulas: look, check, correct, write down

When you write formulas down for the student (notes, a summary, exam prep) or they ask you to fix the extraction:

1. **List them.** `imstudium formulas list <file> --json` gives each formula's `id`, `page`, `latex`, `verdict.check`, the absolute path of its image (`crop`), and `otherReadings`: what the model read in the same box at lower resolutions where that differs. Another reading is a hint where to look, not an answer: only the image decides. `--needs-look` lists only the ones whose check didn't pass. `<file>` is the extracted folder, its `content.md`, the original under `files/`, or a name fragment.
2. **Look at the image of every formula you write down**, those whose check is `differs` or `unchecked` first. A `match` proves the letters and digits, not where they sit: exponents, indices, limits, numerator and denominator, brackets and line breaks need your eyes. Open its `crop` image with your image reader and compare it symbol by symbol with `latex`.
3. **Transcribe only what the image shows.**
   - Don't complete, simplify, normalise or "improve" the math. Keep the lecturer's names, indices and notation. A typo on the slide stays a typo; say that it looks like one.
   - Don't fill in from what the formula usually is (a textbook version, the previous slide, memory).
   - If a symbol is unreadable, don't guess: write `\text{?}` in its place, tell the student which part you can't read, and don't store that reading.
4. **Check your reading.** `imstudium formulas check <file> <id> --latex '<LaTeX>'`. On a born-digital page the check compares every letter and digit with what the PDF has in that box:
   - `match`: no letter or digit added or dropped. It does not prove positions, so you still compare with the image.
   - `differs`: the PDF disagrees, and the output says which letters or digits. Look at the image again. Never change a symbol just to make the check pass without seeing it there.
   - `unchecked`: a scan, so only your look at the image vouches for it. Say so when you hand it over.
5. **Store a correction when the student asked for corrected notes:** `imstudium formulas fix <file> <id> --latex '<LaTeX>' --by <your harness>`. It is refused unless it checks. content.md then shows the correction with a note saying who made it and from what, and `imstudium index` refreshes search.
6. **Write it down** with its citation (`Vorlesung 3 · p.12`). Use the corrected or checked LaTeX. If a formula is still `unchecked` or `differs` and you couldn't look at its image, say so next to it instead of presenting it as certain.

## Fast paths by harness

| Harness | What to do |
|---------|------------|
| **Cursor / Claude / Codex / Windsurf / OpenCode with Read/vision** | `Read` the PDF page from `files/`, or each `pageImages` file |
| **Playwright CLI** | `imstudium view --course "Analysis" --file "vorlesung 3"` → open printed `viewerFileUrl` |
| **Browser MCP** (cursor-ide-browser) | `browser_navigate` to `viewerFileUrl`, `browser_take_screenshot` per slide |
| **MCP only** | `studium_read_material` → follow `requiredAction` + `methods` in JSON response |
| **Terminal** | `imstudium view --dir ~/Studium/.../extracted/foo-pdf` |

## MCP response fields

```json
{
  "requiredAction": "Open the original file for figures; pageImages lists copied photos only",
  "pageImages": ["/abs/path/pages/page-1.png", "..."],
  "viewerHtml": "/abs/path/viewer.html",
  "viewerFileUrl": "file:///abs/path/viewer.html",
  "methods": [{ "id": "read_image", "action": "..." }, { "id": "playwright", "action": "..." }]
}
```

Follow `requiredAction` literally.

## Speed

- `studium_read_material` reuses cached extraction (manifest mtime): fast on repeat
- `imstudium view` only writes `viewer.html` (near instant): no re-render unless the file changed
- Bulk `imstudium extract` does NOT auto-open a browser: agents opt in per file
- OCR takes about half a second per scanned page, formulas about half a second per formula page; `--no-ocr` / `--no-math` skip them for one run

## Playwright one-liner

```bash
imstudium view --course "Analysis" --file "folien" --json
# → open viewerFileUrl in Playwright, screenshot each .slide img
```

## When pageImages is empty

Expected for PDFs and PPTX: page images are not rendered. Open `files/` for the original. Photos still copy into `pages/`.
