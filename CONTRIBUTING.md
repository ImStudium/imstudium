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
pnpm install && pnpm run validate
```

## Before a PR

1. `pnpm run validate` must pass (typecheck + build + test)
2. Update [CHANGELOG.md](./CHANGELOG.md) under `[Unreleased]`
3. Update [AGENTS.md](./AGENTS.md) or [docs/](./docs/) if behavior changes for end users

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

```bash
pnpm run validate
pnpm publish -r --dry-run
pnpm publish -r --access public
git tag vX.Y.Z && git push origin vX.Y.Z
gh release create vX.Y.Z --generate-notes
```
