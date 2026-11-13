---
name: imstudium-semester-refresh
description: |
  Workflow — the study morning briefing: is the session alive, is the workspace on the current semester, what's
  today and this week, what's due, what's new, and the one thing to do next. Use for a daily briefing,
  "what's due", "update my Studium", "catch me up", or after time away from university.
allowed-tools:
  - Bash(imstudium *)
---

# Workflow: Semester refresh

CLI first. Inside an MCP-only harness use the `imstudium` tool with the same arguments; a sync then runs in a terminal.

## Steps

1. `imstudium context --json` — one call: semester and week, today, open Abgaben, Klausuren, new files, news, `next`.
2. Act on `next`, never silently:
   - **signed out / `SESSION_EXPIRED`** → ask the student to run `imstudium login` themselves.
   - **`semester start` suggested** → the workspace is still on last term. Offer `imstudium semester start`
     (archives it, syncs the new one); run it only on a yes.
   - **workspace older than a day** → offer `imstudium sync --extract`.
3. `imstudium week` — this week's dates, cancelled ones marked.
4. `imstudium tasks --open` and `imstudium klausuren` — everything with a deadline in the next 14 days.
5. `imstudium changes --since 7d` and `imstudium news --since 7d` — what arrived; flag anything exam-related.
6. With `--live` context, unread Stud.IP messages are counted — mention the count, read none unasked.

## Deliverable

```markdown
## Studium — [weekday, date] · [semester] week [N]
- **Today:** [dates, or "no lectures"]
- **Due ≤ 14 days:** [Abgaben and Klausuren with days left]
- **New:** [files and news worth opening, one line each]
- **Next:** [one action — the nearest deadline or the course falling behind]
```

## Daily automation

`imstudium sync --quiet --extract` from cron or launchd keeps the workspace fresh; this workflow then reads only local files.
