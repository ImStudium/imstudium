---
name: digicampus-sync
description: |
  Sync course files, wiki, news, and calendar from DigiCampus. Use when materials are missing, stale, or user says "refresh Studium", "download course files".
---

# digicampus sync

Incremental sync from Stud.IP JSON:API to local workspace.

**Default:** syncs courses active in the **current calendar semester** into `~/Studium/SS2026/` (not all 50+ past enrollments).

```bash
digicampus semesters              # show current + recent semesters
digicampus courses list           # current semester courses only
digicampus sync --semester WS2025-26   # pick a specific semester
digicampus sync --all-semesters   # legacy: every enrollment
```

## Full refresh

```bash
digicampus sync -o ~/Studium
digicampus sync --extract        # also extract text + slide images
```

Includes wiki, news, `calendar.ics`, rebuilds `studium.json`. With `--extract`, new/changed files get `extracted/<file>/content.md` + `pages/*.png`.

## Preview (dry run)

```bash
digicampus sync --dry-run --json
```

Or MCP: `digicampus_sync_dry_run`

## Cron

```cron
0 8 * * * digicampus sync --quiet --extract -o ~/Studium
```

## After sync

Always re-read: `digicampus --json studium`
