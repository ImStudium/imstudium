# AGENTS.md — ImStudium

Universal guide for **all** agent harnesses.

## Onboard once

```bash
npx -y imstudium onboard -y -o ~/Studium
```

Interactive `onboard` (without `--json` / `--yes`) opens a **setup dashboard** in your browser with live step progress — workspace, sign-in, sync, agents.

Login uses your normal browser (no extra installs): `imstudium login`

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

Re-run is **idempotent**: `imstudium setup all -y` skips unchanged files. Force: `--force`.

Check: `imstudium setup status`

## Updates

```bash
imstudium update              # upgrade CLI + refresh skills/MCP
imstudium update --json       # same, machine-readable
```

## Visual comprehension (slides)

**Never summarize slides from text alone.** After `studium_read_material`, read every `pageImages` PNG or open `viewerFileUrl` in Playwright/browser.

Skill: `imstudium-visual` (installed by onboard)

## MCP tools

`studium_overview` → `studium_klausuren` → grep/semantic-search `*/search/corpus.jsonl` → `studium_read_material` → **read pageImages**

`studium_overview` returns `searchGuidance` — use your harness grep/codebase search on `corpus.jsonl`, not a custom search tool.

## Finding slide/PDF content

The workspace ships a **page index** (`<course.path>/search/corpus.jsonl`), not a search engine. Agents should:

```bash
rg -i "keyword" ~/Studium/SS2026/*/search/corpus.jsonl
```

Each line is JSON with `ref`, `text`, `pageImage`, `extractSlug`. Cite with `ref`, read `content.md` or PNGs. See `~/Studium/llms.txt`.

## Daily loop (fast)

```bash
imstudium sync --quiet --extract -o ~/Studium
```

No agent re-setup on daily sync.

## Paths

- Manifest: `~/.config/imstudium/setup-manifest.json`
- Workspace: `~/Studium` (`IMSTUDIUM_WORKSPACE`)

## Per harness

| Surface | Install |
|---------|---------|
| **Cursor** | `npx -y imstudium onboard -y` or Cursor marketplace plugin |
| **Claude Code** | `imstudium onboard -y` |
| **Claude Desktop / Cowork** | `imstudium onboard -y` (shared `~/.claude/skills`, platform MCP path) |
| **OpenAI Codex** | `imstudium onboard -y` or Codex plugin |
| **Windsurf** | `imstudium onboard -y` |
| **OpenCode** | `imstudium onboard -y` |

Multi-harness machine (install to every path, not only detected):

```bash
imstudium setup all -y --all-agents
```
