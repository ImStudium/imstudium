---
name: imstudium-klausur-prep
description: |
  Workflow — produce a Klausur prep brief for one course: exam date, days remaining, priority files, 60-min study block.
  Use when user says "help me study for", "Klausur prep", "exam plan for [course]".
---

# Workflow: Klausur prep

## Inputs

- Course name (substring match)
- Optional: days until exam

## Steps

1. `studium_klausuren` — confirm exam date (confirmed vs unconfirmed)
2. `studium_course_brief` — course context + `COURSE.md`
3. `studium_find_materials` with queries: `klausur`, `übung`, `script`, `folien`
4. `imstudium search "<topic>"` (or `studium_read_material`) on the top files — read the page markdown, open the original PDF for diagrams and formulas, then summarize key concepts per slide
5. If no files: `imstudium_sync_dry_run` then `imstudium_sync`

## Deliverable

```markdown
## [Course] — Klausur prep
- **Exam:** [date] ([N] days)
- **Status:** confirmed / verify manually
- **Priority files:** (top 3 paths)
- **60-min block:** [single focused task with done state]
```
