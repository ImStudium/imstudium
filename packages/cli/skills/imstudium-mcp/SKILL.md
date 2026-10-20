---
name: imstudium-mcp
description: |
  ImStudium MCP tools for all agent harnesses — studium overview, klausuren, course brief, find materials, sync.
  Use when working inside an MCP-enabled agent instead of terminal.
---

# imstudium mcp

MCP server: `@imstudium/mcp`

## Install

```bash
imstudium setup mcp
```

## Tool selection

| Intent | Tool |
|--------|------|
| Course map + search guidance | `studium_overview` (read `searchGuidance`) |
| Exams | `studium_klausuren` |
| One course | `studium_course_brief` |
| Find PDFs by filename | `studium_find_materials` |
| **Read/see slide content** | `studium_read_material` |
| Refresh | `imstudium_sync_dry_run` (preview); the sync itself runs in a terminal: `imstudium sync` |
| Auth check | `imstudium_whoami` |

## Finding content (use YOUR search tools)

**No custom search MCP tool.** Cursor/Codex/Claude already grep and semantic-search — the harness only prepares the index.

After `studium_overview`, use `searchGuidance`:

```
rg -i "backprop" ~/Studium/SS2026/*/search/corpus.jsonl
```

Each JSONL line has `ref`, `text`, `extractSlug`, `page`. Cite with `ref`, then read:

- `extracted/<extractSlug>/content.md` (## Page N)
- the original in `files/` for diagrams and formulas (markdown is not LaTeX)

Faster: the `imstudium` tool with `["search", "<words>"]` returns ranked hits with citations.

Or semantic-search `corpus.jsonl` / `content.md` with your harness indexer.

## Workflow

```
imstudium_whoami → studium_overview → studium_klausuren
  → grep corpus.jsonl OR studium_find_materials
  → studium_read_material → open the original for figures
```

Prefer local tools; a sync (network + auth) is a terminal step: `imstudium sync`.

## Visual comprehension (important)

`studium_read_material` returns `content` (markdown per page). `pageImages` is only filled for copied photos.

Image-only PDF pages are marked `_(image-only page — no text layer)_`. Slides carry diagrams, plots and formulas the text misses — open the original PDF in `files/` with your file/vision tools before explaining them. Use the `page` argument to target one slide.

`studium_overview` → `searchGuidance.extractionLimits` for the full list.
