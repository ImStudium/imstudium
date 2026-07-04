# Changelog

All notable changes to ImStudium.

## [Unreleased]

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

[0.1.1]: https://github.com/paddy-shrp/imstudium/releases/tag/v0.1.1
[0.1.0]: https://github.com/paddy-shrp/imstudium/releases/tag/v0.1.0
