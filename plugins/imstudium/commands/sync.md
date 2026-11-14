---
description: Sync Stud.IP into your study workspace — new files, news, courseware, dates, search index
argument-hint: "[--dry-run] [--semester <name>]"
allowed-tools: Bash(imstudium:*)
---

I'm asking you to sync my Studium workspace now.

1. `imstudium semester --json` — if Stud.IP is on a newer semester than the workspace, tell me and ask whether to run `imstudium semester start` (archives the old term) instead of a plain sync. Stop until I answer.
2. Otherwise run `imstudium sync --extract $ARGUMENTS` (it can take a few minutes on the first run; run it in the background if your harness allows and report when done).
3. Then `imstudium changes --since 1d` and summarise what came in, per course. Report failures with the error `code` and its hint — e.g. `SESSION_EXPIRED` means I need to run `imstudium login`.
