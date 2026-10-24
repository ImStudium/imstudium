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

## Command map

```bash
# orient
imstudium context --json            # one briefing: semester, today, new, deadlines, news
imstudium semester                  # Stud.IP term vs workspace; says when to roll over
imstudium semester start            # archive last term, sync the new one
# time
imstudium today | week [--next] | stundenplan | holidays
# what's new
imstudium changes --since 7d        # files that arrived (also NEW.md)
imstudium news [course] --since 7d  | feed --since 7d | inbox --unread | message <id>
# material
imstudium search <words> [--course x] [--archive]
imstudium courseware [course] | tasks [--open] | wiki [course] [page] | forum [course]
imstudium files tree <course>
# people & planning
imstudium people <course> | sprechstunden <course> | catalog search <q> --semester "SS 2027"
# exams
imstudium klausuren
# written work (Hausarbeit, thesis): see imstudium-arbeiten
imstudium arbeit new "<Titel>" --typ hausarbeit --course x --abgabe 15.03.2027 | arbeit show | arbeit check <manuskript>
imstudium quellen add <DOI|ISBN|arXiv|URL> | quellen import <export.bib> | quellen check --save | quellen find "<ref>"
imstudium zitieren <key>@<Seite> | literatur --format rtf | stile find <words> | stile add <id>
# sync
imstudium sync --extract            # files → markdown → search index (tree layout)
imstudium sync --all-semesters      # past terms into archive/
# everything else Stud.IP has
imstudium routes [topic]            # the instance's JSON:API catalog
imstudium api <path> --flat         # any GET route; /users/me/... expands to you
# health
imstudium status --json · doctor --json · update --json
```

Global flags: `--json` (stable keys for agents), `--quiet`, `--instance <url>` (other Stud.IP).

## Reading slides

After `extract`, each file has `extracted/<file>/content.md` (pages as `## Page N` sections); photos are copied to `pages/`.

**Limits:** one pipeline — pdf-inspector (PDF) + AnyDoc (Office). No Tesseract. Image-only pages have no text; open the original. See `imstudium-visual`.

## Auth

```bash
imstudium login   # the student signs in once in a browser window; later renewals run silently
```

Never handle the student's password. If a command reports an expired session and silent renewal fails, ask the student to run `imstudium login`.

## Escalation

1. `imstudium status --json` — auth + cliVersion
2. `imstudium update --json` — upgrade + refresh harness
3. `imstudium --json studium` — local overview
4. `imstudium sync` — refresh from API
5. MCP tools — see `@imstudium/mcp` skill
