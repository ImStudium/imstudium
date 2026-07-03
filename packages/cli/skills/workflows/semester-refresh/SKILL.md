---
name: digicampus-semester-refresh
description: |
  Workflow — morning semester refresh: sync, overview, next 3 exams, flag stale courses.
  Use for daily briefing, "what's due", "update my Studium".
---

# Workflow: Semester refresh

## Steps

0. `digicampus update --check --json` — if `updateAvailable`, run `digicampus update -y`
1. `digicampus_whoami` — auth OK?
2. `digicampus_sync` or CLI `digicampus sync --quiet`
3. `studium_overview` — course list
4. `studium_klausuren` — `nextDeadlines` top 3

## Deliverable

```markdown
## Studium refresh — [date]
- **Courses:** N active
- **Next exams:** (top 3 with days remaining)
- **Action:** [one course needing attention — fewest files or nearest exam]
```

## Cron alignment

Matches `0 8 * * * digicampus sync --quiet` — run this workflow after sync in daily briefing.
