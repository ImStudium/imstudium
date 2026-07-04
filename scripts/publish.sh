#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/common.sh
source "$(dirname "$0")/lib/common.sh"

ensure_bun

log "Building..."
bun run build

echo ""
echo "Ready to publish"
echo "  bun run validate"
echo "  cd packages/sdk && bun publish --access public"
echo "  cd packages/cli && bun publish --access public"
echo "  cd packages/mcp && bun publish --access public"
echo ""
