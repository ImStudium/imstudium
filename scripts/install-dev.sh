#!/usr/bin/env bash
# Developer bootstrap — Bun (preferred), pnpm, or npm. No global tools required.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

cd "$ROOT"

PM="$(detect_pm)"
if [[ -z "$PM" ]]; then
  log "No package manager found — installing Bun..."
  curl -fsSL https://bun.sh/install | bash
  export PATH="${HOME}/.bun/bin:${PATH}"
  PM=bun
fi

log "Using $PM in $ROOT"

case "$PM" in
  bun)
    bun install --frozen-lockfile 2>/dev/null || bun install
    ;;
  pnpm)
    pnpm install --frozen-lockfile 2>/dev/null || pnpm install
    ;;
  npm)
    npm install
    ;;
esac

log "Running validate (typecheck + build + test)..."
pm_validate "$PM"

log "Dev ready. Commands:"
echo "  $PM run build"
echo "  $PM run test"
echo "  $PM run test:e2e"
echo "  node packages/cli/dist/cli.js --help"
