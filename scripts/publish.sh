#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/common.sh
source "$(dirname "$0")/lib/common.sh"

ensure_bun

log "Validating..."
bun run validate
bun run docs:check

version=$(node -p "require('./packages/cli/package.json').version")
echo ""
echo "Releases publish from CI only (npm trusted publishing, provenance, no token)."
echo "Order: $(bun scripts/release-order.ts | tr '\n' ' ')"
echo ""
echo "  git tag v$version && git push origin v$version"
echo ""
echo "→ .github/workflows/release.yml (see CONTRIBUTING.md)"
echo ""
