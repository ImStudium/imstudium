#!/usr/bin/env bash
# Shared helpers for ImStudium install / dev scripts.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

log() { printf '→ %s\n' "$*"; }
warn() { printf '⚠ %s\n' "$*" >&2; }
die() { printf '✗ %s\n' "$*" >&2; exit 1; }

has_cmd() { command -v "$1" >/dev/null 2>&1; }

ensure_bun() {
  if has_cmd bun; then
    return 0
  fi
  log "Bun not found — installing..."
  curl -fsSL https://bun.sh/install | bash
  export PATH="${HOME}/.bun/bin:${PATH}"
  has_cmd bun || die "Bun install failed. See https://bun.sh"
}

run_bun() {
  ensure_bun
  bun "$@"
}

# End-user global installs still go through npm registry.
ensure_npm() {
  if has_cmd npm; then
    return 0
  fi
  if has_cmd bun; then
    return 0
  fi
  warn "Node.js/npm not found."
  if [[ "$(uname -s)" == "Darwin" ]] && has_cmd brew; then
    log "Installing Node via Homebrew (for npm global installs)..."
    brew install node@22
    return 0
  fi
  die "Install Node.js 20+ from https://nodejs.org (for npm install -g imstudium)"
}
