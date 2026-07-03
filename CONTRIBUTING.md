# Contributing

Thanks for contributing to DigiCampus Studium OS.

## Setup

```bash
git clone https://github.com/patrick-schroeppel/digicampus.git
cd digicampus
pnpm install
pnpm validate
```

## Before a PR

1. `pnpm validate` must pass (typecheck + build + test)
2. Add tests for new SDK logic
3. Update `implementation-status.md` if shipping a feature
4. Update `CHANGELOG.md` under `[Unreleased]` or version section

## Auth development

```bash
npx playwright install chromium
digicampus login --instance https://digicampus.uni-augsburg.de
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
