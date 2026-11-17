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
| A Hausarbeit or thesis | `imstudium arbeit show` (or read `arbeiten/<slug>/ARBEIT.md`) · `imstudium quellen` · `imstudium arbeit check <manuskript>` |
| Is this reference real? | `imstudium quellen find "<Autor Titel Jahr>"` · `imstudium quellen check` |
| Cite, Literaturverzeichnis | `imstudium zitieren <key>@<Seite>` · `imstudium literatur` (the Arbeit's CSL style) |
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

- `content.md` comes from pdf-inspector (PDF) and AnyDoc (Office) on the student's machine. Its prose is markdown, not LaTeX: inline math keeps garbled sub- and superscripts (`x<sub>i</sub>`).
- With `imstudium setup ocr`, scanned pages are read by on-device OCR (the header says `on-device OCR on N page(s)`). Pages it read poorly carry `_(read by OCR with low confidence — check the original)_`. Without it, they are marked `_(image-only page — no text layer)_`. A slide that is mostly a picture keeps its own title and labels, marked `_(mostly an image: only the page's own text is above, the image itself is not read)_`.
- With `imstudium setup ocr --math`, display formulas follow their page as `$$…$$` blocks under `_Formulas on this page, read on this machine as LaTeX …_`. `math.json` lists each with its page, box and check, and `formulas/<id>.png` is its image. They are model output: a wrong exponent or a dropped term changes the meaning.
- Every formula is checked on the machine. On born-digital pages its letters and digits must be the ones the PDF has in that box. A formula that fails gets `_(formula p3-2 needs a look: …)_`, and a scanned one gets `_(formula p3-2 unchecked: …)_`.
- Before you write formulas down for a student, follow the formula procedure in the `imstudium-visual` skill:
  - `imstudium formulas list <file>`
  - look at the image of every formula you write down, flagged and unchecked ones first, and transcribe only what it shows (a passing check proves the letters and digits, not where they sit)
  - `imstudium formulas check <file> <id> --latex '…'`
  - and, when the student wants corrected notes, `imstudium formulas fix`, which refuses a correction that doesn't check
- For diagrams, open the original in `files/`. Never invent math from the markdown, from memory or from what a formula usually looks like.
- Lecture recordings (audio and video) get a transcript in `## hh:mm:ss` sections of about two minutes: on-device after `imstudium setup speech` (Parakeet TDT 0.6B v3, ffmpeg on `PATH`), or read from a `transcript.json` another runner left, whatever its model. The header names the model and says whether it ran on this machine. A search hit's citation ends with the section's start time: cite the minute, and treat the text as model output (names, numbers and formulas especially).

### MCP (opt-in)

`imstudium setup mcp` wires the `imstudium-mcp` server. Its main tool is **`imstudium`**, a read-only door to every CLI command. `{"args": ["context"]}` returns the same JSON as `imstudium --json context`.

The door refuses anything that writes:

- `--write`, `--save`, `-X`/`--data`, `--force`
- `semester start`, `files download`
- every command outside its allowlist (`login`, `setup`, `sync`, …)

The workspace tools are still there: `studium_overview`, `studium_klausuren`, `studium_course_brief`, `studium_find_materials`, `studium_read_material`, `imstudium_sync_dry_run`, `imstudium_list_courses`, `imstudium_whoami` and `studium_modules`. A sync runs only in a terminal (`imstudium sync`).

### Never

- Write to Stud.IP (`imstudium api … --write`, posting, messaging, booking) unless the student explicitly asks for that exact change.
- Run `semester start`, `sync`, `--save` or `setup` without being asked. They change the student's workspace or config.
- Handle the university password, print the session, or copy anything from `~/.config/imstudium`.
- Paste messages, grades, Matrikelnummer or classmates' names anywhere outside the session. Don't upload `~/Studium` content anywhere. Course material is licensed for the student's own studies (UrhG §60a). See the `imstudium-datenschutz` skill.
- Hand in solutions to current Übungsblätter as the student's own work. Explain, quiz, and give hints and worked examples of *similar* problems instead.
- Write text for a Hausarbeit or thesis, invent a source, or cite one that is not in the Arbeit's registry. Find, check and format sources; discuss structure; the text is the student's (`imstudium-arbeiten` skill).

### Plugin (Claude Code, Codex)

`plugins/imstudium/` is one plugin for both: skills, slash commands (`/imstudium:today`, `:week`, `:catchup`, `:klausur`, `:explain`, `:quiz`, `:sync`, `:doctor`), the `studium-tutor` subagent, a SessionStart hook that adds the offline briefing inside a workspace, and the MCP door. Install with `claude plugin marketplace add ImStudium/imstudium` or `codex plugin marketplace add ImStudium/imstudium`. Use the plugin *or* `imstudium setup all` per harness, not both.

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
- `imstudium-arbeiten`: written work, the citation registry and the check before the Abgabe
- workflows `imstudium-klausur-prep`, `imstudium-semester-refresh` and `imstudium-study-session`

Paths:

- setup manifest: `~/.config/imstudium/setup-manifest.json`
- workspace: `~/Studium`. `IMSTUDIUM_WORKSPACE` overrides `config.json` for one process (so do `IMSTUDIUM_ORIGIN` and `IMSTUDIUM_BASE_URL`) and is never saved

## Part 2 — Working on this repository

### Architecture

Bun workspaces, four packages. Only `@imstudium/sdk` is published, with the CLI and the MCP server bundled inside (`scripts/assemble-sdk.ts`); contract, cli and mcp are private.

| Package | Owns |
|---|---|
| `packages/contract` (`@imstudium/contract`, private) | zod schemas for every CLI `--json` output, the error document and the `imstudium/source/v1` feed. Types only on hot paths; values (zod) load lazily |
| `packages/sdk` (`@imstudium/sdk`, published) | Stud.IP client, auth, resources, sync, workspace writers, extraction, search. No Commander. `src/index.ts` names every public export (no `export *`); `surface.test.ts` pins the list |
| `packages/cli` (`@imstudium/cli`, private) | Commander commands, `--json` output, agent setup, bundled skills. No raw `fetch` to Stud.IP; everything goes through the SDK |
| `packages/mcp` (`@imstudium/mcp`, private) | MCP server: tool definitions and the CLI door |

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
- `extract.ts` + `ingest/local-docs.ts`: one ingest pipeline (pdf-inspector for PDF, AnyDoc for the rest, both lazy-loaded). Recordings go through `ingest/transcript.ts` (the `transcript.json` cache, sections, `content.md`) and `ingest/speech.ts` (the on-device runtime and engine).
- `search-corpus.ts`: `corpus.jsonl` and `materials.json`. `search.ts`: offline BM25 over the corpus and the content markdown.
- `arbeit/`: written work and its citation registry. `store.ts` (Arbeit folders, `quellen.json`, regenerated `quellen.bib` and `ARBEIT.md`), `identifiers.ts` and `citekey.ts`, `resolve.ts` (doi.org, Crossref incl. retractions, DNB SRU, Open Library, web meta tags; `fetch` injectable), `bibtex.ts` and `interchange.ts` (BibTeX/BibLaTeX, RIS, CSL-JSON), `styles.ts` and `format.ts` (CSL through citeproc-js, loaded lazily; bundled styles and locales in `packages/sdk/csl/`), `formvorgaben.ts`, `manuscript.ts` (md, tex, typ, docx), `check.ts`, `vorlage.ts` (docx, LaTeX, Typst, Pandoc), `course.ts` (literature and the Leitfaden in course files). Tests use synthetic sources (DOI prefix 10.5555) and a fake fetch.

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
  - `arbeit.ts`, `quellen.ts`, `zitieren.ts` (zitieren, literatur, stile), with `arbeit-arg.ts` for which Arbeit a command means
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
- Extraction stays on the student's machine with pinned artifacts: pdf-inspector and AnyDoc, plus the optional runtime from `imstudium setup ocr` (PDFium, ONNX Runtime and the PP-OCR models through pdf-inspector; PP-DocLayoutV2 and UniRec-0.1B for `--math`) and from `imstudium setup speech` (sherpa-onnx-node, Parakeet TDT 0.6B v3 int8, Silero VAD; ffmpeg from `PATH` decodes), every download checked against its SHA-256 in `ocr-runtime.ts`, `math.ts` and `ingest/speech.ts` through one installer (`ingest/pinned.ts`). ImStudium never sends a recording anywhere; it only reads a `transcript.json` that a runner outside it wrote (`ingest/transcript.ts`). Don't reintroduce poppler, Tesseract, LibreOffice or cloud parsing, and never send a page to a remote model. Formula LaTeX goes only in `$$…$$` blocks under `FORMULAS_HEADING` and in `math.json`; the prose stays markdown. A change to OCR or math runs `bun run bench` (docs/BENCHMARKS.md) before and after.
- Messages are never written into the workspace. `people` counts students and never names them. `snapshots/studium.json` holds counts and dates only.

### Tests and validation

- Vitest, `packages/*/src/**/*.test.ts`, next to the code.
- **Synthetic fixtures only** (`packages/sdk/src/test/*-fixtures.ts`). Never put real course content, names, messages or grades in tests, docs, issues or commits.
- `bun run validate` runs typecheck, build and tests, and must pass before you propose a change.
- `docs/COMMANDS.md` and `docs/ERRORS.md` are generated (`scripts/gen-docs.ts`). After changing a command, an option, a contract schema or the error table run `bun run docs`; `scripts/docs.test.ts` and CI (`bun run docs:check`) fail on drift. Intended `--help` changes also need `vitest -u` for the help snapshot.
- Build and check commands with `bun run build`, then `node packages/cli/dist/cli.js <command> --help`.
- CLI integration tests use `packages/cli/src/test/harness.ts`: a synthetic workspace, a throwaway `HOME`, the file session store and a preload that fails every network call.
- Never commit anything from `~/Studium`, `~/.config/imstudium` or `~/.local/share/imstudium`.

- `plugins/imstudium/` is partly generated (`scripts/docs/plugin.ts`): both manifests, `.mcp.json`, `skills/` (copied from `packages/cli/skills`, workflows flattened) and the root marketplaces (`.claude-plugin/marketplace.json`, `.agents/plugins/marketplace.json`, `.cursor-plugin/plugin.json`). Edit the sources and run `bun run docs`; `commands/`, `agents/` and `hooks/` are hand-written. `scripts/plugin.test.ts` checks for stale files, frontmatter, versions and the hook. `claude plugin validate .` and `claude plugin validate plugins/imstudium` must pass.

### Stud.IP 5 and 6

Both must work. Stud.IP 6 differs in ways the SDK absorbs:

- The session cookie is `Studip_Session` (5.x: `Seminar_Session`). `SESSION_COOKIE_NAMES` in `login-url.ts` lists both; never hard-code one.
- Some routes (e.g. `/courseware-tasks`) take no `page[…]` parameters and answer 400; `client.paginate` retries those once unpaged.
- Error objects may omit `status`; `parseApiErrors` falls back to the HTTP status.

User-facing changes go in [CHANGELOG.md](CHANGELOG.md), plus the README, [docs/](docs/) and the bundled skills when behaviour changes.
