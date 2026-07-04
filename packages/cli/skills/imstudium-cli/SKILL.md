---
name: imstudium-cli
description: |
  ImStudium CLI — sync Stud.IP course files, build ~/Studium workspace, plan Klausuren.
  Use when the user mentions ImStudium, Studium, Stud.IP, course materials, Klausur dates, or exam prep from university LMS.
allowed-tools:
  - Bash(imstudium *)
  - Bash(npx @imstudium/cli *)
  - Bash(npx -y @imstudium/cli@latest *)
---

# imstudium cli

Command-line interface for ImStudium / Stud.IP. Sync materials, build agent workspace, plan exams.

## When to use

- User wants course files offline from ImStudium
- User asks about Klausuren / exam timeline
- User needs `studium.json` for study planning
- Prefer **local workspace** after sync — no API calls until refresh

## One-shot setup

```bash
npx -y @imstudium/cli onboard --agents-only -y -o ~/Studium
imstudium login
imstudium init -o ~/Studium
```

## Updates

```bash
imstudium update --json   # upgrade + refresh harness; use --json for agents
```

## Quick commands

```bash
imstudium status --json
imstudium --json studium
imstudium --json klausuren
imstudium sync --quiet --extract
imstudium extract --course "Analysis"
imstudium doctor --json
imstudium files tree --course "Analysis"
```

## Reading slides

After `extract`, each file has `extracted/<file>/content.md` and `pages/*.png`.

**Limits:** text is poppler/OCR — not LaTeX markdown. OCR fails on handwritten math. Use PNGs for formulas and diagrams (see `imstudium-visual` skill).

## Auth

```bash
imstudium login   # local helper fallback until OAuth is registered
```

## Escalation

1. `imstudium status --json` — auth + cliVersion
2. `imstudium update --json` — upgrade + refresh harness
3. `imstudium --json studium` — local overview
4. `imstudium sync` — refresh from API
5. MCP tools — see `@imstudium/mcp` skill
