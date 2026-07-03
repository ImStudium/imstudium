#!/usr/bin/env bash
# Shared helpers for DigiCampus install / dev scripts.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

log() { printf '→ %s\n' "$*"; }
warn() { printf '⚠ %s\n' "$*" >&2; }
die() { printf '✗ %s\n' "$*" >&2; exit 1; }

has_cmd() { command -v "$1" >/dev/null 2>&1; }

# Prefer bun for dev speed, then pnpm, then npm.
detect_pm() {
  if has_cmd bun; then
    echo bun
  elif has_cmd pnpm; then
    echo pnpm
  elif has_cmd npm; then
    echo npm
  else
    echo ""
  fi
}

# Node or bun for running built CLI artifacts in e2e / local smoke.
detect_runtime() {
  if has_cmd bun; then
    echo bun
  elif has_cmd node; then
    echo node
  else
    echo ""
  fi
}

run_runtime() {
  local runtime
  runtime="$(detect_runtime)"
  [[ -n "$runtime" ]] || die "Need Node.js (>=20) or Bun. https://nodejs.org"
  "$runtime" "$@"
}

pm_install() {
  local pm="${1:-$(detect_pm)}"
  [[ -n "$pm" ]] || die "Need Bun, pnpm, or npm. Run: curl -fsSL https://bun.sh/install | bash"
  case "$pm" in
    bun)  bun install "$@" ;;
    pnpm) pnpm install "$@" ;;
    npm)  npm install "$@" ;;
    *) die "Unknown package manager: $pm" ;;
  esac
}

pm_validate() {
  local pm="${1:-$(detect_pm)}"
  case "$pm" in
    bun)  bun run validate ;;
    pnpm) pnpm run validate ;;
    npm)  npm run validate ;;
    *) die "Unknown package manager: $pm" ;;
  esac
}

ensure_node_or_bun() {
  if has_cmd node || has_cmd bun; then
    return 0
  fi
  warn "Node.js not found."
  if [[ "$(uname -s)" == "Darwin" ]] && has_cmd brew; then
    log "Installing Node via Homebrew..."
    brew install node@22
    return 0
  fi
  die "Install Node.js 20+ from https://nodejs.org (or Bun from https://bun.sh)"
}

ensure_npm() {
  if has_cmd npm; then
    return 0
  fi
  ensure_node_or_bun
  has_cmd npm || die "npm missing after Node install"
}
