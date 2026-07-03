#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/common.sh
source "$(dirname "$0")/lib/common.sh"

PM="$(detect_pm)"
[[ -n "$PM" ]] || die "Need bun, pnpm, or npm"

log "Building with $PM..."
case "$PM" in
  bun)  bun run build && bun run test ;;
  pnpm) pnpm run build && pnpm run test ;;
  npm)  npm run build && npm run test ;;
esac

echo ""
echo "Ready to publish v0.1.0"
echo "  $PM publish -r --access public --no-git-checks"
echo ""
echo "Or per package:"
echo "  cd packages/sdk && npm publish --access public"
echo "  cd packages/cli && npm publish --access public"
echo "  cd packages/mcp && npm publish --access public"
echo ""
