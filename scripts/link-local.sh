#!/usr/bin/env bash
# Link local digicampus CLI into PATH via bun link. Run after build.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# shellcheck source=lib/common.sh
source "$(dirname "$0")/lib/common.sh"

ensure_bun

log "Building..."
bun run build

log "Linking digicampus-sdk + digicampus (bun link --global)..."
(cd packages/sdk && bun link)
(cd packages/cli && bun link --global)

log "Refreshing agent harness..."
digicampus update

log "Done. $(digicampus --version 2>/dev/null || echo 'digicampus linked')"
echo "  digicampus doctor"
echo "  digicampus login"
