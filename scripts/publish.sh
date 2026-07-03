#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

echo "Building packages..."
pnpm build
pnpm test

echo ""
echo "Ready to publish v0.1.0"
echo "  pnpm publish -r --access public --no-git-checks"
echo ""
echo "Or per package:"
echo "  cd packages/sdk && pnpm publish --access public"
echo "  cd packages/cli && pnpm publish --access public"
echo "  cd packages/mcp && pnpm publish --access public"
