---
name: imstudium-visual
description: |
  MANDATORY when explaining slides, PDFs, diagrams, or formulas from ImStudium materials.
  content.md prose is markdown; $$…$$ formulas and OCR text are on-device model output. Check formulas and diagrams against the original in files/.
  Use after studium_read_material or when the user asks about slide content.
allowed-tools:
  - Bash(imstudium view *)
  - Bash(imstudium extract *)
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
| Display formulas, math installed (`imstudium setup ocr --math`) | `$$…$$` blocks after the page text, under `_Formulas on this page, read on this machine as LaTeX …_`, plus `math.json` (page and box of each) |
| PPTX / DOCX | AnyDoc native conversion |
| `.tex` source files | LaTeX passthrough as-is |

The `$$…$$` blocks are model output. On clean typeset formulas about nine in ten come back exactly right; the rest can drop a factor, misread `\binom`, or invent brackets. Handwriting and inline math are not read as LaTeX.

**corpus.jsonl** is for finding pages by keyword, not for answering math from OCR text alone.

## Rule (all agents)

**Never invent math from markdown.** Before you explain or quote a formula, diagram, plot or table:

1. Open the source PDF/PPTX in `files/` (the page number is in `content.md` and `math.json`), OR
2. Read `pageImages` when the material is a photo copy.

Use the `$$…$$` LaTeX as a draft to check against the page, and say when the page and the LaTeX disagree. If you can't open the original, say the formula comes from on-device recognition and may be wrong.

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
