# ImStudium

**Im Studium — alles griffbereit.**

ImStudium puts your whole Stud.IP semester on your own laptop, for you and for the AI agent you work with. It copies your courses into one plain folder, `~/Studium`: slides, Übungsblätter, Ankündigungen, Forum, Courseware, Wiki, Termine, Abgaben and Klausuren, with every file turned into searchable text. From there it answers the questions you have at Semesterstart and every morning after: what's on today, what's new, what's due, and where that formula was. Everything runs on your machine and only reads from Stud.IP. There is no ImStudium server and no account to create, because you sign in with your university login.

The default instance is [Digicampus](https://digicampus.uni-augsburg.de) (Uni Augsburg). Any other Stud.IP 5 or 6 works with `--instance`, see [Other Stud.IP instances](#other-studip-instances).

## Get started

You need Node.js 20 or newer. Install the CLI and the agent server with one line:

```bash
npm install -g @imstudium/cli @imstudium/mcp --allow-scripts=keytar
```

`--allow-scripts=keytar` lets npm 11 run keytar's install script, which the OS keychain needs; without it your session goes into a file only your user can read. Then sign in and fetch the semester:

```bash
imstudium login
```

```bash
imstudium semester start --extract
```

`login` opens a browser window where you sign in with your university account, MFA included. You have ten minutes for that first sign-in, and after it ImStudium renews the session quietly in the background. `semester start` creates `~/Studium` for the semester that is running now and downloads everything your courses hold; `--extract` turns the files into markdown and builds the search index. From then on, one command a day keeps it current:

```bash
imstudium sync --extract
```

### Add it to your agent

The plugin gives Claude Code and Codex the skills, slash commands, a tutor subagent, a briefing when a session starts in your workspace, and read-only access to Stud.IP through the MCP server you just installed.

```bash
claude plugin marketplace add ImStudium/imstudium
claude plugin install imstudium@imstudium
```

```bash
codex plugin marketplace add ImStudium/imstudium
codex plugin add imstudium@imstudium
```

Cursor gets the same skills and the MCP server from the CLI:

```bash
imstudium setup all --agent cursor -y
```

```bash
imstudium setup mcp --agent cursor
```

For Claude Desktop, Windsurf and OpenCode, `imstudium setup all -y` installs the skills for every harness it finds on your machine, and `imstudium setup mcp` adds the server. There is also an installer that does the npm install and this setup in one go: `curl -fsSL https://raw.githubusercontent.com/ImStudium/imstudium/main/scripts/install.sh | bash`.

## On-device OCR and formulas

Born-digital PDFs, PowerPoint and Word files need nothing extra. Scanned pages, photos and formulas need models that run on your machine, and they are optional downloads:

```bash
imstudium setup ocr          # scanned pages and photos, about 60 MB once
imstudium setup ocr --math   # display formulas as LaTeX, about 1 GB more, once
imstudium setup ocr --remove # delete them again (--remove --math deletes only the math part)
```

The downloads are pinned by version and SHA-256 and unpack under `~/.local/share/imstudium/ocr`. After that, every page is read on your machine: no file and no page image leaves it, and there is no API key. The next `sync --extract` reads the scanned pages it skipped before, and only pages without a usable text layer go to OCR, so born-digital PDFs come out the same as without it. OCR takes about half a second per scanned page, formulas about 3 to 5 seconds per slide that has them. `--no-ocr` and `--no-math` switch them off for one run, `IMSTUDIUM_OCR=off` and `IMSTUDIUM_MATH=off` for a whole environment.

How well it reads, measured on synthetic lecture material in [docs/BENCHMARKS.md](docs/BENCHMARKS.md) (reproducible with `bun run bench`): born-digital PDFs lose no words, synthetic scans come back nearly character-perfect for prose and with almost all words for slides, and all 216 display formulas on the benchmark's A4 pages and Beamer slides come back exactly as typeset. Real lecture slides are harder. That is why every formula reading is checked against the letters and digits the PDF has in that place, and a reading that fails is marked for a look in `content.md`. Formulas the PDF has only as pictures, and formulas on scans, have nothing to compare with and are marked unchecked; formulas partly drawn as pictures are partly checked.

Formula recognition reads display formulas only, so math inside a sentence stays plain text with garbled sub- and superscripts. `imstudium formulas list <file> --needs-look` shows the formulas that need a person, each with its image under `formulas/<id>.png`, and agents using the `imstudium-visual` skill look at those images before they write a formula down. For anything you rely on, compare with the original in `files/`.

| Input | What it becomes |
|---|---|
| PDF | Markdown with tables and reading order (pdf-inspector) |
| PPTX, DOCX, XLSX, ODP, EPUB | Markdown (AnyDoc) |
| Scanned or image-only pages | OCR text once `setup ocr` has run; otherwise marked `_(image-only page — no text layer)_` |
| Photos (JPEG, PNG) | Copied to `pages/`, and read by OCR when it is installed |
| Display formulas | `$$…$$` blocks plus `math.json` and one image per formula, once `setup ocr --math` has run |
| Text, code, CSV | Passed through |

## Daily use

```bash
imstudium sync --extract   # new files, news, forum, courseware, wiki and dates
imstudium context          # your briefing: today, Abgaben, Klausuren, new files, news
```

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

The commands you will use most are `imstudium today` and `imstudium week` for your dates, `imstudium klausuren` for exam dates with the days left, and `imstudium search <words>` to find a topic across slides, scripts, news, forum and courseware. `imstudium watch --interval 1h` keeps syncing while a terminal stays open.

With the plugin, your agent does the rest from your own material and cites the page it took each answer from. `/imstudium:explain <concept>` explains from your slides, `/imstudium:quiz <topic>` asks active-recall questions one at a time, `/imstudium:klausur <course>` plans your exam preparation up to a mock exam, and `/imstudium:today`, `/imstudium:week` and `/imstudium:catchup` brief you. The full list is under [Agents](#agents).

## Privacy

- **Nothing leaves your machine.** The workspace, your session and your messages stay on your laptop, and there is no ImStudium server and no telemetry. Requests go to your Stud.IP and its sign-in page; `setup ocr` downloads the models once, and `update` asks the npm registry for the latest version.
- **Your session is yours.** You sign in through a browser window with ImStudium's own profile, so ImStudium never sees your password and keeps only the Stud.IP session cookie. It stores the cookie in ImSicheren when that's installed, otherwise in the OS keychain, otherwise in `~/.config/imstudium/session.json` (mode 0600), and never sends it to any site but the Stud.IP that issued it. When the session runs out, ImStudium tries once to renew it without a window; after a failed attempt it waits 30 minutes, and being offline never logs you out.
- **Reading leaves no traces.** Every command only reads: messages stay unread, forum threads are not marked read, and courseware doesn't move your "last visited" page. The only way to write is `imstudium api -X <METHOD> … --write`, and the MCP server refuses it.
- **DSGVO.** Messages, grades and classmates' names are personal data. Messages are never written into the workspace, and the `imstudium-datenschutz` skill keeps agents from copying messages, grades or names anywhere else. Whatever your agent reads goes to that agent's model provider, and choosing that provider is up to you. `snapshots/studium.json` holds counts and dates only, so a personal dashboard can read it safely.
- **Urheberrecht.** Course materials are licensed for your own studies under UrhG §60a. Keep them on your machine and don't share them outside the course.

## Stud.IP 5 and 6

ImStudium talks to Stud.IP through its JSON:API, which your university must have switched on. It works with Stud.IP 5 and 6: development started on Digicampus when it ran Stud.IP 5.4, and Digicampus runs 6.1 today. The differences between the versions are handled for you, among them the session cookie Stud.IP 6.1 renamed (`Seminar_Session` became `Studip_Session`), routes that refuse paging and error objects without a status. [docs/API.md](docs/API.md) lists what each part of the API gives and the quirks ImStudium works around.

## Troubleshooting

Start with `imstudium doctor`. It checks the install, the session, the workspace, OCR and math, your agents and MCP, and prints a fix for every problem it finds.

| Symptom | Fix |
|---|---|
| `doctor` says the session sits in a file, or keytar doesn't load | npm 11 skipped keytar's build. Run `npm install -g @imstudium/cli --allow-scripts=keytar`, or install ImSicheren. The session moves out of the file on the next command |
| `AUTH_REQUIRED`, `SESSION_EXPIRED` or "got a web page" | You are signed out, or silent renewal failed because your university forgot you. Run `imstudium login` |
| `semester start` stops with `NO_ENROLMENTS` | Stud.IP doesn't list any course for you in the new semester yet. Keep working in your current semester with `imstudium sync`, and run `semester start` once you are enrolled (`--allow-empty` starts it anyway) |
| Still on last semester's folder | `imstudium semester` compares Stud.IP's semester with your workspace; `imstudium semester start` rolls over. A plain `sync` never switches semesters on its own |
| `LOGIN_TIMEOUT` | The sign-in window waits ten minutes. Run `imstudium login` again |
| `NETWORK` | You're offline. `context`, `search`, `klausuren`, `studium`, `today --offline` and `week --offline` still work |
| A course is missing after sync | Sync prints `⚠ <course>: …` and carries on with the rest. Retry with `imstudium sync --course <name>` |
| Scanned pages still say "image-only" | Run `imstudium setup ocr`, then `imstudium sync --extract`. OCR needs Node, not Bun |
| Extraction fails | pdf-inspector and AnyDoc are native modules, so reinstall the CLI. Login, sync and MCP don't need them |
| The MCP tool doesn't show up | Run `imstudium setup mcp`, restart the harness, then check `imstudium setup status` |
| Every skill shows up twice | Use the plugin or `imstudium setup all` for a harness, not both. Running `imstudium setup` again removes the standalone copies where the plugin is installed |
| Coming from the old DigiCampus tool | Run `imstudium setup migrate -y` |

## Other Stud.IP instances

For any Stud.IP 5 or 6 with the JSON:API enabled:

```bash
imstudium --instance https://studip.example.edu today                    # one command
imstudium config set base-url https://studip.example.edu/jsonapi.php/v1  # from now on
```

Browser sign-in goes through the instance's Shibboleth login. If your university signs in some other way, use `imstudium login --manual` or `imstudium session import --cookie <value>` with your session cookie (`Seminar_Session` on Stud.IP 5, `Studip_Session` on 6.1). For OAuth, see [docs/OAUTH.md](docs/OAUTH.md). `imstudium routes` lists what your instance's API offers.

## Hausarbeit, Seminararbeit, Bachelorarbeit

Each piece of written work gets its own folder with a citation registry that checks every source before you cite it. ImStudium formats citations in your Lehrstuhl's style and holds your manuscript against the Formvorgaben before the Abgabe. It never writes the text for you.

```bash
imstudium arbeit new "Digitale Lehre im Vergleich" --typ seminararbeit --course statistik --abgabe 15.03.2027 --umfang 12s
imstudium arbeit leitfaden --course statistik       # finds the Leitfaden with the Formvorgaben in your course files
imstudium quellen add 10.1000/xyz123 "ISBN 978-3-16-148410-0"   # metadata from doi.org and the DNB, checked
imstudium quellen import ~/Downloads/zotero.bib     # or a Citavi/Mendeley export (RIS, CSL JSON)
imstudium quellen check --save                      # exists? matches? retracted?
imstudium zitieren mueller2021digitale@12           # (Müller, 2021, S. 12), or the footnote in note styles
imstudium literatur --format rtf --save literatur.rtf
imstudium arbeit vorlage --format docx              # Word template with margins, fonts, numbering and Deckblatt
imstudium arbeit check arbeit.docx                  # unknown or uncited sources, missing pages, length, parts
```

Twelve CSL styles ship with it: APA, DGPs, Chicago (notes and author-date), Harvard, MLA, IEEE, ISO 690, DIN 1505-2, Vancouver and the juristische Zitierweise. Any other style from the CSL repository, including many Lehrstuhl styles, comes in with `imstudium stile add`. LaTeX, Typst and Pandoc read the generated `quellen.bib`. [docs/ARBEITEN.md](docs/ARBEITEN.md) has the whole workflow.

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
| | `formulas list · check · fix` | A file's formulas with their check and image; check a reading; store a correction |
| **People & planning** | `people [course]` | Lecturers, tutors, groups and the number of students |
| | `sprechstunden [course or name]` | Upcoming office hours and free slots (booking stays in Stud.IP) |
| | `catalog search · areas · modules · studies` | Vorlesungsverzeichnis, study areas, modules and Studiengänge for planning next semester |
| **Exams & Abgaben** | `klausuren` | Exam dates with days remaining (confirmed and unconfirmed) |
| | `tasks [--open]` | Courseware tasks with deadlines, soonest first |
| **Writing** | `arbeit new · show · set · check · vorlage · leitfaden` | A Hausarbeit or thesis with deadline, length, style and Formvorgaben; templates; the manuscript check |
| | `quellen add · import · check · find · kurs` | The citation registry: by DOI, ISBN, arXiv or URL, from Zotero or Citavi, checked against doi.org, Crossref and the DNB |
| | `zitieren <key>@<Seite>` · `literatur` · `stile` | Citations and the Literaturverzeichnis in the Lehrstuhl's CSL style |
| **Sync** | `sync [--extract]` | Your workspace's semester: files in the Stud.IP folder tree, news, forum, courseware, wiki, calendar, tasks |
| | `sync --all-semesters` | Every enrolled semester, with the current one at the root and the rest under `archive/` |
| | `semester start` · `watch` | Roll over to a new term · keep syncing |
| **Any Stud.IP route** | `routes [topic]` | Every JSON:API route your Stud.IP offers |
| | `api <path> [--flat] [--all]` | Call any route, e.g. `imstudium api /users/me/courses --flat` |
| **Setup & health** | `login` · `logout` · `doctor [--offline]` · `update` | Sign in and out · check install, session, workspace, engines, agents and MCP (each with a fix) · upgrade |
| | `setup all · mcp · ocr · status` · `onboard` · `config set` | Agent skills · opt-in MCP · on-device OCR and math · what's wired · first-time setup · settings |

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
├── arbeiten/
│   └── digitale-lehre/      # one written work: ARBEIT.md, quellen.json → quellen.bib, stil/, vorlage/
├── .imstudium/              # changes.jsonl (sync log), tasks.json
└── snapshots/studium.json   # counts and dates only, for personal dashboards
```

The full reference is in [docs/STUDIUM.md](docs/STUDIUM.md).

## Agents

ImStudium is CLI-first. Any agent that can run a shell gets everything through `imstudium … --json`, and the workspace is plain markdown it can read. Agents that only read files start at `~/Studium/llms.txt`.

### The plugin for Claude Code and Codex

The plugin is versioned with the CLI and needs the CLI and the MCP server on your `PATH` plus one `imstudium login`.

| In the plugin | What it does |
|---|---|
| `/imstudium:today` · `/imstudium:week` · `/imstudium:catchup [since]` | Briefing, the week by day, what happened in your courses (Claude Code) |
| `/imstudium:klausur <course>` · `/imstudium:explain <concept>` · `/imstudium:quiz <topic>` | Exam plan, cited explanations from your slides, active-recall quiz |
| `/imstudium:sync` · `/imstudium:doctor` | Sync on request, diagnose install, sign-in and wiring |
| `studium-tutor` subagent | Researches your material and returns a cited answer (Claude Code) |
| SessionStart hook | Inside a study workspace (a folder with `studium.json`) the session starts with the offline briefing; elsewhere it stays silent. Claude Code and Codex both run it |
| Skills | The bundled skills below, plus the `imstudium-study-session`, `imstudium-klausur-prep` and `imstudium-semester-refresh` workflows |
| MCP `imstudium` | The read-only door below. In Codex it is how the agent reaches Stud.IP, because sandboxed shell commands have no network |

Use either the plugin or `imstudium setup all` for a harness, not both. The plugin lives in [`plugins/imstudium/`](plugins/imstudium); its manifests and skills are generated by `bun run docs` from `packages/cli/skills`, so they can't drift. Cursor reads the same skills through `.cursor-plugin/plugin.json`.

### Skills without the plugin

`imstudium setup all -y` installs the skills for Claude Code, Claude Desktop/Cowork, Cursor, Codex, Windsurf and OpenCode, but only for the harnesses found on your machine, and the installer runs it for you. Re-running it skips anything unchanged.

| Skill | For |
|---|---|
| `imstudium-agent` | Session playbook: `context` first, which command answers what, never write unasked |
| `imstudium-cli` | The full command map |
| `imstudium-datenschutz` | DSGVO and copyright rules for sessions, messages and materials |
| `imstudium-studium` · `imstudium-klausuren` · `imstudium-sync` · `imstudium-visual` · `imstudium-mcp` | Overview, exams, refresh, reading slides and formulas, MCP tools |
| `imstudium-arbeiten` | Written work: the citation registry, verified sources, styles, Formvorgaben, the check before the Abgabe |
| `imstudium-klausur-prep` · `imstudium-semester-refresh` · `imstudium-study-session` | Workflows: exam plan, daily briefing, a study session (explain, active recall, recap) |

### MCP

MCP is opt-in, and the plugin brings it along. Without the plugin, `imstudium setup mcp` writes the `imstudium` server where each harness reads it:

| Harness | Written to |
|---|---|
| Claude Code | `claude mcp add-json -s user` (user scope) |
| Claude Desktop / Cowork | `claude_desktop_config.json` |
| Cursor | `~/.cursor/mcp.json` |
| Codex | `~/.codex/config.toml` (`[mcp_servers.imstudium]`) |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |
| OpenCode | `~/.config/opencode/opencode.json` |

It also writes `~/Studium/mcp.json`. The server's main tool is **`imstudium`**, a read-only door to every CLI command: `{"args": ["week", "--next"]}` returns the same JSON as `imstudium --json week --next`. It parses the arguments with the CLI's own command tree and refuses anything that writes or changes where the session goes (`--write`, `--save`, `-o/--output`, `--instance`, `semester start`, `files download`, `login`, `setup`). The workspace tools `studium_overview`, `studium_klausuren`, `studium_course_brief`, `studium_find_materials`, `studium_read_material` and `imstudium_sync_dry_run` stay available; syncing runs only in a terminal (`imstudium sync`).

## Packages

| Package | |
|---|---|
| `@imstudium/cli` | The `imstudium` command |
| `@imstudium/contract` | zod schemas for every `--json` output, the error table and the `imstudium/source/v1` feed |
| `@imstudium/sdk` | Stud.IP client, auth, sync, workspace writers |
| `@imstudium/mcp` | MCP server (`imstudium-mcp`) |

[AGENTS.md](AGENTS.md) · [docs/COMMANDS.md](docs/COMMANDS.md) · [docs/ERRORS.md](docs/ERRORS.md) · [docs/STUDIUM.md](docs/STUDIUM.md) · [docs/API.md](docs/API.md) · [docs/BENCHMARKS.md](docs/BENCHMARKS.md) · [CHANGELOG.md](CHANGELOG.md) · [CONTRIBUTING.md](CONTRIBUTING.md)

## Legal

For personal study use only. Respect your university's terms of use and the licenses of course materials.

## License

[MIT](LICENSE), copyright (c) 2026 Patrick Schröppel
