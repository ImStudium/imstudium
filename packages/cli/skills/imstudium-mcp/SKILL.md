---
name: imstudium-mcp
description: |
  ImStudium MCP tools for all agent harnesses — studium overview, klausuren, course brief, find materials, sync.
  Use when working inside an MCP-enabled agent instead of terminal.
---

# imstudium mcp

MCP server: `imstudium-mcp`

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
| Refresh | `imstudium_sync` |
| Auth check | `imstudium_whoami` |

## Finding content (use YOUR search tools)

**No custom search MCP tool.** Cursor/Codex/Claude already grep and semantic-search — the harness only prepares the index.

After `studium_overview`, use `searchGuidance`:

```
rg -i "backprop" ~/Studium/SS2026/*/search/corpus.jsonl
```

Each JSONL line has `ref`, `text`, `pageImage`, `extractSlug`. Cite with `ref`, then read:

- `extracted/<extractSlug>/content.md` (## Page N)
- `extracted/<extractSlug>/pages/page-NNN.png` for slides

Or semantic-search `corpus.jsonl` / `content.md` with your harness indexer.

## Workflow

```
imstudium_whoami → studium_overview → studium_klausuren
  → grep corpus.jsonl OR studium_find_materials
  → studium_read_material → read pageImages
```

Prefer local tools before `imstudium_sync` (network + auth).

## Visual comprehension (important)

`studium_read_material` returns `content` (text) and `pageImages` (PNG paths). Slides carry diagrams, plots, and formulas that text misses — **read the `pageImages` files** with your image-reading tool before explaining slide content. Use the `page` argument to target one slide.
