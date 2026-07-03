---
name: digicampus-studium
description: |
  Read the Studium workspace — courses, file counts, schedule context from studium.json.
  Use after sync or when user asks "what courses am I in", "semester overview", "my Studium".
---

# digicampus studium

Local semester map at `~/Studium/studium.json` (or `DIGICAMPUS_WORKSPACE`).

## Read first (no network)

```bash
digicampus --json studium
```

Or MCP: `studium_overview`

## Output includes

- Course list with slugs and file counts
- `nextDeadlines` — upcoming exams
- Schedule entries per course

## Refresh only when stale

```bash
digicampus sync --quiet
```
