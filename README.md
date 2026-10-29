# ImStudium

**Im Studium — alles griffbereit.**

Your Stud.IP on your own laptop, ready for you and your AI agent. ImStudium mirrors your courses into one plain folder, `~/Studium`: slides, Übungsblätter, Ankündigungen, Forum, Courseware, Wiki, Termine, Abgaben and Klausuren. From there it answers the questions you have at Semesterstart and every morning after. *What's on today? What's new? What's due? Where was that formula?*

It's built for students at German universities that run Stud.IP. The default instance is [Digicampus](https://digicampus.uni-augsburg.de) (Uni Augsburg), and `--instance` points it at any other Stud.IP. Everything runs locally and only reads by default. There is no ImStudium server.

## Install

Node.js 20+.

```bash
# One line: installs the CLI and the agent skills for the harnesses on this machine
curl -fsSL https://raw.githubusercontent.com/ImStudium/imstudium/main/scripts/install.sh | bash

# Or with npm
npm install -g @imstudium/cli

# Or without installing anything
npx -y @imstudium/cli <command>
```

## First run

```bash
imstudium login            # a browser window opens: sign in with your university account (MFA included)
imstudium semester start   # syncs the running semester; an older semester folder moves to archive/
imstudium context          # your briefing: today, Abgaben, Klausuren, new files, news
```

You have ten minutes for the first sign-in. After that, ImStudium renews the session quietly in the background.

This is what `imstudium context` looks like (synthetic example):

```
WS 2026/27 · Woche 3 · Workspace WS 2026/27 (5 Kurse) · Sync Mo., 19.10., 08:12

Heute
  10:00–11:30 · Statistik I (Vorlesung) · Hörsaal 1001
  14:00–15:30 · Datenbanksysteme (Übung) · Raum 2045

Abgaben
  in 4 d         Übungsblatt 1 · Datenbanksysteme

Neu
  Statistik I                    Folien-01-Einfuehrung.pdf

Als Nächstes
  → imstudium changes --since 7d
```

## Every day

```bash
imstudium sync --extract   # new files → markdown → search index, plus news, forum, courseware, wiki, dates
imstudium context          # what matters now
```

`imstudium watch --interval 1h` keeps syncing while a terminal stays open.

## Commands

Every command takes `--json` (stable keys for scripts and agents), `--quiet` and `--instance <url>`. A course argument can be a title fragment, shortcut, slug, number or id, as in `imstudium news statistik` or `--course statistik`. `imstudium <command> --help` lists every option; [docs/COMMANDS.md](docs/COMMANDS.md) is the full reference, `imstudium schema <command>` prints the JSON Schema of a command's `--json` output, and [docs/ERRORS.md](docs/ERRORS.md) lists every error code and exit code.

| | Command | What you get |
|---|---|---|
| **Orient** | `context` | Semester, today, Abgaben, Klausuren, new files, news and the next step, in one call |
| | `semester` | The term Stud.IP is in compared with your workspace; tells you when to roll over |
| | `studium` · `status` | Workspace overview · sign-in and instance status |
| **Time** | `today` · `week [--next]` | Today's or this week's dates across your courses, cancellations marked |
| | `stundenplan [--save]` | Your weekly plan, single dates and cancellations |
| | `holidays` | Feiertage and the lecture period. Time commands take `--offline` to read `calendar.ics` |
| **What's new** | `changes --since 7d` | Files that arrived or changed (also in `NEW.md`) |
| | `news [course]` · `feed` | Ankündigungen · Stud.IP's activity stream |
| | `inbox [--unread]` · `outbox` · `message <id>` | Your messages; reading them never marks them read |
| **Material** | `search <words>` | Ranked offline search over slides, scripts, news, forum, courseware and wiki (`--archive` for past semesters) |
| | `files tree <course>` | The course's folder tree with sizes and dates |
| | `courseware` / `cw [course]` · `wiki [course] [page]` | Lernmaterial units and pages · the course wiki |
| | `forum [course]` · `blubber [course]` | Forum threads · Blubber chats |
| | `extract` · `index` | Re-run extraction or rebuild the search index on its own |
| **People & planning** | `people [course]` | Lecturers, tutors, groups and the number of students |
| | `sprechstunden [course or name]` | Upcoming office hours and free slots (booking stays in Stud.IP) |
| | `catalog search · areas · modules · studies` | Vorlesungsverzeichnis, study areas, modules and Studiengänge for planning next semester |
| **Exams & Abgaben** | `klausuren` | Exam dates with days remaining (confirmed and unconfirmed) |
| | `tasks [--open]` | Courseware tasks with deadlines, soonest first |
| **Sync** | `sync [--extract]` | Current semester: files in the Stud.IP folder tree, news, forum, courseware, wiki, calendar, tasks |
| | `sync --all-semesters` | Every enrolled semester, with the current one at the root and the rest under `archive/` |
| | `semester start` · `watch` | Roll over to a new term · keep syncing |
| **Any Stud.IP route** | `routes [topic]` | Every JSON:API route your Stud.IP offers |
| | `api <path> [--flat] [--all]` | Call any route, e.g. `imstudium api /users/me/courses --flat` |
| **Setup & health** | `login` · `logout` · `doctor [--offline]` · `update` | Sign in and out · check install, session, workspace, engines, agents and MCP (each with a fix) · upgrade |
| | `setup all · mcp · status` · `onboard` · `config set` | Agent skills · opt-in MCP · what's wired · first-time setup · settings |

## Your workspace

```
~/Studium/
├── llms.txt                 # entry point for agents
├── studium.json             # course map (schema v2); every folder comes from course.path
├── STUDIUM.md               # semester overview
├── NEW.md                   # what arrived in the last 14 days
├── abgaben.md               # courseware tasks with deadlines
├── stundenplan.md           # weekly plan, single dates, cancellations
├── klausuren.md             # exam dates
├── calendar.ics             # your Stud.IP calendar
├── WS2026-27/               # the current semester
│   └── Statistik-I/
│       ├── COURSE.md        # brief: type, ECTS, exams; your notes survive rebuilds
│       ├── files/           # originals, in the course's Stud.IP folder tree
│       ├── extracted/       # <file>/content.md, one section per page
│       ├── search/          # corpus.jsonl (page index) + materials.json
│       ├── news/            # Ankündigungen as dated markdown
│       ├── forum/           # <topic>/<thread>.md
│       ├── courseware/      # <unit>/<NN>-<page>.md + block files
│       └── wiki/
├── archive/
│   └── SS2026/              # earlier semesters, same layout, plus semester.json
├── .imstudium/              # changes.jsonl (sync log), tasks.json
└── snapshots/studium.json   # counts and dates only, for personal dashboards
```

The full reference is in [docs/STUDIUM.md](docs/STUDIUM.md).

### Extraction

`sync --extract` and `imstudium extract` turn files into markdown on your machine, with no API key.

| Input | Engine |
|---|---|
| PDF | pdf-inspector (layout, tables, reading order) |
| PPTX, DOCX, XLSX, ODP, EPUB | AnyDoc |
| Scanned or image-only pages | marked `_(image-only page — no text layer)_`; open the original |
| Photos | copied to `pages/` (no OCR) |
| Text, code, CSV | passed through |

`content.md` is not LaTeX. For formulas and diagrams, open the original in `files/`. `imstudium doctor` checks both engines.

## Agents

ImStudium is CLI-first. Any agent that can run a shell gets everything through `imstudium … --json`, and the workspace is plain markdown it can read. Agents that only read files start at `~/Studium/llms.txt`.

**Skills** come with the installer, or run `imstudium setup all -y`. They're installed for Claude Code, Claude Desktop/Cowork, Cursor, Codex, Windsurf and OpenCode, but only for the harnesses found on your machine. Re-running it skips anything unchanged.

| Skill | For |
|---|---|
| `imstudium-agent` | Session playbook: `context` first, which command answers what, never write unasked |
| `imstudium-cli` | The full command map |
| `imstudium-datenschutz` | DSGVO and copyright rules for sessions, messages and materials |
| `imstudium-studium` · `imstudium-klausuren` · `imstudium-sync` · `imstudium-visual` · `imstudium-mcp` | Overview, exams, refresh, reading slides, MCP tools |
| `klausur-prep` · `semester-refresh` | Workflows for exam prep and a daily briefing |

**MCP** is opt-in:

```bash
imstudium setup mcp     # writes the imstudium server where each harness reads it
```

| Harness | Written to |
|---|---|
| Claude Code | `claude mcp add-json -s user` (user scope) |
| Claude Desktop / Cowork | `claude_desktop_config.json` |
| Cursor | `~/.cursor/mcp.json` |
| Codex | `~/.codex/config.toml` (`[mcp_servers.imstudium]`) |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |
| OpenCode | `~/.config/opencode/opencode.json` |

It also writes `~/Studium/mcp.json`. The server's main tool is **`imstudium`**, a read-only door to every CLI command: `{"args": ["week", "--next"]}` returns the same JSON as `imstudium --json week --next`. It parses the arguments with the CLI's own command tree and refuses anything that writes or changes where the session goes (`--write`, `--save`, `-o/--output`, `--instance`, `semester start`, `files download`, `login`, `setup`). The workspace tools `studium_overview`, `studium_klausuren`, `studium_course_brief`, `studium_find_materials`, `studium_read_material` and `imstudium_sync_dry_run` stay available; syncing runs only in a terminal (`imstudium sync`).

## Privacy

- **Your session stays on your machine.** You sign in through a browser window that uses ImStudium's own profile. ImStudium never sees your password and keeps only the Stud.IP session cookie. It stores the cookie in ImSicheren when that's installed, otherwise in the OS keychain, otherwise in `~/.config/imstudium/session.json` (mode 0600). There is never a plaintext copy next to the secure store.
- **Renewal happens without a window.** When the session runs out, ImStudium tries once, headless, with that same login profile. This works while your university still remembers you. It never types credentials, and after a failed attempt it waits 30 minutes before trying again. Being offline never logs you out.
- **Read-only by default.** Every command only reads, and reading leaves no traces: messages stay unread, forum threads are not marked read, and courseware doesn't move your "last visited" page. The only way to write is `imstudium api -X <METHOD> … --write`, and the MCP door refuses it.
- **What never leaves your machine:** the workspace, your session and your messages. Messages are never written into the workspace either. There is no ImStudium server and no telemetry. Requests go to your Stud.IP and its sign-in page; `update` also asks the npm registry for the latest version.
- **Agents:** whatever your AI agent reads goes to that agent's model provider, and choosing that provider is up to you. The `imstudium-datenschutz` skill keeps agents from copying messages, grades or classmates' names anywhere else.
- `snapshots/studium.json` holds counts and dates only (no titles, names or ids), so it's safe for a personal dashboard.

Course materials are licensed for your own studies (UrhG §60a). Keep them on your machine.

## Other Stud.IP instances

Digicampus (Uni Augsburg) is the default. For any other Stud.IP 5 or 6 with the JSON:API enabled:

```bash
imstudium --instance https://studip.example.edu today                    # one command
imstudium config set base-url https://studip.example.edu/jsonapi.php/v1  # from now on
```

Browser sign-in goes through the instance's Shibboleth login. If your university signs in some other way, use `imstudium login --manual` or `imstudium session import --cookie <Seminar_Session>`. For OAuth, see [docs/OAUTH.md](docs/OAUTH.md). `imstudium routes` lists what your instance's API offers, and [docs/API.md](docs/API.md) has the capability matrix.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `SESSION_EXPIRED`, or "got a web page" | Run `imstudium login`. Silent renewal failed or your university forgot you |
| `NETWORK` | You're offline. `context`, `search`, `klausuren`, `studium`, `today --offline` and `week --offline` still work |
| `LOGIN_TIMEOUT` | The sign-in window waits ten minutes. Run `imstudium login` again |
| A course is missing after sync | Sync prints `⚠ <course>: …` and carries on with the rest. Retry with `imstudium sync --course <name>` |
| Extraction fails | Run `imstudium doctor`. pdf-inspector and AnyDoc are native modules, so reinstall the CLI. Login, sync and MCP don't need them |
| Still on last semester's folder | Run `imstudium semester`, then `imstudium semester start` |
| The MCP tool doesn't show up | Run `imstudium setup mcp`, restart the harness, then check `imstudium setup status` |
| Coming from the old DigiCampus tool | Run `imstudium setup migrate -y` |
| Anything else | Run `imstudium status --json` and `imstudium update` |

## Packages

| Package | |
|---|---|
| `@imstudium/cli` | The `imstudium` command |
| `@imstudium/contract` | zod schemas for every `--json` output, the error table and the `imstudium/source/v1` feed |
| `@imstudium/sdk` | Stud.IP client, auth, sync, workspace writers |
| `@imstudium/mcp` | MCP server (`imstudium-mcp`) |

[AGENTS.md](AGENTS.md) · [docs/COMMANDS.md](docs/COMMANDS.md) · [docs/ERRORS.md](docs/ERRORS.md) · [docs/STUDIUM.md](docs/STUDIUM.md) · [docs/API.md](docs/API.md) · [CHANGELOG.md](CHANGELOG.md) · [CONTRIBUTING.md](CONTRIBUTING.md)

## Legal

For personal study use only. Respect your university's terms of use and the licenses of course materials.

## License

[MIT](LICENSE) — Copyright (c) 2026 Patrick Schröppel
