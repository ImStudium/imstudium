# CONTEXT — DigiCampus Studium OS

## Identity

| Field | Value |
|-------|-------|
| **Name** | DigiCampus Studium OS |
| **Archetype** | `oss-sdk-cli` ([auvy-origin](https://github.com/paddy-shrp/auvy-origin)) |
| **Stack** | `oclif-ts` equivalent — pnpm monorepo: `packages/{sdk,cli,mcp}` |
| **License** | MIT |
| **Owner** | Patrick Schröppel (personal / education tooling) |
| **Not** | AUVY GmbH product — separate from Cortex, Synapse, Kaemu |

## One-liner

Open-source CLI + SDK + MCP that turns any Stud.IP instance (DigiCampus) into a local **Studium workspace** — synced files, exam timeline, agent-ready JSON — for LLM-first study planning.

## Problem

Stud.IP portals hide course materials behind MFA web UI. Students need offline materials, Klausur planning, and agent context without manual copy-paste.

## Solution

```
Browser login (MFA) → JSON:API sync → ~/Studium workspace → CLI / MCP for agents
```

## Packages

| Package | npm | Role |
|---------|-----|------|
| `digicampus-sdk` | public | Stud.IP client, auth, sync, Studium builder |
| `digicampus` | public | CLI for humans + scripts |
| `digicampus-mcp` | public | MCP tools for Cursor / Claude |

## Default paths

| Path | Purpose |
|------|---------|
| `~/.config/digicampus/config.json` | Instance URL, workspace path |
| `~/.config/digicampus/session.json` | Session fallback (keychain preferred) |
| `~/.local/share/digicampus/sync-state.json` | Incremental sync state |
| `~/Studium` | Workspace (`studium.json`, `klausuren.md`, course files) |

## Target instance

Primary dev/test: **Uni Augsburg DigiCampus** — Stud.IP 5.4.11, Shibboleth + MFA.

## Links

- [README](./README.md) · [AGENTS.md](./AGENTS.md) · [ORIGIN.md](./ORIGIN.md)
- [implementation-status.md](./implementation-status.md) — release truth
- [docs/API.md](./docs/API.md) · [docs/STUDIUM.md](./docs/STUDIUM.md) · [docs/OAUTH.md](./docs/OAUTH.md)
- Personal OS: `patrick-schroeppel/context/projects/digicampus.md` (proposed)

## Status

**v0.1.0** — MVP shipped. OAuth PKCE stub; courseware plugin sync deferred to v0.2.
