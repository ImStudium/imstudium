---
name: imstudium-klausuren
description: |
  Klausur and exam timeline with days-remaining. Use when user asks about exams, Prüfungen, deadlines, "when is my Klausur".
---

# imstudium klausuren

Exam planning from `klausuren.md` / `studium.json`.

## Read timeline

```bash
imstudium --json klausuren
```

Or MCP: `studium_klausuren`

## Confirmed vs unconfirmed

| Source | Trust |
|--------|-------|
| `event` (course calendar) | **Confirmed** — schedule around these |
| `achievement`, `miscellaneous` | **Unconfirmed** — ask student to verify |

## Planning output

For each exam in the next 14 days:

1. Date + `daysRemaining`
2. Course title
3. Location if known
4. Top materials via `studium_find_materials`
