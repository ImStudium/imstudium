---
name: digicampus-cli
description: |
  DigiCampus Studium OS CLI — sync Stud.IP course files, build ~/Studium workspace, plan Klausuren.
  Use when the user mentions DigiCampus, Studium, Stud.IP, course materials, Klausur dates, or exam prep from university LMS.
allowed-tools:
  - Bash(digicampus *)
  - Bash(npx digicampus *)
  - Bash(npx -y digicampus@latest *)
---

# digicampus cli

Command-line interface for DigiCampus / Stud.IP. Sync materials, build agent workspace, plan exams.

## When to use

- User wants course files offline from DigiCampus
- User asks about Klausuren / exam timeline
- User needs `studium.json` for study planning
- Prefer **local workspace** after sync — no API calls until refresh

## One-shot setup

```bash
npx -y digicampus onboard --agents-only -y -o ~/Studium
digicampus login
digicampus init -o ~/Studium
```

## Updates (LLM-friendly)

Always use `--json` for machine-readable output:

```bash
digicampus update --check --json   # current, latest, updateAvailable, recommendedAction
digicampus update -y               # refresh skills/MCP; upgrades global npm install if needed
digicampus setup status --json     # harness manifest
```

npx users get latest with `npx -y digicampus@latest <cmd>`. Global users: `digicampus update -y`.

## Quick commands

```bash
digicampus status --json
digicampus --json studium
digicampus --json klausuren
digicampus sync --quiet --extract
digicampus extract --course "Analysis"
digicampus doctor --json
digicampus files tree --course "Analysis"
```

## Reading slides

After `extract`, each file has `extracted/<file>/content.md` and `pages/*.png`. Read the PNGs for diagrams and formulas (see `digicampus-visual` skill).

## Auth

```bash
digicampus login   # opens normal browser — saved passwords; paste Seminar_Session once
```

## Escalation

1. `digicampus status --json` — auth + cliVersion
2. `digicampus update --check --json` — version drift
3. `digicampus --json studium` — local overview
4. `digicampus sync` — refresh from API
5. MCP tools — see `digicampus-mcp` skill
