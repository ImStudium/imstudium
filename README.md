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
├── studium.json       # machine-readable course map (for agents)
├── STUDIUM.md         # semester overview
├── klausuren.md       # exam timeline with days-remaining
├── calendar.ics       # full schedule
└── current/
    └── Analysis-II/
        ├── COURSE.md
        ├── files/       # synced PDFs, slides, sheets — all file types
        ├── extracted/   # per file: content.md + pages/*.png (visual!)
        │   └── Vorlesung-03-pdf/
        │       ├── content.md      # text per page/slide
        │       ├── pages/page-01.png ...  # LLMs read these to SEE the slides
        │       └── manifest.json
        ├── wiki/
        └── news/
```

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
| `sync` | Sync files + rebuild workspace (`--extract` to also extract) |
| `extract` | Text + page images from all synced materials |
| `view` | Build `viewer.html` for Playwright / browser agents (fast) |
| `doctor` | Check extraction tools (poppler, LibreOffice) |
| `watch --interval 1h` | Continuous sync |
| `discover` | List JSON:API routes |

Global flags: `--json`, `--quiet`, `--instance <url>`

## MCP (Cursor / Claude)

```bash
digicampus setup mcp    # merges into ~/.cursor/mcp.json
```

Or copy [mcp.json](mcp.json). Tools: `studium_overview`, `studium_klausuren`, `studium_course_brief`, `studium_find_materials`, `studium_read_material`, `digicampus_sync`, `digicampus_whoami`

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

See [packages/cli/skills/](packages/cli/skills/) · [CLAUDE.md](CLAUDE.md)

## Packages

| Package | Description |
|---------|-------------|
| `digicampus-sdk` | JSON:API client, auth, sync, Studium builder |
| `digicampus` | CLI |
| `digicampus-mcp` | MCP server |

## Auth

DigiCampus uses Shibboleth + Microsoft MFA (since Jul 2025). Supported methods:

1. **Browser login** (default): `digicampus login` — Playwright opens real login page
2. **OAuth2 PKCE**: `digicampus login --oauth` — requires registered client (see [docs/OAUTH.md](docs/OAUTH.md))
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

MIT
