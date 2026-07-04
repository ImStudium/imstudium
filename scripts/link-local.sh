#!/usr/bin/env bash
# Link local imstudium CLI into PATH via bun link. Run after build.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# shellcheck source=lib/common.sh
source "$(dirname "$0")/lib/common.sh"

ensure_bun

log "Building..."
bun run build

log "Linking imstudium-sdk + imstudium (bun link --global)..."
(cd packages/sdk && bun link)
(cd packages/cli && bun link --global)

log "Refreshing agent harness..."
imstudium update

log "Done. $(imstudium --version 2>/dev/null || echo 'imstudium linked')"
echo "  imstudium doctor"
echo "  imstudium login"
