# Changelog

All notable changes to ImStudium.

## [Unreleased]

Written work: a citation registry per Hausarbeit, Seminararbeit or thesis that checks every source, formats in the Lehrstuhl's style and holds the manuscript against the Formvorgaben ([docs/ARBEITEN.md](docs/ARBEITEN.md)).

### Added

- **`imstudium arbeit`**: an Arbeit is a folder (`~/Studium/arbeiten/<slug>/`, or any LaTeX/Typst project with `--dir`) with type, deadline, length, course, style, Formvorgaben and an agent brief `ARBEIT.md`.
  - `new`, `list`, `show`, `use`, `set`
  - `formvorgaben [set|preset]`: margins, type, spacing, numbering (decimal, alphanumeric, juristisch), Deckblatt, parts, declaration. Presets: standard, apa7, geisteswissenschaft, juristisch, technik
  - `leitfaden`: finds the Leitfaden in the synced course files
  - `hilfsmittel [add|rm]`: the list of AI and other aids for the declaration
  - `vorlage`: templates for Word (.docx), LaTeX (KOMA-Script + biblatex), Typst and Pandoc that follow the Formvorgaben
  - `check`: the manuscript (.docx with Zotero/Mendeley fields, .md, .tex, .typ) against the registry and the Formvorgaben, exit 1 on failure
- **`imstudium quellen`**: the registry, CSL-JSON with origin and check status per source. Every change regenerates `quellen.bib` for LaTeX, Typst and Pandoc.
  - `add` by DOI (doi.org content negotiation), ISBN (DNB, then Open Library), arXiv id or URL, or `--manual`
  - `import` from BibTeX/BibLaTeX (Zotero, Better BibTeX keys kept, JabRef), RIS (Citavi, EndNote, Mendeley) and CSL-JSON; `export` to all four formats
  - `check` against doi.org, Crossref and the DNB. It flags DOIs that do not exist, details that do not match and retracted works (Crossref `updated-by`, Retraction Watch included). `--offline` checks completeness and duplicates only
  - `find`: the real work behind a half-remembered or AI-suggested reference (Crossref search)
  - `kurs`: DOIs and ISBNs named in a course's extracted material
  - `show`, `edit`, `rm`, `list`
- **`imstudium zitieren <key>@<Seite>`** and **`imstudium literatur`**: citations (in-text, or the footnote with first, later and ebd. forms) and the Literaturverzeichnis through citeproc-js, the processor Zotero uses. Output as text, markdown, HTML or RTF.
- **`imstudium stile`**:
  - Twelve CSL styles ship in `@imstudium/sdk`: APA, DGPs, Chicago notes and author-date, Harvard, MLA, IEEE, ISO 690, DIN 1505-2 (author-date and numeric), Vancouver and the juristische Zitierweise
  - `stile find` searches the CSL repository's ~10,000 styles
  - `stile add` copies one into the Arbeit (dependent styles bring their parent)
  - `stile show` renders examples
- Contract schemas for `arbeit`, `arbeit show`, `arbeit check`, `quellen`, `quellen add`, `quellen import`, `quellen check`, `zitieren`, `literatur` and `stile`; error codes `ARBEIT_MISSING`, `ARBEIT_AMBIGUOUS`, `SOURCE_NOT_FOUND`, `STYLE_NOT_FOUND`, `METADATA_NOT_FOUND`, `METADATA_UNAVAILABLE`, `IDENTIFIER_UNRECOGNIZED`, `IMPORT_FAILED`.
- The MCP door opens the reading commands: `arbeit`, `arbeit show`, `arbeit check`, `quellen`, `quellen check`, `quellen find`, `quellen kurs`, `zitieren`, `literatur`, `stile`. Adding, importing, editing and templates stay in the terminal.
- Skill `imstudium-arbeiten`: the workflow for agents, with the rules that the text stays the student's, only checked sources from the registry are cited, and AI use is declared. `llms.txt` points at `arbeiten/`.

### Dependencies

- `@imstudium/sdk` depends on `citeproc` (citeproc-js, CPAL-1.0 or AGPL-3.0, unmodified, loaded only when formatting) and ships `csl/` (styles and locales, CC BY-SA 3.0).

## [0.2.0] - 2026-10-26

"Semester start": the whole Stud.IP within reach of one CLI, with a workspace that knows what's new, what's due and which semester it is.

### Security

- **The MCP door parses like the CLI.** `imstudium` (MCP) resolves its arguments with the CLI's own Commander tree (option arity, aliases, `--x=y`, attached and combined short flags) and allows only read-only leaf commands. It refuses `--instance` and every option that writes or redirects (`-o/--output`, `--workspace`, `--dir`, `--ics`, `--save`, `--force`, `--write`, `-X/--method`, `-d/--data`) wherever it appears, plus `login`, `logout`, `setup`, `sync`, `semester start` and `files download`. Before, only the first two words were checked and `today --instance <url>` sent the session to that URL.
- **A session only goes to the Stud.IP that issued it.** Sessions are stored with their origin (keychain account `session:<origin>`); the client refuses to attach the cookie or token to any other origin (`SESSION_ORIGIN_MISMATCH`, nothing is sent). Sessions saved by 0.1.x are moved once to the configured `instanceOrigin`.
- **No session, no request.** Signed out, the client throws `AUTH_REQUIRED` before any network call (only public routes such as `discovery` go out).
- **MCP tool `imstudium_sync` removed.** A full sync over MCP downloaded files and rewrote the workspace on an agent's say-so; it is a terminal step now (`imstudium sync`). `imstudium_sync_dry_run` stays.
- **Releases with provenance, no npm token.** Tags `v*` publish from `.github/workflows/release.yml` through npm trusted publishing (OIDC) in dependency order contract → sdk → cli → mcp; the job fails unless npm shows a provenance attestation for each package. The token-based `publish.yml` is gone.
- **Session store order:** ImSicheren (when installed), then the OS keychain, then `~/.config/imstudium/session.json` (mode 0600). No plaintext copy is left next to a secure store.
- **Credentials:** silent renewal never types credentials; it works only while the university IdP still remembers you.
- **Read-only by default:** `imstudium api` refuses non-GET methods without `--write`, and the MCP door refuses `--write`, `--save` and every command outside its allowlist.
- **Reads without side effects**
  - Forum postings are read via `include` (`/forum-discussions/{id}/postings` would mark threads read).
  - Courseware avoids `GET /courseware-structural-elements/{id}`, which stores your last-visited page.
  - Reading messages never marks them read.
- **Personal data:** messages are never written into the workspace; `people` counts students and never names them; `snapshots/studium.json` holds no titles, names or ids.

### Added

- **`@imstudium/contract`** (new package, MIT): zod schemas for every documented `--json` output (`context`, `today`, `week`, `holidays`, `tasks`, `courseware`, `news`, `inbox`/`outbox`, `forum`, `search`, `changes`, `klausuren`, `semester`, `semester start`, `sync`), the error document, and the `imstudium/source/v1` feed shapes (discovery, item, page, ingest). The CLI and MCP type their payloads against it, so a drift fails the build.
- **`imstudium schema [command]`** prints the JSON Schema of a command's `--json` output (`imstudium schema today`, `imstudium schema "semester start"`, `imstudium schema feed.FeedItem`); without an argument it lists them. The contract loads only for this command, so startup stays fast.
- **[docs/COMMANDS.md](docs/COMMANDS.md)**, generated from the Commander tree and the contract: every command, argument, option and default, and the top-level keys of each `--json` output. `bun run docs` regenerates it (and docs/ERRORS.md); `bun run docs:check` and the test suite fail on drift, and CI runs it.
- **`imstudium doctor` overhaul.** One check per concern, each with a status (ok · warn · fail · skip), a detail and the command that fixes it: Node, CLI/SDK/contract/MCP versions, npm update, instance config, session store (keychain / ImSicheren / plain file flagged as the weak tier) and whether Stud.IP still accepts it, OAuth, the route catalog, workspace and last sync, semester rollover, search index, ingest engines, agent skills and the MCP door (configured command still exists). `--offline` makes no network call (about 70 ms); online checks run in parallel with a 3 s budget instead of two sequential 10 s npm lookups. `--json` follows `imstudium schema doctor`. Exit 1 when a check fails.
- `SDK_VERSION` and the MCP server version are read from package.json instead of hard-coded strings.
- **One error table** ([docs/ERRORS.md](docs/ERRORS.md), generated): every failure has a stable `code`, an exit code, a default hint and `retryable`. The CLI, the MCP server and the SDK all read it.
- `IMSTUDIUM_SESSION_STORE=file` keeps the session in the 0600 file only (no keychain, no ImSicheren) — for tests, CI and headless machines.
- **`imstudium context`** gives the whole study picture in one call: the semester and its week, today's dates, open Abgaben, Klausuren, new files, recent news and the next sensible command. It works from local files first; `--live` also counts unread messages.
- **Semester lifecycle**
  - `imstudium semester` compares the term Stud.IP is in with your workspace.
  - `imstudium semester start` archives the previous semester folder to `archive/<slug>/` (nothing is deleted, search refs are rewritten) and syncs the new one.
  - `imstudium changes --since 7d` lists new and updated files.
- **Time:** `today`, `week [--next]`, `stundenplan [--save]` and `holidays`. They show course cycles, single dates and cancellations in Europe/Berlin time, and `--offline` reads `calendar.ics`.
- **Communication** (read-only)
  - `news` (course or `--global`, `--save`), `inbox [--unread]`, `outbox`, `message <id>`
  - `forum [course] [--discussion] [--save]`, `blubber`, `feed` (activity stream)
- **Learning content**
  - `courseware` / `cw` (units, page outline, `--save` as markdown plus block files)
  - `tasks [--open]` (courseware deadlines, soonest first)
  - `wiki [course] [page] [--save]` (the whole wiki as a linked markdown tree)
  - an improved `files tree <course>` with sizes and change dates
- **`imstudium search <words>`** is a ranked offline search (BM25) across extracted materials, news, forum, courseware and wiki. It folds umlauts, takes `--course` and `--kind`, and `--archive` adds past semesters.
- **People & planning**
  - `people [course]` lists lecturers, tutors and groups; students are only ever counted.
  - `sprechstunden` shows upcoming office hours and free slots; booking stays in Stud.IP.
  - `catalog search|areas|modules|studies` covers the Vorlesungsverzeichnis, study areas, MVV modules and Studiengänge. Course search and study areas work without login.
- **Any Stud.IP route**
  - `imstudium routes [topic]` lists the instance's JSON:API catalog, cached weekly from the public `/discovery`.
  - `imstudium api <path>` calls any route with `--include`, `--filter`, `--fields`, `--limit`, `--all` and `--flat`. `/users/me/…` expands to your id.
- **Sync**
  - `sync` now also writes, per course, `news/`, `forum/`, `courseware/` and `wiki/`, plus `calendar.ics` and courseware tasks.
  - Each sync writes `NEW.md`, `abgaben.md` and `stundenplan.md` at the root, along with `.imstudium/changes.jsonl` (new/updated log) and `.imstudium/tasks.json`.
  - `sync --all-semesters` puts the current semester at the root and the rest under `archive/`.
  - `snapshots/studium.json` carries counts and dates only, for Echo and dashboards. `imstudium module` and the `studium_modules` MCP tool read the same numbers.
- **MCP `imstudium` tool:** a read-only door to every CLI command (allowlist), returning the same JSON as `imstudium --json <args>`. Writes are refused. The server identifies as `imstudium 0.2.0`.
- **Skills:**
  - `imstudium-agent`, the session playbook (`context` first, which command answers what, never write unasked)
  - `imstudium-datenschutz`, DSGVO and UrhG rules
  - a full command map in `imstudium-cli`
- **SDK**
  - `flatten()` and `Included` for JSON:API resources, plus `htmlToText` for Stud.IP HTML
  - one frontmatter dialect for news, forum, courseware and wiki markdown
  - `syncContent` and `syncCommunication` hooks per course
- **Tests:** courseware, wiki, file tree, communication, schedule/ICS, people, catalog and consultations. All run on synthetic fixtures.

### Changed

- **Consistent flags.** `-o, --output <dir>` is the workspace on every command that reads it (now also `today`, `week`, `stundenplan`, `setup mcp|migrate|all`; `--workspace` stays as a hidden alias there). `-n, --limit <n>` everywhere a list is cut (`news`, `inbox`, `outbox`, `forum`, `blubber`, `feed`, `search`, `catalog`, `api`; new on `changes` and `tasks`), and a bad value is an error instead of a silent default. `--course <name>` works on every course command, also those that take a `[course]` argument (`news`, `forum`, `blubber`, `courseware`, `tasks`, `wiki`, `people`, `sprechstunden`), and resolves shortcuts the same way everywhere (`changes --course nlp` now works).
- `context --since <when>` replaces `--days <n>` (still accepted), and `context --offline` makes no Stud.IP call at all.
- `watch --interval` uses the same duration grammar as `--since` (`30m`, `30min`, `1h`); bad input is an error (it silently became 1 h). `watch --json` prints one JSON line per round.
- `--help` lists commands in the order of a student's day (start → today → what's new → material → workspace → API → setup).
- Human output: every date is formatted in Europe/Berlin by one kit (task deadlines used the laptop's zone). `config show`, `status`, `courses show` and `discover` now print text without `--json` (they printed nothing). `courses show` resolves shortcuts like the other commands. `login --json` prints exactly one JSON document; sign-in prompts go to stderr.
- Internals: `cli.ts` (1,234 lines) is now a 5-line entry point; commands live in `commands/*.ts`, assembled by `program.ts`.

- **`@imstudium/sdk` exports a named, intentional surface** (121 runtime exports, was 311 via 38 `export *`). HTML/UI helpers (`escapeHtml`, `designSystemStyles`, login-helper pages), normalisers, cache and login plumbing are internal now. Everything the CLI and MCP use stays exported; a snapshot test pins the list. If you imported something that is gone, open an issue.
- **Exit codes** follow the error table: 0 ok · 1 internal · 2 usage · 3 gated · 4 auth · 5 not found · 6 offline · 7 Stud.IP error · 8 workspace (was always 1).
- **Error codes merged** (old code kept as `legacyCode` for one minor): `NO_SESSION`/`NOT_LOGGED_IN`/`SESSION_EXPIRED` → `AUTH_REQUIRED`; `NO_WORKSPACE`/`NO_COURSE_DIR`/`NOT_IN_WORKSPACE` → `WORKSPACE_MISSING`; `MISSING_ARG`/`INVALID_KEY` → `BAD_ARGS`; `NO_SEMESTER` → `SEMESTER_NOT_FOUND`; `NO_ROUTE(S)` → `ROUTE_NOT_FOUND`; `HTTP_ERROR`/`API_ERROR` → `UPSTREAM_ERROR` (HTTP 401 → `AUTH_REQUIRED`, 404 → `NOT_FOUND`). Stud.IP's own error code moves to `details.upstream.code`.
- The JSON error body gains `retryable` and `exitCode`.
- Usage errors (unknown command, missing argument) exit 2 and, under `--json`, print the JSON error body instead of Commander's plain text.
- MCP: every curated tool failure returns the error body with `isError: true` (was a successful text result).
- **One course resolver, no guessing.** Every `[course]`/`--course` argument and the MCP course tools go through `resolveCourseQuery` (SDK; id, alias, course number, slug, title fragment; exact beats fragment). Several matches throw `COURSE_AMBIGUOUS` with `details.candidates` instead of silently taking the first; the only tie-breaks are "exactly one in the focus semester" and "the same title in several terms → newest". SDK: new `resolveCourseQuery`, `resolveWorkspaceCourse`; `pickCourse` is deprecated (now throws `COURSE_AMBIGUOUS` too).
- **Resilient client**
  - per-request timeouts (30 s JSON, 10 min downloads)
  - retries with backoff on network errors, 429 (honours `Retry-After`) and 5xx
  - a request gate of 6 in flight, typed JSON:API queries, and pagination that keeps `included`
- **Auth**
  - Being offline never logs you out. Only a definite rejection (401 or a login page) clears the session.
  - The session check is lazy, so `createSdk` makes no network call.
  - An expired session is renewed once, headless, from the isolated login profile.
  - The first browser sign-in window stays open for 10 minutes, enough for MFA.
- **Sync**
  - The default layout is now `tree`, mirroring Stud.IP folders.
  - The default include is `calendar,wiki,news,forum,courseware,tasks`.
  - One broken course no longer stops the sync; errors are reported per course.
  - Moved files are moved, not downloaded again.
  - 4 downloads run in flight.
- **Single ingest pipeline:** pdf-inspector for PDFs, AnyDoc for Office.
  - Removed Tesseract, poppler, LibreOffice, unzip XML and cloud `/v2/parse` fallbacks.
  - Both native engines load on first use.
  - Extraction slugs include the folder (`Übungen/Blatt01` and `Lösungen/Blatt01` no longer collide).
- **CLI-first setup:** `setup all` installs skills (and workflows) only, and MCP is opt-in via `imstudium setup mcp`.
- **MCP setup** writes where each harness reads:
  - Claude Code through `claude mcp add-json -s user`
  - Codex via `[mcp_servers.imstudium]` in `config.toml`
  - Windsurf via `mcp_config.json`
  - OpenCode via `opencode.json`
  - Cursor and Claude Desktop via their JSON files
- **Course resolver:** every command takes a title fragment, slug, number or id for a course.
- **Cache:** semesters (daily) and holidays (weekly) come from a small disk cache, with a stale fallback when offline.
- **`llms.txt` and `STUDIUM.md`** point agents at `imstudium context --json`, `NEW.md`, `abgaben.md`, `stundenplan.md`, `imstudium search`, the content folders and `archive/`.
- **Repository** moved to [github.com/ImStudium/imstudium](https://github.com/ImStudium/imstudium).
- **Toolchain:** TypeScript 6 with the native compiler preview.
- **Docs:** README, AGENTS.md, docs/API.md (Stud.IP 6.1.2 capability matrix) and docs/STUDIUM.md rewritten for 0.2.0.

### Fixed

- `today --offline` and `week --offline` no longer ask Stud.IP for holidays; they use the cached list or none.
- Course schedules in `studium.json` were always empty. `/users/{id}/schedule` rejects `page[...]`, and a cycle's course is its `owner`.
- Exam dates are now read from Stud.IP 6 course events (`categories`, `start`, `is-cancelled`). Courses whose name contains an exam word no longer flag every date.
- The `curl | bash` installer failed when piped; its helpers are now inline.
- A missing native build of pdf-inspector or AnyDoc no longer crashes every command and the MCP server.
- A login page returned instead of JSON is reported as `SESSION_EXPIRED`, not an opaque invalid response.
- A failed silent renewal now waits 30 minutes before the next attempt instead of costing ~10 s on every command.
- A denied OAuth consent no longer waits out the timeout.

## [0.1.3] — 2026-07-04

### Added

- `extraction-guidance.ts` — single source of truth for agent extraction limits
- `searchGuidance.extractionLimits` on `studium_overview` (no LaTeX, OCR limits, page PNGs mandatory)

### Changed

- Skills, AGENTS.md, llms.txt, and MCP tool hints document formula/OCR limitations
- Fix npm `bin` paths (`dist/cli.js` without `./`)

## [0.1.2] — 2026-07-04

### Fixed

- Publishable package deps (`^0.1.2` instead of `workspace:*`) so `npx @imstudium/cli` installs correctly

## [0.1.1] — 2026-07-04

### Added

- Legacy DigiCampus migration — auto-copies config, session, sync state; `imstudium setup migrate`
- `scripts/link-global.sh` — reliable global CLI install from source (Bun workspaces)
- npm publish workflow on GitHub release
- Install script: npm-first with GitHub source fallback + auto-migrate on install

### Changed

- Agent setup removes legacy `digicampus` MCP entries and `digicampus-*` skills
- MCP server accepts `DIGICAMPUS_WORKSPACE` env during transition
- Dev install links `imstudium` wrappers into `~/.local/bin`

## [0.1.0] — 2026-07-03

### Added

- Semester-aware sync — defaults to current term; `{semesterSlug}/{course}/` layout with `course.path` in `studium.json` (schema v2)
- Page search index — per-course `search/corpus.jsonl` with stable `ref` citations; `imstudium index` to rebuild
- `llms.txt` workspace entry point for agents (navigation + native search guidance)
- `studium_overview` returns `searchGuidance` — agents use grep/semantic search, not a custom search tool
- Vitest unit tests for setup, agents, and search corpus
- **Extraction harness** — all file types → agent-readable text + page images
  - PDF: poppler text per page + PNG per page
  - PPTX/DOCX/XLSX/ODP: LibreOffice → PDF pipeline, or built-in XML text fallback
  - Images copied to `pages/`, text/code passthrough
  - Tesseract OCR fallback for scanned PDFs and photos (deu+eng, `IMSTUDIUM_OCR_LANG` override)
  - Incremental (mtime+size manifest), `imstudium extract`, `sync --extract`, `doctor`
  - MCP `studium_read_material` — returns text + `pageImages` PNG paths for visual comprehension
- `@imstudium/sdk` — Stud.IP JSON:API client, pagination, file download
- Login via OAuth-ready auth manager, with local helper fallback for Shibboleth + MFA
- Session storage (OS keychain + file fallback)
- `SyncEngine` — flat/tree file sync, wiki/news/calendar export, incremental state
- `StudiumBuilder` — `studium.json`, `STUDIUM.md`, `klausuren.md`, per-course `COURSE.md`
- `imstudium` CLI — init, login, sync, studium, klausuren, discover, watch
- `@imstudium/mcp` — 9 study-planning tools for all agent harnesses
- Global `--json` output with `schemaVersion: 1`
- CI workflow, AGENTS.md, API/STUDIUM/OAUTH docs

### Changed

- **Rebrand:** DigiCampus Studium OS → **ImStudium** — `@imstudium/cli` (bin: `imstudium`), `@imstudium/sdk`, `@imstudium/mcp`, `~/.config/imstudium`, `IMSTUDIUM_*` env, `imstudium_*` MCP tools
- Monorepo tooling is Bun-only (lockfile, CI, dev scripts). End-user install via `npx @imstudium/cli` unchanged.
- MCP and CLI no longer ship duplicate keyword search — harness-native search on `corpus.jsonl`
- Consumer docs refreshed (`README`, `docs/STUDIUM.md`, skills)

### Known gaps

- OAuth2 PKCE requires university-registered client
- Courseware plugin files not in JSON:API (Stud.IP 5.4)

[0.2.0]: https://github.com/ImStudium/imstudium/releases/tag/v0.2.0
[0.1.3]: https://github.com/ImStudium/imstudium/releases/tag/v0.1.3
[0.1.2]: https://github.com/ImStudium/imstudium/releases/tag/v0.1.2
[0.1.1]: https://github.com/ImStudium/imstudium/releases/tag/v0.1.1
[0.1.0]: https://github.com/ImStudium/imstudium/releases/tag/v0.1.0
