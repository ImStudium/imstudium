#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/common.sh
source "$(dirname "$0")/lib/common.sh"

ensure_bun

log "Building..."
bun run build

echo ""
echo "Ready to publish to npm org @imstudium (publish SDK first):"
echo "  bun run validate"
echo "  cd packages/sdk && npm publish --access public"
echo "  cd packages/mcp && npm publish --access public"
echo "  cd packages/cli && npm publish --access public"
echo ""
echo "Requires: npm login + membership in the imstudium org"
echo ""
