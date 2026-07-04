#!/usr/bin/env bash
# Developer bootstrap — Bun + global CLI wrappers in ~/.local/bin.
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

log "Linking imstudium into ~/.local/bin..."
bash "$SCRIPT_DIR/link-global.sh"

export PATH="$HOME/.local/bin:$PATH"
if has_cmd imstudium; then
  log "Global CLI: $(command -v imstudium)"
else
  warn "imstudium not on PATH — add: export PATH=\"$HOME/.local/bin:\$PATH\""
fi

log "Dev ready. Commands:"
echo "  imstudium setup migrate -y    # migrate from digicampus"
echo "  imstudium login"
echo "  imstudium sync --quiet --extract"
echo "  bun run validate"
