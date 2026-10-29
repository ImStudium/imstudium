---
name: imstudium-sync
description: |
  Sync course files, wiki, news, and calendar from Stud.IP via ImStudium. Use when materials are missing, stale, or user says "refresh Studium", "download course files".
---

# imstudium sync

Incremental sync from Stud.IP JSON:API to local workspace.

**Default:** syncs courses active in the **current calendar semester** into `~/Studium/SS2026/` (not all 50+ past enrollments).

```bash
imstudium semesters              # show current + recent semesters
imstudium courses list           # current semester courses only
imstudium sync --semester WS2025-26   # pick a specific semester
imstudium sync --all-semesters   # legacy: every enrollment
```

## Full refresh

```bash
imstudium sync -o ~/Studium
imstudium sync --extract        # also extract to markdown + rebuild the search index
```

Brings files (Stud.IP folder tree), `calendar.ics`, wiki, news, forum, courseware and Abgaben; rebuilds `studium.json`, `stundenplan.md`, `abgaben.md`, `NEW.md`. With `--extract`, new/changed files get `extracted/<file>/content.md` and the search index updates.

## Preview (dry run)

```bash
imstudium sync --dry-run --json
```

Or MCP: `imstudium_sync_dry_run`

## Cron

```cron
0 8 * * * imstudium sync --quiet --extract -o ~/Studium
```

## After sync

Always re-read: `imstudium --json studium`
