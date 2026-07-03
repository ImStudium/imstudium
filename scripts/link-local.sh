#!/usr/bin/env bash
# Link local digicampus CLI into PATH (pnpm global). Run after build.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

log() { printf '→ %s\n' "$*"; }

log "Building..."
bun run build 2>/dev/null || pnpm run build

log "Linking digicampus-sdk + digicampus (pnpm global)..."
(cd packages/sdk && pnpm link --global)
(cd packages/cli && pnpm link --global)

log "Refreshing agent harness..."
digicampus update --agents -y

log "Done. $(digicampus --version 2>/dev/null || echo 'digicampus linked')"
echo "  digicampus doctor"
echo "  digicampus login"
