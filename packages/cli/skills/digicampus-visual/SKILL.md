---
name: digicampus-visual
description: |
  MANDATORY when explaining slides, PDFs, diagrams, or formulas from DigiCampus materials.
  Text extraction is incomplete — you MUST read page PNGs or open viewer.html in Playwright/browser before answering.
  Use after studium_read_material, digicampus view, or when user asks about slide content.
allowed-tools:
  - Bash(digicampus view *)
  - Bash(digicampus extract *)
  - Bash(npx playwright *)
---

# digicampus visual comprehension

Slides are **visual**. `content.md` text misses diagrams, plots, formulas, tables, and layout.

## Rule (all agents)

**Never summarize slide content from text alone.** Before answering:

1. Read **every** path in `pageImages`, OR
2. Open `viewerFileUrl` (`file://.../viewer.html`) in Playwright / browser MCP and inspect each slide

## Fast paths by harness

| Harness | What to do |
|---------|------------|
| **Cursor / Claude / Codex with Read/vision** | `Read` each `pageImages` file |
| **Playwright CLI** | `digicampus view --course "Analysis" --file "vorlesung 3"` → open printed `viewerFileUrl` |
| **Browser MCP** (cursor-ide-browser) | `browser_navigate` to `viewerFileUrl`, `browser_take_screenshot` per slide |
| **MCP only** | `studium_read_material` → follow `requiredAction` + `methods` in JSON response |
| **Terminal** | `digicampus view --dir ~/Studium/.../extracted/foo-pdf` |

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
- `digicampus view` only writes `viewer.html` (~instant) — no re-render unless file changed
- Bulk `digicampus extract` does NOT auto-open browser — agents opt in per file

## Playwright one-liner

```bash
digicampus view --course "Analysis" --file "folien" --json
# → open viewerFileUrl in Playwright, screenshot each .slide img
```

## When pageImages is empty

Tell user: `digicampus doctor` then `digicampus extract --course "..."`. Poppler renders PDF slides; LibreOffice renders PPTX.
