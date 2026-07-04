#!/usr/bin/env bash
# Developer bootstrap — Bun only.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

cd "$ROOT"

ensure_bun

log "Using bun in $ROOT"
bun install --frozen-lockfile 2>/dev/null || bun install

log "Running validate (typecheck + build + test)..."
bun run validate

log "Dev ready. Commands:"
echo "  bun run build"
echo "  bun run validate"
echo "  bun packages/cli/dist/cli.js --help"
