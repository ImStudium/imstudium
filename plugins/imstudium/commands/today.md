---
description: Today's study briefing — dates, what's due, what's new, and the next step
argument-hint: "[--live]"
allowed-tools: Bash(imstudium:*)
---

Give me my study briefing for today.

Briefing from ImStudium:

!`imstudium context --json $ARGUMENTS 2>&1 || true`

Follow the `imstudium-semester-refresh` workflow with this data:

- If the output is an error document: `AUTH_REQUIRED` / `SESSION_EXPIRED` → tell me to run `imstudium login` myself; `imstudium: command not found` → point me to the install line in the plugin README. Stop there.
- Otherwise answer in this shape, short: **Today** (dates, cancelled ones marked) · **Due ≤ 14 days** (Abgaben and Klausuren with days left; mark unconfirmed exam dates) · **New** (files and news worth opening) · **Next** (one concrete action).
- If `next` suggests `imstudium semester start` or a sync, offer it as a question — don't run it.
