# DigiCampus Studium OS

**Full study system for Stud.IP students** — extract everything from DigiCampus, sync materials, map your courses, plan Klausuren, and use it with any LLM via MCP.

## Onboard (first time)

**One line (no Bun / no global install):**

```bash
curl -fsSL https://raw.githubusercontent.com/paddy-shrp/digicampus/main/scripts/install.sh | bash
```

Or:

```bash
npx -y digicampus onboard -y -o ~/Studium
```

First login (opens your normal browser, no extra tools):

```bash
digicampus login
```

One command: login → sync → wire **Cursor, Claude Code, Claude Desktop/Cowork, Codex, Windsurf, OpenCode** (only detected harnesses). **Idempotent** — re-running skips unchanged skills and MCP.

Daily use:

```bash
digicampus sync --quiet --extract
```

Agent setup only (once, or after upgrade):

```bash
digicampus setup all -y          # skips unchanged
digicampus setup status          # what’s configured
```

## What you get

```
~/Studium/
├── llms.txt           # agent entry point — paths + search guidance
├── studium.json       # machine-readable course map (schema v2)
├── STUDIUM.md         # semester overview
├── klausuren.md       # exam timeline with days-remaining
├── calendar.ics       # full schedule
└── SS2026/            # active semester (slug from Stud.IP)
    └── Analysis-II/
        ├── COURSE.md
        ├── search/
        │   ├── materials.json   # file list + cite refs
        │   └── corpus.jsonl     # page index — grep this with your agent tools
        ├── files/       # synced PDFs, slides, sheets
        └── extracted/   # per file: content.md + pages/*.png
            └── Vorlesung-03-pdf/
                ├── content.md
                ├── pages/page-001.png ...
                └── manifest.json
```

Sync defaults to the **current semester**. Other terms: `digicampus sync --semester "WS 2025/26"`.

## Quick start

```bash
# First time (recommended)
npx -y digicampus onboard -y -o ~/Studium

# Or: workspace first, agents second (less churn on re-sync)
digicampus init -o ~/Studium
digicampus onboard --agents-only -y

# Daily
digicampus sync --quiet --extract
digicampus --json studium
```

## CLI commands

| Command | Description |
|---------|-------------|
| `onboard` | First-time: login + sync + agents (idempotent) |
| `init` | Login + sync workspace only |
| `setup status` | Detected agents + manifest |
| `setup all` | Wire agents (skips unchanged) |
| `login` / `logout` / `status` | Auth lifecycle |
| `studium` | Overview (`--json` for studium.json) |
| `klausuren` | Exam timeline |
| `courses list` | Live course list |
| `sync` | Sync files + rebuild workspace (`--extract` to also extract; `--semester` for other terms) |
| `extract` | Text + page images from all synced materials |
| `index` | Rebuild page index (`corpus.jsonl`) for agent grep / semantic search |
| `view` | Build `viewer.html` for Playwright / browser agents (fast) |
| `doctor` | Check extraction tools (poppler, LibreOffice) |
| `update` | Upgrade CLI + refresh agent skills/MCP |
| `watch --interval 1h` | Continuous sync |
| `discover` | List JSON:API routes |

Global flags: `--json`, `--quiet`, `--instance <url>`

## MCP (all agent harnesses)

```bash
digicampus setup mcp    # merges into each harness MCP config (see AGENTS.md)
```

Or copy [mcp.json](mcp.json). See [AGENTS.md](AGENTS.md) for per-harness paths.

Tools: `studium_overview`, `studium_klausuren`, `studium_course_brief`, `studium_find_materials`, `studium_read_material`, `digicampus_sync`, `digicampus_sync_dry_run`, `digicampus_list_courses`, `digicampus_whoami`

**Content search:** grep or semantic-search `<course.path>/search/corpus.jsonl` with your agent — `studium_overview` returns `searchGuidance`. No custom search MCP tool.

## Extraction — agents that SEE your slides

Every synced file is extractable to text **and** rendered page images:

```bash
brew install poppler                  # PDF text + slide PNGs
brew install --cask libreoffice      # optional: PPTX/DOCX/XLSX rendering
brew install tesseract tesseract-lang # optional: OCR for scans & photos
digicampus doctor                     # verify tools

digicampus extract                    # everything
digicampus extract --course Analysis  # one course
digicampus sync --extract             # sync + extract in one step
```

| Input | Text | Page images | Tool |
|-------|------|-------------|------|
| PDF | ✅ per page | ✅ PNG per page | poppler |
| Scanned PDF (no text layer) | ✅ OCR per page | ✅ PNG per page | poppler + tesseract |
| PPTX / DOCX / XLSX / ODP... | ✅ per slide | ✅ via LibreOffice → PDF | libreoffice + poppler |
| PPTX / DOCX (no LibreOffice) | ✅ native XML | — | built-in |
| Images / photos (PNG/JPG/...) | ✅ OCR if tesseract | ✅ copied to pages/ | built-in (+ tesseract) |
| Text / code / CSV / notebooks | ✅ passthrough | — | built-in |

All tools are free and local — no API keys, no credits, no cloud. Everything degrades gracefully: missing tools just mean fewer output layers, never a crash (`digicampus doctor` shows what's active).

MCP agents use `studium_read_material` — returns `requiredAction`, `pageImages`, and `viewerFileUrl`. **Read every PNG** or open the viewer in Playwright/browser before explaining slides.

## Agent skills

Bundled in the CLI package (like Firecrawl). Install with:

```bash
digicampus setup all -y
```

| Skill | Purpose |
|-------|---------|
| `digicampus-cli` | Terminal commands |
| `digicampus-studium` | Course overview |
| `digicampus-klausuren` | Exam timeline |
| `digicampus-sync` | Material refresh |
| `digicampus-visual` | **Read PNGs / Playwright — mandatory for slides** |
| `digicampus-mcp` | MCP tool picker |
| `klausur-prep` | Exam prep workflow |
| `semester-refresh` | Daily briefing workflow |

See [packages/cli/skills/](packages/cli/skills/) · [AGENTS.md](AGENTS.md) · [CLAUDE.md](CLAUDE.md)

## Packages

| Package | Description |
|---------|-------------|
| `digicampus-sdk` | JSON:API client, auth, sync, Studium builder |
| `digicampus` | CLI |
| `digicampus-mcp` | MCP server |

## Auth

DigiCampus uses Shibboleth + Microsoft MFA.

1. **Clean login**: `digicampus login --oauth` — one-click app login once a university OAuth client is registered ([docs/OAUTH.md](docs/OAUTH.md)).
2. **Temporary fallback**: `digicampus login` — opens a local helper page and your normal browser. This currently requires a session value because a CLI cannot securely read a normal browser session by itself.
3. **Cookie import**: `digicampus session import --cookie <Seminar_Session>`

## Instance

Default: [digicampus.uni-augsburg.de](https://digicampus.uni-augsburg.de) (Stud.IP 5.4.11)

Other Stud.IP universities:

```bash
digicampus config set base-url https://studip.example.edu/jsonapi.php/v1
```

## Legal

For personal study use only. Respect university terms of service and course material licenses.

## License

[MIT](LICENSE) — Copyright (c) 2026 Patrick Schröppel
