# Changelog

All notable changes to DigiCampus Studium OS.

## [0.1.0] — 2026-07-03

### Added

- **Extraction harness** — all file types → agent-readable text + page images
  - PDF: poppler text per page + PNG per page
  - PPTX/DOCX/XLSX/ODP: LibreOffice → PDF pipeline, or built-in XML text fallback
  - Images copied to `pages/`, text/code passthrough
  - Tesseract OCR fallback for scanned PDFs and photos (deu+eng, `DIGICAMPUS_OCR_LANG` override)
  - Incremental (mtime+size manifest), `digicampus extract`, `sync --extract`, `doctor`
  - MCP `studium_read_material` — returns text + `pageImages` PNG paths for visual comprehension

- `digicampus-sdk` — Stud.IP JSON:API client, pagination, file download
- Login via OAuth-ready auth manager, with local helper fallback for Shibboleth + MFA
- Session storage (OS keychain + file fallback)
- `SyncEngine` — flat/tree file sync, wiki/news/calendar export, incremental state
- `StudiumBuilder` — `studium.json`, `STUDIUM.md`, `klausuren.md`, per-course `COURSE.md`
- `digicampus` CLI — init, login, sync, studium, klausuren, discover, watch
- `digicampus-mcp` — 8 study-planning tools for Cursor / Claude
- Global `--json` output with `schemaVersion: 1`
- CI workflow, AGENTS.md, API/STUDIUM/OAUTH docs

### Known gaps

- OAuth2 PKCE requires university-registered client
- Courseware plugin files not in JSON:API (Stud.IP 5.4)

[0.1.0]: https://github.com/patrick-schroeppel/digicampus/releases/tag/v0.1.0
