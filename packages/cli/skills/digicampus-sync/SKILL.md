---
name: digicampus-sync
description: |
  Sync course files, wiki, news, and calendar from DigiCampus. Use when materials are missing, stale, or user says "refresh Studium", "download course files".
---

# digicampus sync

Incremental sync from Stud.IP JSON:API to local workspace.

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
