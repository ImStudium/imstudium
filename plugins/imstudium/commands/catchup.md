---
description: Catch up on what happened in your courses — new files, announcements, forum, deadlines
argument-hint: "[since, e.g. 3d · 2w · 2026-11-01] (default 7d)"
allowed-tools: Bash(imstudium:*)
---

Catch me up on my courses. Since: "$ARGUMENTS" — if that's empty, use `7d`.

Run, with `--json`, using that value as `--since`:

1. `imstudium changes --since <since> --json` — files that arrived or changed
2. `imstudium news --since <since> --json` — announcements across current courses
3. `imstudium feed --since <since> --json` — the Stud.IP activity stream
4. `imstudium tasks --open --json` and `imstudium klausuren --json` — what's due

Group by course, most important first: anything about exams, deadlines, room or date changes, cancelled sessions. One line per item, with what I should do about it. Don't read or summarise private messages — only say how many unread there are if `imstudium context --live --json` reports them.
