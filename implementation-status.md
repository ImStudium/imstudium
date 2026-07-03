# Implementation status — DigiCampus Studium OS

> Release truth for `oss-sdk-cli` archetype. Update on every tag.

## Current release

| Field | Value |
|-------|-------|
| **Version** | 0.1.0 |
| **Tag** | `v0.1.0` |
| **Date** | 2026-07-03 |
| **Gate** | ✅ CI (pnpm + Bun) · ✅ `validate` · ⚠️ npm publish (2FA token required) |

## Shipped (v0.1.0)

| Area | Status | Notes |
|------|--------|-------|
| SDK — StudIpClient | ✅ | Pagination, JSON:API errors, HEAD/download |
| SDK — AuthManager | ✅ | Playwright browser login, keychain, cookie import |
| SDK — SyncEngine | ✅ | Flat/tree layouts, incremental chdate/etag, wiki/news/calendar |
| SDK — StudiumBuilder | ✅ | `studium.json`, `STUDIUM.md`, `klausuren.md`, `COURSE.md` |
| SDK — Extractor | ✅ | All file types → text + page PNGs (poppler / LibreOffice / native XML fallback / tesseract OCR for scans) |
| CLI | ✅ | init, login, sync (`--extract`), extract, doctor, studium, klausuren, discover, watch, `--json` |
| CLI setup | ✅ | `setup skills|workflows|mcp|all` + `init --all` (Firecrawl-style) |
| Agent skills | ✅ | 6 CLI skills + 2 workflows (incl. `digicampus-visual` for all harnesses) |
| MCP | ✅ | 9 tools — `studium_read_material` returns `requiredAction` + `viewerFileUrl` + Playwright hints |
| CLI setup | ✅ | `onboard` + idempotent `setup` — 6 native harnesses, manifest hash-skip |
| Agent setup | ✅ | Cursor, Claude Code, Claude Desktop/Cowork, Codex, Windsurf, OpenCode + `~/Studium/mcp.json` |
| Docs | ✅ | README, AGENTS, API, STUDIUM, OAUTH |
| Tests | ✅ | SDK unit (incl. real PPTX extraction) + CLI smoke (live discover) + MCP tool registry |
| CI | ✅ | typecheck → build → test on push/PR |

## Deferred (v0.2+)

| Item | Priority | Notes |
|------|----------|-------|
| OAuth2 PKCE (registered client) | P1 | RZ client request — see `.github/ISSUE_TEMPLATE/oauth-client.md` |
| Courseware plugin file sync | P2 | No JSON:API routes in Stud.IP 5.4 Media plugin |
| `digicampus-docs` repo | P3 | Origin sibling per archetype |
| `digicampus-company` hub | P3 | Only if commercial SKU |
| Multi-instance profiles | P3 | `--profile` flag |

## Ship checklist (`validate`)

```bash
bun install && bun run validate    # or: pnpm install && pnpm run validate
pnpm publish -r --dry-run
```

Live publish (maintainer):

```bash
npm login              # account with 2FA + granular publish token
pnpm publish -r --access public
git tag v0.1.0 && git push origin v0.1.0
```

## Manual ship gates

- [ ] `digicampus login` works with MFA on target instance
- [ ] `digicampus init -o /tmp/studium-test` completes
- [ ] `digicampus doctor` — poppler installed for slide images
- [ ] `pnpm publish -r --dry-run` succeeds; npm account has 2FA publish token
- [ ] GitHub remote exists; tag pushed after publish
- [ ] Post-ship: register in auvy-origin `spawned/` (see [ORIGIN.md](./ORIGIN.md)), add `context/projects/digicampus.md` in personal OS

## Test matrix

| Suite | Command | Coverage |
|-------|---------|----------|
| SDK unit | `packages/sdk` vitest | client, errors, studium, sync, config, **extract (PPTX E2E, images, incremental)** |
| CLI smoke | `packages/cli` vitest | `--help`, live `discover --json`, setup merge |
| MCP registry | `packages/mcp` vitest | 9 tool names |

## Known limitations

- MFA: `digicampus login` opens your **default browser** (saved passwords) — paste `Seminar_Session` once; no Playwright required
- Session cookies expire; re-login when `status` fails
- Exam dates from achievement text are **unconfirmed** — student must verify
- Slide page images require poppler (`brew install poppler`); Office rendering needs LibreOffice — without them, native PPTX/DOCX text fallback still works (`digicampus doctor`)
- Publish as unscoped packages on npm under `paddy-shrp` — no `@digicampus` org required
