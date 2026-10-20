# AGENTS.md — ImStudium

This guide is for every agent harness: Claude Code, Claude Desktop/Cowork, Cursor, Codex, Windsurf and OpenCode.
Part 1 covers helping a student with ImStudium. Part 2 covers working on this repository.

## Part 1 — Helping a student

ImStudium mirrors one student's Stud.IP into `~/Studium` and exposes every Stud.IP route through one CLI. **The CLI is the product.** Use it before reading files by hand, and add `--json` whenever you parse the output.

### Every session: orient first

```bash
imstudium context --json
```

That one call returns the semester and its week, today's dates, open Abgaben, Klausuren, new files, recent news and `next`, the sensible next commands. Act on `next`:

- If it suggests `imstudium semester start`, the workspace is still on last semester. Offer it to the student; don't run it unasked.
- If the student is signed out, or a command says `SESSION_EXPIRED`, ask the student to run `imstudium login` themselves. Never type credentials and never open login pages for them.

### Answer from the right command

| Question | Command |
|---|---|
| What's today / this week? | `imstudium today` · `imstudium week [--next]` · `imstudium stundenplan` · `imstudium holidays` |
| What's new? | `imstudium changes --since 7d` · `imstudium news --since 7d` · `imstudium feed --since 7d` |
| Deadlines, exams | `imstudium tasks --open` · `imstudium klausuren` |
| Find or explain material | `imstudium search "<words>"` (`--course`, `--kind`, `--archive`), then open the cited `content.md` |
| One course in depth | `imstudium courseware <course>` · `wiki <course>` · `forum <course>` · `files tree <course>` |
| Who teaches, office hours | `imstudium people <course>` · `imstudium sprechstunden <course>` |
| Messages | `imstudium inbox --unread` · `imstudium message <id>`. Read only what the student asks for |
| Plan next semester | `imstudium catalog search <topic> --semester "SS 2027"` · `catalog modules` · `catalog areas` |
| Anything else in Stud.IP | `imstudium routes <topic>`, then `imstudium api <path> --flat` |

A course argument can be a title fragment, slug, number or id (`imstudium news statistik`).
Several commands work offline from the workspace: `context`, `search`, `klausuren`, `studium`, and `today`/`week`/`stundenplan` with `--offline`.

### The workspace

When you only read files, start at `~/Studium/llms.txt`. Then use these:

- `studium.json` (schema v2): resolve every course folder from `course.path`, never guess
- `NEW.md`, `abgaben.md`, `stundenplan.md`, `klausuren.md`, `STUDIUM.md` at the root
- per course: `COURSE.md`, `files/`, `extracted/<slug>/content.md`, `search/`, `news/`, `forum/`, `courseware/`, `wiki/`
- `archive/<semester>/` for earlier semesters

The full layout is in [docs/STUDIUM.md](docs/STUDIUM.md).

Some limits on extracted text:

- `content.md` comes from pdf-inspector (PDF) and AnyDoc (Office) on the student's machine. It is **not LaTeX**.
- Image-only pages are marked `_(image-only page — no text layer)_`.
- For formulas and diagrams, open the original in `files/`. Never invent math from the markdown.

### MCP (opt-in)

`imstudium setup mcp` wires the `imstudium-mcp` server. Its main tool is **`imstudium`**, a read-only door to every CLI command. `{"args": ["context"]}` returns the same JSON as `imstudium --json context`.

The door refuses anything that writes:

- `--write`, `--save`, `-X`/`--data`, `--force`
- `semester start`, `files download`
- every command outside its allowlist (`login`, `setup`, `sync`, …)

The workspace tools are still there: `studium_overview`, `studium_klausuren`, `studium_course_brief`, `studium_find_materials`, `studium_read_material`, `imstudium_sync`, `imstudium_sync_dry_run`, `imstudium_list_courses`, `imstudium_whoami` and `studium_modules`.

### Never

- Write to Stud.IP (`imstudium api … --write`, posting, messaging, booking) unless the student explicitly asks for that exact change.
- Run `semester start`, `sync`, `--save` or `setup` without being asked. They change the student's workspace or config.
- Handle the university password, print the session, or copy anything from `~/.config/imstudium`.
- Paste messages, grades, Matrikelnummer or classmates' names anywhere outside the session. Don't upload `~/Studium` content anywhere. Course material is licensed for the student's own studies (UrhG §60a). See the `imstudium-datenschutz` skill.
- Hand in solutions to current Übungsblätter as the student's own work. Explain, quiz, and give hints and worked examples of *similar* problems instead.

### Setup per harness

`imstudium setup all -y` installs skills, and the installer runs it for you. `imstudium setup mcp` adds MCP. Both touch only the harnesses they detect (`--all-agents` for every one), skip anything unchanged, and `--force` rewrites. `imstudium setup status` shows what's wired.

| Harness | Skills | MCP (`imstudium setup mcp`) |
|---|---|---|
| Cursor | `~/.cursor/skills/` | `~/.cursor/mcp.json` |
| Claude Code | `~/.claude/skills/` | `claude mcp add-json -s user` (stored in `~/.claude.json`) |
| Claude Desktop / Cowork | `~/.claude/skills/` (shared) | `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/`) |
| OpenAI Codex | `~/.codex/skills/` | `[mcp_servers.imstudium]` in `~/.codex/config.toml` (`$CODEX_HOME`) |
| Windsurf | `~/.codeium/windsurf/skills/` | `~/.codeium/windsurf/mcp_config.json` |
| OpenCode | `~/.config/opencode/skills/` | `mcp.imstudium` in `~/.config/opencode/opencode.json` |
| Project | — | `~/Studium/mcp.json` |

The installed skills:

- `imstudium-agent`: session playbook
- `imstudium-cli`: command map
- `imstudium-datenschutz`
- `imstudium-studium`, `imstudium-klausuren`, `imstudium-sync`, `imstudium-visual`, `imstudium-mcp`
- workflows `klausur-prep` and `semester-refresh`

Paths:

- setup manifest: `~/.config/imstudium/setup-manifest.json`
- workspace: `~/Studium` (`IMSTUDIUM_WORKSPACE`)

## Part 2 — Working on this repository

### Architecture

Bun workspaces, four packages:

| Package | Owns |
|---|---|
| `packages/contract` (`@imstudium/contract`) | zod schemas for every CLI `--json` output, the error document and the `imstudium/source/v1` feed. Types only on hot paths; values (zod) load lazily |
| `packages/sdk` (`@imstudium/sdk`) | Stud.IP client, auth, resources, sync, workspace writers, extraction, search. No Commander |
| `packages/cli` (`@imstudium/cli`) | Commander commands, `--json` output, agent setup, bundled skills. No raw `fetch` to Stud.IP; everything goes through the SDK |
| `packages/mcp` (`@imstudium/mcp`) | MCP server: tool definitions and the CLI door |

**SDK** (`packages/sdk/src`)

- `client.ts`: `StudIpClient`, with timeouts, retries/backoff (network errors, 429 `Retry-After`, 5xx), a request gate (6 in flight), typed JSON:API queries, pagination that keeps `included`, one renewal on 401, and `SESSION_EXPIRED` when a login page comes back.
- `auth.ts`, `browser-profile.ts`, `oauth.ts`: session store (ImSicheren, then keychain, then a 0600 file), browser sign-in, and silent headless renewal with a 30-minute cooldown after a failure.
- `jsonapi.ts`: `flatten`, `Included`, `htmlToText`. `routes.ts`: the `/discovery` catalog. `cache.ts`: disk cache for public data (semesters, holidays).
- `resources/*.ts`: one module per Stud.IP domain: courses, files, courseware, wiki, news, forum, messages, blubber, activity, planning, people, consultations, catalog. Each splits pure normalisers (resource in, plain object out) from the class that talks to Stud.IP. **GET only.**
- `content/`: pure renderers and idempotent writers for courseware (`courseware-render.ts`, `courseware-write.ts`), the shared frontmatter dialect (`markdown.ts`), and `sync-content.ts` (one hook per course). News and forum writers live next to their resources; `resources/communication.ts` has `syncCommunication`.
- `sync.ts`: file sync (tree layout, per-course error isolation, new/updated marking, move instead of re-download).
- `studium.ts`: `studium.json`, `STUDIUM.md`, `klausuren.md`, `COURSE.md`, `llms.txt`.
- `rollover.ts`: semester start and the archive.
- `timetable.ts`, `ics.ts`, `berlin.ts`: dates in Europe/Berlin, the weekly plan, `stundenplan.md`.
- `extract.ts` + `ingest/local-docs.ts`: one ingest pipeline (pdf-inspector for PDF, AnyDoc for the rest, both lazy-loaded).
- `search-corpus.ts`: `corpus.jsonl` and `materials.json`. `search.ts`: offline BM25 over the corpus and the content markdown.

**CLI** (`packages/cli/src`)

- `cli.ts`: the entry point only (`buildProgram().parseAsync()`).
- `program.ts`: `buildProgram()` — global flags, the Commander exit hook (usage errors → exit 2 / JSON), help order (`HELP_ORDER`). No side effects at import; tests and the docs generator build the tree the same way.
- `commands/*.ts`: one module per area, each with a `register…(program)` function listed in `commands/index.ts`. Every action is wrapped in `act()`:
  - `auth.ts`: login, logout, status, session import (`runLogin`)
  - `workspace.ts`: onboard, init, studium, klausuren, module
  - `courses.ts`: courses list/show, files tree/download
  - `sync.ts`: sync, extract, index, view, export calendar, watch
  - `setup.ts`: setup *, update · `config.ts` · `schema.ts` · `legacy.ts` (semesters, discover)
  - `doctor.ts`: a registry of checks (`DOCTOR_CHECKS`, each `{id, status: ok|warn|fail|skip, detail, fix}`). Network checks share a 3 s budget and are skipped with `--offline`; a new check needs a fix string for warn/fail.
  - `api.ts`: routes, api
  - `semester.ts`: semester, semester start, changes
  - `search.ts`
  - `communication.ts`: news, inbox, outbox, message, forum, blubber, feed
  - `content.ts`: courseware, tasks, wiki
  - `context.ts`
  - `planning.ts`: today, week, stundenplan, holidays
  - `catalog.ts`, `people.ts`, `sprechstunden.ts`
- `pipeline.ts`: `runSync`, **the one sync pipeline** for `sync`, `semester start`, `init` and `onboard`. It runs files → studium overview → news/forum → courseware/wiki/tasks → `stundenplan.md` → extraction and search index → `.imstudium/changes.jsonl`, `NEW.md`, `abgaben.md`, `.imstudium/tasks.json` → `snapshots/studium.json`.
- `kit/args.ts`: the shared flags (`-o, --output` = workspace, `-n, --limit`, `--since`, `--course`), strict `parseLimit`, one duration grammar (`parseDuration`/`parseSince`), `workspaceDir()`. `kit/format.ts`: the one human-output formatter — dates always in Europe/Berlin (`berlinDate`, `berlinDateTime`, `berlinWeekday`, …), `cell`/`table`/`courseLabel`. Don't call `toLocale*String` in commands.
- `runtime.ts` (`getSdk`, `output`, `act`, `fail`), `course-arg.ts` (course resolution: `resolveCourse`, `workspaceCourse`, `currentCourses`, `perCourse`, `courseDir`), `setup.ts` and `agents.ts` (harness wiring), `skills/` (bundled skills).

**MCP** (`packages/mcp/src`)

- `tools.ts`: tool definitions
- `cli-bridge.ts`: the `imstudium` door (`READ_ONLY_COMMANDS` allowlist, blocked flags)
- `index.ts`: the server

### Conventions

- Every CLI `--json` output carries `schemaVersion: "1"` and matches its schema in `@imstudium/contract` (`imstudium schema <command>`). Type new payloads against the contract (`const payload: TodayOutput = …`); a new key is additive, a removed or retyped key is breaking.
- Errors are `ImstudiumError(message, code, status?, hint?, details?)`. The code must be in the table in `packages/contract/src/errors.ts` (a test scans every throw site); the exit code, `retryable` and the default hint come from there. After changing the table run `bun run docs` (regenerates docs/ERRORS.md; `bun run docs:check` and the test suite fail on drift).
- **Read-only by default.** New Stud.IP calls are GETs. Anything that writes goes behind `--write` and stays off the MCP allowlist. Check reads for side effects before using a route (see [docs/API.md](docs/API.md)):
  - `/forum-discussions/{id}/postings` marks threads read
  - `GET /courseware-structural-elements/{id}` stores the last-visited page
- Workspace writers are idempotent (content hash in frontmatter) and keep a `## Student notes` section across rebuilds. Resolve folders from `course.path`.
- Exam dates parsed from course text stay `confirmed: false`.
- `content.md` is markdown, not LaTeX. Don't reintroduce poppler, Tesseract, LibreOffice or cloud parsing.
- Messages are never written into the workspace. `people` counts students and never names them. `snapshots/studium.json` holds counts and dates only.

### Tests and validation

- Vitest, `packages/*/src/**/*.test.ts`, next to the code.
- **Synthetic fixtures only** (`packages/sdk/src/test/*-fixtures.ts`). Never put real course content, names, messages or grades in tests, docs, issues or commits.
- `bun run validate` runs typecheck, build and tests, and must pass before you propose a change.
- `docs/COMMANDS.md` and `docs/ERRORS.md` are generated (`scripts/gen-docs.ts`). After changing a command, an option, a contract schema or the error table run `bun run docs`; `scripts/docs.test.ts` and CI (`bun run docs:check`) fail on drift. Intended `--help` changes also need `vitest -u` for the help snapshot.
- Build and check commands with `bun run build`, then `node packages/cli/dist/cli.js <command> --help`.
- CLI integration tests use `packages/cli/src/test/harness.ts`: a synthetic workspace, a throwaway `HOME`, the file session store and a preload that fails every network call.
- Never commit anything from `~/Studium`, `~/.config/imstudium` or `~/.local/share/imstudium`.

User-facing changes go in [CHANGELOG.md](CHANGELOG.md), plus the README, [docs/](docs/) and the bundled skills when behaviour changes.
