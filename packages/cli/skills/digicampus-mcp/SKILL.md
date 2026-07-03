---
name: digicampus-mcp
description: |
  DigiCampus MCP tools for Cursor/Claude — studium overview, klausuren, course brief, find materials, sync.
  Use when working inside an MCP-enabled agent instead of terminal.
---

# digicampus mcp

MCP server: `digicampus-mcp`

## Install

```bash
digicampus setup mcp
```

## Tool selection

| Intent | Tool |
|--------|------|
| Course map | `studium_overview` |
| Exams | `studium_klausuren` |
| One course | `studium_course_brief` |
| Find PDFs/slides | `studium_find_materials` |
| **Read/see slide content** | `studium_read_material` |
| Refresh | `digicampus_sync` |
| Auth check | `digicampus_whoami` |

## Workflow

```
digicampus_whoami → studium_overview → studium_klausuren
  → studium_find_materials → studium_read_material
```

Prefer local tools before `digicampus_sync` (network + auth).

## Visual comprehension (important)

`studium_read_material` returns `content` (text) and `pageImages` (PNG paths). Slides carry diagrams, plots, and formulas that text misses — **read the `pageImages` files** with your image-reading tool before explaining slide content. Use the `page` argument to target one slide.
