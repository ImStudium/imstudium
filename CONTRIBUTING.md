# Contributing

Thanks for contributing to DigiCampus Studium OS.

## Setup

```bash
git clone https://github.com/paddy-shrp/digicampus.git
cd digicampus
bash scripts/install-dev.sh   # auto: Bun → pnpm → npm
```

Or manually:

```bash
bun install && bun run validate    # preferred
# pnpm install && pnpm run validate
```

## Before a PR

1. `bun run validate` or `pnpm run validate` must pass (typecheck + build)
2. Update `implementation-status.md` if shipping a feature
4. Update `CHANGELOG.md` under `[Unreleased]` or version section

## Auth development

```bash
digicampus login
```

Do not commit session files or cookies.

## Package boundaries

| Package | Owns |
|---------|------|
| `packages/sdk` | API client, auth, sync, studium — no CLI parsing |
| `packages/cli` | Commander commands, `--json` UX |
| `packages/mcp` | MCP tool handlers only |

## Release (maintainers)

See [implementation-status.md](./implementation-status.md) ship checklist.
