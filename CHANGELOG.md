# Changelog

All notable changes to ImStudium.

## [Unreleased]

## [0.4.0] - 2026-11-16

Written work: a citation registry per Hausarbeit, Seminararbeit or thesis that checks every source, formats in the Lehrstuhl's style and holds the manuscript against the Formvorgaben ([docs/ARBEITEN.md](docs/ARBEITEN.md)).

Back on npmjs.com: `npm install -g @imstudium/cli @imstudium/mcp --allow-scripts=keytar` needs no login again, and every package carries a provenance attestation. 0.3.0 and 0.3.1 stay on GitHub Packages.

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

### Fixed

- **Search no longer keeps a slide's old text after an agent read it.** Reading a file over MCP (`studium_read_material`) or with `view --course --file` put its text in a second folder that sync never refreshed, so once the lecturer replaced the file, search still found the old pages and `materials.json` could count the old copy. Both now use the folder sync uses. A folder an earlier version left behind stays until it is deleted from `extracted/`.
- **Right after `semester start`, `context` and NEW.md no longer list last semester's files as new.** They list only changes whose file is still where it was; `changes` keeps the full log.
- **Exam dates read as dates.** `klausuren.md` and `imstudium klausuren` say "Mo 15.02.2027, 09:00" (Berlin time) instead of an ISO timestamp.
- `COURSE.md` no longer shows the course type as a bare number from Stud.IP.
- **`setup --agent` with a name it does not know stops and lists the agents**, instead of doing nothing; `--agent claude` means Claude Code. When the `claude` CLI is not on PATH, setup says Claude Code's MCP server is not registered and prints the command to do it, instead of counting it as unchanged.
- **A subcommand's own options count.** `quellen add --arbeit zweite`, `quellen add --tag methode`, `quellen list --status verified`, `arbeit formvorgaben set … --arbeit zweite`, `arbeit new … -o <dir>` and `semester start -o <dir>` were read by the parent command and ignored; on 27 subcommands they now reach the subcommand, and `--tag` on add and edit keeps every tag.
- Offline or signed out, `news`, `forum`, `tasks`, `courseware`, `wiki` and `sprechstunden` say why and exit with that code, instead of "No announcements." and exit 0.
- The offline "Hinweis" lines are German throughout, e.g. "Live-Daten nicht erreichbar (keine Verbindung), Termine aus calendar.ics".
- A mistyped path (`extract --file`, `session import --file`, `-o`, `arbeit new --dir`) is reported as NOT_FOUND or a usage error with the path, not as an internal error asking for an issue.
- `sync --course` with a name no course matches stops with COURSE_NOT_FOUND instead of downloading nothing; so does the MCP tool `imstudium_sync_dry_run`.
- `search --course` with an unknown course names it instead of saying there are no hits.
- An unknown `--semester` stops with SEMESTER_NOT_FOUND; `sync --semester WS1999` filed the semester's files under `current/`.
- `holidays --year` accepts only a year like 2027.
- `quellen import` of a file with no entries fails with IMPORT_FAILED instead of reporting 0 imported.
- `zitieren` refuses a page below 1; `--seite=-1` printed "S. 1".
- `quellen add --file` and `quellen edit --file` check that the file exists before they store its path.
- `courseware --unit` without a course is refused instead of ignored.
- Ids in Stud.IP routes are encoded, so a message id with backslashes can no longer read another route.
- MCP `imstudium_sync_dry_run` compares against the folder layout `imstudium sync` writes; on a synced workspace it said every file had changed.
- MCP `studium_read_material` needs a file name and cites only a page the file has; page 1000000000 or "abc" returned the whole text cited as that page, and an empty file name read the first file. Its `page` is now an integer of at least 1 in the tool schema.
- Every MCP tool checks its arguments against its schema and answers BAD_ARGS, where `{"args": "today"}` or a number for `course` failed as an internal error. An unknown option to the `imstudium` tool is BAD_ARGS with the command's `--help`, no longer "not allowed".

## [0.3.1] - 2026-11-14

### Fixed

- **0.3.0 could not be installed from GitHub Packages.** That registry drops `peerDependenciesMeta` from a package's manifest, so npm took the optional ImSicheren SDK for a required peer of `@imstudium/sdk` and stopped with a 404 for `@imsicheren/sdk`. The SDK no longer declares it as a peer; it still uses ImSicheren as the session store when it is installed. Install 0.3.1, not 0.3.0.

## [0.3.0] - 2026-11-14

The first release since 0.1.3, and the first on GitHub Packages (`npm.pkg.github.com`) instead of npmjs.com, for now. Installing needs a one-time `npm login` there with a GitHub token that has `read:packages` (README, Get started); npmjs.com keeps 0.1.3. This release also brings everything under 0.2.0 below, which was cut in the repository but never published.

Stud.IP 6 support, a daily sync that never switches semesters on its own, one agent plugin for Claude Code and Codex, and on-device OCR and formula recognition.

### Fixed

- **Text a slide's own text layer gives back is kept.** For pages native extraction left empty, pdf-inspector's OCR call first reads the page's text layer through PDFium and keeps that text when OCR adds nothing (provenance `Native`). The merge dropped every page that didn't come back as OCR, so such slides stayed `_(image-only page — no text layer)_`. They now get that text, counted as recovered (`recoveredPages` in the manifest and the sync summary), not as OCR. Files the old merge read are extracted again once.
- **Slides that are mostly a picture keep their text without OCR.** pdf-inspector rates a page "scanned" when a high-resolution image (a chart or screenshot at about 200 dpi) covers much of it and little text sits beside it, and then returns no text at all, even when the page has a real title and labels. Such pages are now built from their own visible text runs, top to bottom, the largest top line as a heading, and marked `_(mostly an image: only the page's own text is above, the image itself is not read)_`. Text lying on the image, invisible text (OCR layers) and repeated shadow runs are left out. With OCR installed these pages still go to the OCR call, whose reading or PDFium recovery wins unless it reads nothing or reads it unsure. PDFs that still had image-only pages are extracted again once.
- **`setup ocr --math` survives a broken download.** The 734 MB formula model was fetched into memory in one piece, so a connection that broke off ("terminated") lost it all. Downloads now stream to a `.part` file. A break is retried up to five times from where it stopped, and the next run resumes the partial file with an HTTP Range request. Each piece's SHA-256 is recorded once it is verified (`math/verified.json`), so a rerun fetches only what is missing or whose pin changed. A machine that already has the math runtime fetches only the new formula reader (about 729 MB); the layout model, ONNX Runtime and PDFium stay, and the old reader's files, a broken partial included, are deleted.
- **`doctor` names the harness that lacks skills.** With the plugin covering Claude Code and Codex, a missing Cursor install listed every skill as stale. It now says `Cursor: skills not installed` with `imstudium setup all --agent cursor -y`; `setup status` lists missing and outdated skills per harness.
- **The keychain hint works with npm 11.** npm skips keytar's install script unless it is allowed, and `npm install-scripts approve` refuses global installs. `doctor` now says `npm install -g @imstudium/cli --allow-scripts=keytar`, or ImSicheren, and that the session sits in a 0600 file until then. The installer and `imstudium update` pass `--allow-scripts=keytar` themselves.
- **Bold dates in news stay bold.** `<strong> 06.10.2026 … Uhr</strong>` became `** 06.10.2026 … Uhr**`, which markdown shows as asterisks. Whitespace now goes outside the markers, empty ones are dropped, and `<blockquote>`/`<img>` are no longer taken for `<b>`/`<i>`.
- **Sessions reach the keychain.** keytar is CommonJS, and `await import("keytar")` exposes only `getPassword` as a named export (Node's export detection stops at the first function in keytar's `module.exports`). `setPassword` was undefined, so every session went to the plain 0600 file on every OS and Node version, and `doctor` asked students to install keychain support they already had. The session store now takes keytar's default export, and a session left in the file moves to ImSicheren or the keychain on the next command. `doctor` says whether keytar doesn't load or the keychain refused the session, with a fix for each.
- **Workflow skills install under their own names.** `setup` copied them under their folder name (`klausur-prep`) while their frontmatter says `imstudium-klausur-prep`. They now install under the frontmatter name, and `setup` removes the folder-name copies it made before, only where the SKILL.md inside names one of ours.
- **The agent plugin counts.** `setup` and `doctor` read whether the imstudium plugin is installed: Claude Code's `~/.claude/plugins/installed_plugins.json` (an `enabledPlugins` entry set to `false` switches it off) and Codex's `[plugins."imstudium@…"]` in `$CODEX_HOME/config.toml`. For a harness the plugin covers, `setup` installs no second copy of the skills and removes the old standalone ones, `setup status` reports nothing stale, and `doctor` says the skills come from the plugin.
- **`doctor` no longer suggests `semester start` into an empty semester.** The semester check asks Stud.IP for your courses in the new semester, with the same rule as `imstudium semester`: with none yet the workspace stays and the check is ok.
- **`context` speaks one language.** The briefing had German headings and English next-step reasons. The briefing is German throughout, like `today` and `week`; the JSON `next` list stays English for agents.

- **Sign-in on Stud.IP 6.** Stud.IP 6.1 renamed its session cookie from `Seminar_Session` to `Studip_Session`; `imstudium login` waited for the old name until it timed out. Every place that reads, checks, imports or sends the session now accepts both names and sends the one Stud.IP issued. `session import --cookie` asks Stud.IP which name a bare value belongs to.
- **A plain `imstudium sync` stays on your workspace's semester.** It used to follow the calendar, so once a new semester began it re-pointed `studium.json` at that semester — with no rollover and, if you had no courses there yet, an empty overview. Moving to a new semester is `imstudium semester start`'s job; `sync` and `watch` now keep syncing the semester the workspace is on (flags and a pinned `semesterId` still win) and say when Stud.IP has moved on.
- **`semester start` won't archive into an empty semester.** With no courses in the target semester it stops with `NO_ENROLMENTS` before moving anything (`--allow-empty` overrides). `imstudium semester` shows how many courses you have in the running semester and only suggests a rollover when there are some; `context` does the same.
- **Courseware tasks on Stud.IP 6.** `/courseware-tasks` rejects `page[limit]`; tasks failed in every course with "Page parameter limit is not allowed." Paginated reads now retry such routes once without paging.
- **Stud.IP 6 errors keep their HTTP status** when the error object omits it, so a 400 is a 400 (and the "retry without `include`" fallback works again) instead of a status-less upstream error.
- **`IMSTUDIUM_WORKSPACE` beats `config.json`.** A saved `workspacePath` used to override the environment, so launchers such as Echo couldn't point a run at their store. `IMSTUDIUM_WORKSPACE`, `IMSTUDIUM_ORIGIN` and `IMSTUDIUM_BASE_URL` now override the file for that process and are never written back to it.
- **The dry run tells the truth for symlinked workspaces.** A workspace reached through a symlink counted every unchanged file as a download in `--dry-run`; the sync now recognises the same file under both paths.
- **Failed downloads are named.** `sync` lists each failed file with its reason instead of only "1 failed", and never shows Stud.IP's server paths (`…/FileRefsContentShow.php(83)`) — it says the file is probably an external link or a broken upload.
- `imstudium login` names a session-like cookie it doesn't recognise while it waits, so a future rename shows up in seconds instead of after a ten-minute timeout.

### Added

- **Agent plugin for Claude Code and Codex** in `plugins/imstudium/`, with marketplaces at `.claude-plugin/marketplace.json` and `.agents/plugins/marketplace.json`:
  - slash commands `/imstudium:today`, `:week`, `:catchup`, `:klausur`, `:explain`, `:quiz`, `:sync`, `:doctor`
  - the `studium-tutor` subagent: cited answers from your material without file dumps in the main conversation
  - a SessionStart hook that adds the offline briefing when a session starts inside a study workspace (both harnesses run it)
  - the bundled skills and the read-only `imstudium-mcp` door
  - manifests, skills and marketplaces are generated by `bun run docs` from `packages/cli/skills` and checked for drift in CI. The old root `.codex-plugin/plugin.json` is gone (it predated Codex's plugin format); `.cursor-plugin/plugin.json` is generated too.
- **`imstudium-study-session` workflow**: explain from the student's own slides with citations, active-recall questions one at a time, a recap with spaced-review dates.
- **On-device OCR for scanned pages and photos.** `imstudium setup ocr` downloads PDFium, ONNX Runtime and the PP-OCRv6 models (~60 MB) once, pinned by version and SHA-256, unpacks them under `~/.local/share/imstudium/ocr`, and warms them up; `--force` reinstalls, `--remove` deletes. Extraction then sends only pages without a usable text layer to OCR, so born-digital PDFs come out unchanged. Pages read with low confidence are marked `_(read by OCR with low confidence — check the original)_`. Files extracted before OCR was installed are redone on the next `sync --extract`. `sync` and `extract` report the pages read by OCR, `--no-ocr` or `IMSTUDIUM_OCR=off` switch it off, and `doctor` has an `ocr` check. OCR needs Node (Bun can't load the native runtime).
- **Display formulas as LaTeX, on the machine, checked against the PDF.** `imstudium setup ocr --math` adds two models, pinned and checksummed like OCR (~1 GB, once):
  - PP-DocLayoutV2 finds display formulas.
  - UniRec-0.1B reads them, from its authors' ONNX export (Apache-2.0) on the ONNX Runtime the CLI already uses.

  They were chosen on hard Beamer slides. The small layout model missed a quarter of the formulas. Of the formula readers that run fully on a CPU with a licence the CLI can ship, UniRec-0.1B read the most exactly at about a second per formula: on the benchmark's formula crops 69 of 71 born-digital Beamer formulas, 72 of 72 scanned and 47 of 48 on A4, where PP-FormulaNet+ L, pinned before, read 53, 62 and 48. PaddleOCR-VL-1.6 read as many on born-digital slides at about 17 times the time and without a build Node can load; GLM-OCR, TexTeller 3 and pix2text-mfr read fewer (docs/BENCHMARKS.md, "Formula readers compared"). UniRec writes aligned lines as separate display formulas and appends equation numbers; both are cleaned up into one `aligned` block without the number.
  - **content.md** gets each page's formulas after its text as `$$…$$` blocks.
  - **math.json** lists each formula with page, box and check.
  - **`formulas/<id>.png`** is each formula's image.

  Every reading is checked. The LaTeX must be well-formed: no stray characters, empty fraction parts, or a box, brace or bar over the whole formula taken from a Beamer block's frame. On born-digital pages it must also show the letters and digits the PDF has for the formula: none of those in the detector's box dropped, none added that the formula's image doesn't show. Letters count whatever their font: `\mathbf{x}` against the PDF's plain x is a difference in look and isn't marked. Stray `\(`, `\]` or `$` delimiters in a reading are removed before the check. A formula that fails gets a note in content.md saying what differs; scanned ones are marked unchecked, and so are formulas the PDF has as pictures (an image or outlined text covers the box, which holds fewer than half the letters the reading shows), as PowerPoint decks often paste them: `picture: true` in math.json, "the formula is a picture in the PDF" in the note. A formula that is partly a picture (italic letters drawn as outlines, digits and upright words text) is `partial`, partly checked and not marked: the PDF's letters and digits all agree, and the reading has more only where the box has that many letters drawn as shapes, so an invented letter on a text formula is still marked. `formulas list --needs-look` lists only what needs a person (a contradiction, malformed LaTeX, readings that disagreed), `--unchecked` what can't be fully checked. `formulas list` and the extract and sync summary say how many formulas checked against the PDF, how many need a look and how many can't be fully checked.

  Each formula box is read three times, at the page's render scale and at 3/4 and 1/2 of it (288, 216 and 144 dpi on slides). A small decision model then keeps the reading it trusts most: logistic weights over signals already computed, namely the check, KaTeX and the other issues, glyphs the PDF doesn't have, and how far the three readings agree. When some readings pass their check, it chooses among those only. A reading it is unsure of is marked for a look even when its check passed, and the note names what the other readings saw. `math.json` keeps `confidence` and `otherReadings`, and `formulas list --json` shows them. Fitted on UniRec-0.1B's readings and tested leave-one-deck-out on the synthetic decks: born-digital Beamer slides go from 70 to 72 of 72 exactly right and A4 pages from 47 to 48 of 48, scanned slides stay at 72 of 72 and picture-formula slides at 24 of 24, and no wrong reading is left unmarked. Two right readings on the slides are marked for a look, because the other two readings agreed on a wrong one. Math takes about three times as long as with one reading, and files read with one reading per box, or judged before picture formulas were unchecked, are read again once (`math.decision` in the manifest). The SDK exports `decideReading`, `readingFeatures`, `sameMeaning`, `isPictureFormula` (with the `FormulaPdf` type), `READING_FACTORS`, `DECISION_WEIGHTS`, `DECISION_FLAG_BELOW` and `MATH_DECISION`.

  Formulas inside bullets count too: an inline formula taller than 1.3 text lines (`$\displaystyle\frac…$`, sums with limits) or alone in its item is read like a display formula; `$x$` or math inside a sentence stays text. KaTeX must be able to typeset each reading, and a command name without its backslash is caught even when glued to a letter (`Aboldsymbol`). On born-digital pages the check also compares accents (`\hat`, `\tilde`, `\bar`) and vertical bars, so an invented hat or a stray `|` is marked.

  Only pages that may hold math are looked at, and other inline math stays as pdf-inspector reads it. `--no-math` or `IMSTUDIUM_MATH=off` switch it off, and `--remove --math` removes only the math models. Files read with older models are read again at the next extract.
- **`imstudium formulas list | check | fix`**: the formulas of one file with their check and image. `check` judges any reading against the PDF without storing it. `fix` stores a correction made from the image, refuses one that doesn't check, and shows it in content.md marked with who made it. Corrections are kept across re-extraction while the model reads the formula the same way. `list` and `check` are on the MCP door; `fix` is not.
- The `imstudium-visual` skill has a formula procedure for agents: look at the image of every formula it writes down, flagged ones first, transcribe only what the image shows (unreadable symbols become `\text{?}`, nothing is filled in from memory), check, then store or write down with the citation.
- **`bun run bench`**: a reproducible extraction benchmark over synthetic fixtures (prose, slides, formula pages and two hard Beamer decks typeset by pdflatex, each as a born-digital PDF and as a degraded scan), scored by character error rate, word recall and, for formulas, rendered-MathML similarity, with a table of which wrong readings the check lets through. `scripts/bench/agent-eval.ts` measures the agent step: it hands a coding agent a deck with the skill and the CLI, no ground truth, and scores what the agent writes down and stores, including invented formulas and symbols. Results and method are in [docs/BENCHMARKS.md](docs/BENCHMARKS.md).
- `imstudium extract --json` has a contract schema (`imstudium schema extract`), and the SDK exports the OCR and math runtimes, `imageToPdf`/`imagesToPdf` and `convertLocalDocument`.

### Changed

- `imstudium-klausur-prep` and `imstudium-semester-refresh` are CLI-first (the MCP door is the fallback) and plan with what the CLI knows: exam aids and scope from news and courseware, unconfirmed dates flagged, a day-by-day plan ending in a mock exam.

## [0.2.0] - 2026-10-26

Never published: these changes were first released with 0.3.0.

"Semester start": the whole Stud.IP within reach of one CLI, with a workspace that knows what's new, what's due and which semester it is.

### Security

- **The MCP door parses like the CLI.** `imstudium` (MCP) resolves its arguments with the CLI's own Commander tree (option arity, aliases, `--x=y`, attached and combined short flags) and allows only read-only leaf commands. It refuses `--instance` and every option that writes or redirects (`-o/--output`, `--workspace`, `--dir`, `--ics`, `--save`, `--force`, `--write`, `-X/--method`, `-d/--data`) wherever it appears, plus `login`, `logout`, `setup`, `sync`, `semester start` and `files download`. Before, only the first two words were checked and `today --instance <url>` sent the session to that URL.
- **A session only goes to the Stud.IP that issued it.** Sessions are stored with their origin (keychain account `session:<origin>`); the client refuses to attach the cookie or token to any other origin (`SESSION_ORIGIN_MISMATCH`, nothing is sent). Sessions saved by 0.1.x are moved once to the configured `instanceOrigin`.
- **No session, no request.** Signed out, the client throws `AUTH_REQUIRED` before any network call (only public routes such as `discovery` go out).
- **Stud.IP names never become paths.** Whoever may create folders or upload files in a course chooses their names. A folder or file called `.` or `..` (or only dots) is synced as `_`, sync writes nothing outside the course folder whatever the name, and `files download` without `-o` writes the file's name into the current folder only (separators become `_`). Before, nested folders called `..` led out of the workspace in layout `tree`.
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

[0.3.1]: https://github.com/ImStudium/imstudium/releases/tag/v0.3.1
[0.3.0]: https://github.com/ImStudium/imstudium/releases/tag/v0.3.0
[0.2.0]: https://github.com/ImStudium/imstudium/pull/1
[0.1.3]: https://github.com/ImStudium/imstudium/releases/tag/v0.1.3
[0.1.2]: https://github.com/ImStudium/imstudium/releases/tag/v0.1.2
[0.1.1]: https://github.com/ImStudium/imstudium/releases/tag/v0.1.1
[0.1.0]: https://github.com/ImStudium/imstudium/releases/tag/v0.1.0
