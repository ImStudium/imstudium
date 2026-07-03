# AGENTS.md — DigiCampus Studium OS

Universal guide for **all** agent harnesses.

## Onboard once

```bash
npx -y digicampus onboard -y -o ~/Studium
```

Login uses your normal browser (no extra installs): `digicampus login`

Configures **only detected** harnesses (no churn elsewhere):

| Harness | Skills | MCP config |
|---------|--------|------------|
| **Cursor** | `~/.cursor/skills/` | `~/.cursor/mcp.json` |
| **Claude Code** | `~/.claude/skills/` | `~/.claude/mcp.json` |
| **Claude Desktop / Cowork** | `~/.claude/skills/` (shared) | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| **OpenAI Codex** | `~/.codex/skills/` | `~/.codex/mcp.json` |
| **Windsurf** | `~/.codeium/windsurf/skills/` | `~/.codeium/windsurf/mcp.json` |
| **OpenCode** | `~/.config/opencode/skills/` | `~/.config/opencode/mcp.json` |
| **Project** | — | `~/Studium/mcp.json` |

Re-run is **idempotent**: `digicampus setup all -y` skips unchanged files. Force: `--force`.

Check: `digicampus setup status`

## Updates

```bash
digicampus update --check --json   # LLM: version + recommendedAction
digicampus update -y               # global npm upgrade + refresh skills/MCP
```

After a new release: `digicampus update -y` once per machine (or `npx -y digicampus@latest` each session).

## Visual comprehension (slides)

**Never summarize slides from text alone.** After `studium_read_material`, read every `pageImages` PNG or open `viewerFileUrl` in Playwright/browser.

Skill: `digicampus-visual` (installed by onboard)

## MCP tools

`studium_overview` → `studium_klausuren` → `studium_find_materials` → `studium_read_material` → **read pageImages**

## Daily loop (fast)

```bash
digicampus sync --quiet --extract -o ~/Studium
```

No agent re-setup on daily sync.

## Paths

- Manifest: `~/.config/digicampus/setup-manifest.json`
- Workspace: `~/Studium` (`DIGICAMPUS_WORKSPACE`)
