---
description: This week (or next) — every lecture, Übung and deadline, grouped by day
argument-hint: "[--next]"
allowed-tools: Bash(imstudium:*)
---

!`imstudium week --json $ARGUMENTS 2>&1 || true`

!`imstudium tasks --open --json 2>&1 || true`

Lay out my week from this: one block per day (Mo–So) with time, course and room; cancelled dates struck through; Abgaben and exams that fall in the week highlighted. End with the one day that needs the most preparation and why. If the output is an auth error, tell me to run `imstudium login` and stop.
