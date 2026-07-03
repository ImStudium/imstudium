---
name: digicampus-cli
description: |
  DigiCampus Studium OS CLI — sync Stud.IP course files, build ~/Studium workspace, plan Klausuren.
  Use when the user mentions DigiCampus, Studium, Stud.IP, course materials, Klausur dates, or exam prep from university LMS.
allowed-tools:
  - Bash(digicampus *)
  - Bash(npx digicampus *)
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
npx -y digicampus onboard -y -o ~/Studium
```

Installs skills + MCP for detected agents only. Re-run `digicampus setup all -y` after upgrades (skips unchanged).

## Quick commands

```bash
digicampus status
digicampus --json studium
digicampus --json klausuren
digicampus sync --quiet --extract
digicampus extract --course "Analysis"   # text + slide PNGs
digicampus doctor                        # extraction tool check
digicampus files tree --course "Analysis"
```

## Reading slides

After `extract`, each file has `extracted/<file>/content.md` (text per slide) and `pages/*.png`. Read the PNGs to visually comprehend diagrams and formulas.

## Auth

MFA required — run `digicampus login` (browser). Session stored in OS keychain.

## Escalation

1. `digicampus status` — auth check
2. `digicampus --json studium` — local overview
3. `digicampus sync` — refresh from API
4. MCP tools — see `digicampus-mcp` skill
