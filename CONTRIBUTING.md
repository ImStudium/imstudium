# Contributing

Thanks for contributing to ImStudium.

## Setup

Requires [Bun](https://bun.sh) 1.2+.

```bash
git clone https://github.com/ImStudium/imstudium.git
cd imstudium
bash scripts/install-dev.sh
```

Or manually:

```bash
bun install
bun run validate
```

## Before a PR

1. `bun run validate` must pass (typecheck + build + test)
2. Update [CHANGELOG.md](./CHANGELOG.md) under `[Unreleased]`
3. Update [AGENTS.md](./AGENTS.md) or [docs/](./docs/) if behavior changes for end users

## Auth development

```bash
imstudium login
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
bun run validate
bun run build
cd packages/sdk && bun publish --access public
cd packages/cli && bun publish --access public
cd packages/mcp && bun publish --access public
git tag vX.Y.Z && git push origin vX.Y.Z
gh release create vX.Y.Z --generate-notes
```
