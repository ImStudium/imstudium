# ORIGIN — auvy-origin alignment

DigiCampus is a **reference spawn** of the [`oss-sdk-cli`](https://github.com/paddy-shrp/auvy-origin/blob/main/archetypes/oss-sdk-cli.md) archetype from [auvy-origin](https://github.com/paddy-shrp/auvy-origin).

## Archetype fit

| Origin expectation | DigiCampus |
|--------------------|------------|
| `{x}/packages/{cli,sdk,core}` | `packages/{cli,sdk}` — SDK is core |
| `plugins/`, `mcp/` | `packages/mcp` |
| `LICENSE`, `AGENTS.md` | ✅ MIT + AGENTS.md |
| `implementation-status.md` | ✅ release truth |
| `{x}-docs` sibling | Deferred — docs in `docs/` for v0.1 |
| `{x}-company` hub | Not spawned — personal OSS, not AUVY venture |

## What to do in auvy-origin

### 1. Register as spawned reference (recommended)

Add to `auvy-origin/spawned/digicampus.yaml` (or catalog):

```yaml
id: digicampus
name: DigiCampus Studium OS
archetype: oss-sdk-cli
stack: oclif-ts
repos:
  main: patrick-schroeppel/digicampus
status: shipped-v0.1.0
notes: Stud.IP extraction harness + Studium workspace + MCP
```

### 2. Update `templates/oss-sdk-cli` from this repo

After v0.1 stabilizes, backport patterns into Origin template:

- `packages/mcp/` with tool registry (`tools.ts`)
- `StudiumBuilder` pattern — local agent workspace from API sync
- `implementation-status.md` gate
- CLI `--json` + `schemaVersion: 1` convention
- OAuth-first auth with local helper fallback

### 3. Skills on spawn

When spawning future `oss-sdk-cli` ventures, wire these Origin capabilities:

| Skill | Use for digicampus-like spawns |
|-------|-------------------------------|
| `venture-os` | Company hub if GTM path opens |
| `ops-automate` | Cron `digicampus sync`, Life OS MCP stack |
| `content-engine` | Launch posts, README → docs site |

### 4. Optional: spawn `digicampus-company`

Only if you want GTM as a product (not just personal tool):

```bash
origin venture spawn --name digicampus --archetype oss-sdk-cli --stack oclif-ts
```

Company repo would own: licensing matrix, launch checklist, university outreach — **not** OSS source.

### 5. Integrator path (like Kaemu)

Mirror Kaemu's pattern from JMS:

| Kaemu | DigiCampus equivalent |
|-------|----------------------|
| `kaemu-sdk` | `digicampus-sdk` ✅ |
| `kaemu` CLI | `digicampus` ✅ |
| HTTP MCP | stdio MCP ✅ (v0.2: HTTP optional) |
| `kaemu-docs` | `digicampus-docs` (v0.2) |

## Life OS integration (Patrick)

| Integration | Action |
|-------------|--------|
| Personal OS context | `context/projects/digicampus.md` |
| Daily sync | `0 8 * * * digicampus sync --quiet` |
| Cursor MCP | `~/.cursor/mcp.json` → `digicampus-mcp` |
| Study sessions | Use `.cursor/skills/digicampus-study/SKILL.md` |

## GTM angles (if productized)

1. **Every German Stud.IP university** — same JSON:API surface
2. **Agent-native studying** — MCP-first positioning vs manual LMS
3. **Open core** — MIT SDK; hosted sync SaaS later (separate repo per Origin rules)

## Origin processes

- [oss-open-source-tool.md](https://github.com/paddy-shrp/auvy-origin/blob/main/processes/technical/oss-open-source-tool.md) — release flow
- Tag on main repo → update implementation-status → optional docs changelog
