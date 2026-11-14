---
description: Diagnose ImStudium — install, sign-in, workspace, agent wiring — and say how to fix each problem
allowed-tools: Bash(imstudium:*), Bash(which:*)
---

!`imstudium doctor --json 2>&1 || true`

!`imstudium status --json 2>&1 || true`

Explain each `warn` or `fail` check in one line with its `fix`. Things only I can do (signing in with `imstudium login`, installing software, approving a setting) — tell me the exact command. Don't run `setup`, `sync` or `login` yourself. If everything passes, say so in one line.
