# AGENTS.md — DigiCampus Studium OS

Guide for LLM agents using the digicampus CLI and MCP.

## First steps

1. Check auth: `digicampus status` or MCP `digicampus_whoami`
2. If not authenticated: tell user to run `digicampus login` (browser MFA required)
3. Read workspace: `digicampus --json studium` or MCP `studium_overview`
4. For exam planning: `digicampus --json klausuren` or MCP `studium_klausuren`

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Error (see stderr JSON if `--json`) |

## JSON output shape

All `--json` responses include `"schemaVersion": "1"`.

Errors on stderr:

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "...",
    "hint": "Run digicampus login first"
  }
}
```

## MCP tool selection

| User intent | Tool |
|-------------|------|
| "What courses am I in?" | `studium_overview` |
| "When are my exams?" | `studium_klausuren` |
| "Tell me about Analysis" | `studium_course_brief` |
| "Find the Analysis script" | `studium_find_materials` |
| "Refresh from DigiCampus" | `digicampus_sync` |
| "What's new to download?" | `digicampus_sync_dry_run` |

## Study planning workflow

```
studium_overview → studium_klausuren → studium_find_materials (per course)
```

Use `klausuren.md` confirmed vs unconfirmed sections. Unconfirmed dates need student verification.

## Sync without network

After `digicampus init`, all planning can use local `~/Studium/studium.json` — no API calls needed until refresh.

## Cron

```bash
0 8 * * * digicampus sync --quiet -o ~/Studium
```

## Config paths

- Config: `~/.config/digicampus/config.json`
- Session: OS keychain service `digicampus` (fallback: `~/.config/digicampus/session.json`)
- Sync state: `~/.local/share/digicampus/sync-state.json`
- Workspace: `~/Studium` (override: `DIGICAMPUS_WORKSPACE`)
