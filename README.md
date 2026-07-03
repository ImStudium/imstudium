# DigiCampus Studium OS

**Full study system for Stud.IP students** — extract everything from DigiCampus, sync materials, map your courses, plan Klausuren, and use it with any LLM via MCP.

```bash
npm install -g digicampus
digicampus init
```

One command: login → sync all course files → build your `~/Studium` workspace.

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
        ├── files/       # synced PDFs, slides, sheets
        ├── wiki/
        └── news/
```

## Quick start

```bash
# Clone and develop
git clone https://github.com/your-org/digicampus.git
cd digicampus && pnpm install && pnpm build

# Login (browser + MFA)
digicampus login

# Full onboarding
digicampus init -o ~/Studium

# Daily refresh
digicampus sync

# Agent-friendly JSON
digicampus --json studium
digicampus --json klausuren
```

## CLI commands

| Command | Description |
|---------|-------------|
| `init` | Login + sync + build workspace |
| `login` / `logout` / `status` | Auth lifecycle |
| `studium` | Overview (`--json` for studium.json) |
| `klausuren` | Exam timeline |
| `courses list` | Live course list |
| `sync` | Sync files + rebuild workspace |
| `watch --interval 1h` | Continuous sync |
| `discover` | List JSON:API routes |

Global flags: `--json`, `--quiet`, `--instance <url>`

## MCP (Cursor / Claude)

Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "digicampus": {
      "command": "npx",
      "args": ["-y", "@digicampus/mcp"],
      "env": {
        "DIGICAMPUS_WORKSPACE": "~/Studium"
      }
    }
  }
}
```

Tools: `studium_overview`, `studium_klausuren`, `studium_course_brief`, `studium_find_materials`, `digicampus_sync`, `digicampus_whoami`

## Packages

| Package | Description |
|---------|-------------|
| `@digicampus/sdk` | JSON:API client, auth, sync, Studium builder |
| `digicampus` | CLI |
| `@digicampus/mcp` | MCP server |

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
