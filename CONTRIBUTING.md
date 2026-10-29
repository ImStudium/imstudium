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

Releases publish from CI only, with npm trusted publishing (OIDC, no token) and provenance. Every package on npmjs.com trusts `ImStudium/imstudium`, workflow `release.yml`.

```bash
bun run validate && bun run docs:check
# all four packages carry the same version X.Y.Z; CHANGELOG has ## [X.Y.Z]
git tag vX.Y.Z && git push origin vX.Y.Z   # → .github/workflows/release.yml
```

The workflow publishes in dependency order — contract → sdk → cli → mcp (`bun scripts/release-order.ts`; `scripts/release-order.test.ts` pins it) — and fails unless npm shows a provenance attestation for each package. Bun is pinned to 1.4.2 (`packageManager`, CI, release).
