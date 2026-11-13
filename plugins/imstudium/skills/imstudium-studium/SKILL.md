---
name: imstudium-studium
description: |
  Read the Studium workspace — courses, file counts, schedule context from studium.json.
  Use after sync or when user asks "what courses am I in", "semester overview", "my Studium".
---

# imstudium studium

Local semester map at `~/Studium/studium.json` (or `IMSTUDIUM_WORKSPACE`).

**Default:** current calendar semester only (e.g. `SS2026/`), not all past enrollments.

## Read first (no network)

```bash
imstudium --json studium
```

Or MCP: `studium_overview`

## Output includes

- Course list with slugs and file counts (current semester by default)
- `semesters`, `semesterSlug` — active Stud.IP semester
- `nextDeadlines` — upcoming exams
- Schedule entries per course

## Refresh only when stale

```bash
imstudium sync --quiet
```
