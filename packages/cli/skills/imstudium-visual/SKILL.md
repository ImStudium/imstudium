---
name: imstudium-visual
description: |
  MANDATORY when explaining slides, PDFs, diagrams, or formulas from ImStudium materials.
  Markdown is not LaTeX — open the original file in files/ for formulas and diagrams.
  Use after studium_read_material or when the user asks about slide content.
allowed-tools:
  - Bash(imstudium view *)
  - Bash(imstudium extract *)
  - Bash(npx playwright *)
---

# imstudium visual comprehension

Slides are **visual**. `content.md` text misses diagrams, plots, formulas, tables, and layout.

## Extraction limits (know this)

ImStudium does **not** produce LaTeX `$...$` in markdown. Local Firecrawl stack:

| Source | What you get in `content.md` |
|--------|------------------------------|
| Typed PDF | pdf-inspector markdown — tables/reading order; still not LaTeX |
| Scanned / handwritten | `_(image-only page — no text layer)_` — open the original |
| PPTX / DOCX | AnyDoc native conversion |
| `.tex` source files | LaTeX passthrough as-is |

**corpus.jsonl** is for finding pages by keyword — not for answering math from OCR text alone.

For any formula, diagram, plot, or table: **open the original** under `files/` (or `pageImages` if a photo was copied).

## Rule (all agents)

**Never invent math from markdown.** Before answering formulas/diagrams:

1. Open the source PDF/PPTX in `files/`, OR
2. Read `pageImages` when the material is a photo copy

## Fast paths by harness

| Harness | What to do |
|---------|------------|
| **Cursor / Claude / Codex / Windsurf / OpenCode with Read/vision** | `Read` each `pageImages` file |
| **Playwright CLI** | `imstudium view --course "Analysis" --file "vorlesung 3"` → open printed `viewerFileUrl` |
| **Browser MCP** (cursor-ide-browser) | `browser_navigate` to `viewerFileUrl`, `browser_take_screenshot` per slide |
| **MCP only** | `studium_read_material` → follow `requiredAction` + `methods` in JSON response |
| **Terminal** | `imstudium view --dir ~/Studium/.../extracted/foo-pdf` |

## MCP response fields

```json
{
  "requiredAction": "MANDATORY: Visually inspect all pageImages...",
  "pageImages": ["/abs/path/pages/page-1.png", "..."],
  "viewerHtml": "/abs/path/viewer.html",
  "viewerFileUrl": "file:///abs/path/viewer.html",
  "methods": [{ "id": "read_image", "action": "..." }, { "id": "playwright", "action": "..." }]
}
```

Follow `requiredAction` literally.

## Speed

- `studium_read_material` reuses cached extraction (manifest mtime) — fast on repeat
- `imstudium view` only writes `viewer.html` (~instant) — no re-render unless file changed
- Bulk `imstudium extract` does NOT auto-open browser — agents opt in per file

## Playwright one-liner

```bash
imstudium view --course "Analysis" --file "folien" --json
# → open viewerFileUrl in Playwright, screenshot each .slide img
```

## When pageImages is empty

Expected for PDFs/PPTX — the pipeline is markdown-only. Open `files/` for the original. Photos still copy into `pages/`.
