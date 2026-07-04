#!/usr/bin/env bash
# ImStudium end-user installer — Node/npm only. No Bun, no Playwright, no Chrome permissions.
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/paddy-shrp/imstudium/main/scripts/install.sh | bash
#   bash scripts/install.sh [--global] [--workspace DIR]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

GLOBAL=0
WORKSPACE="${IMSTUDIUM_WORKSPACE:-$HOME/Studium}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --global) GLOBAL=1; shift ;;
    -o|--workspace) WORKSPACE="$2"; shift 2 ;;
    -h|--help)
      cat <<'EOF'
ImStudium install — Node.js only. No Bun or extra browser tools required.

  curl -fsSL .../scripts/install.sh | bash
  bash scripts/install.sh [--global] [-o ~/Studium]

Options:
  --global          npm install -g @imstudium/cli @imstudium/mcp
  -o, --workspace   Studium workspace path (default: ~/Studium)
EOF
      exit 0
      ;;
    *) die "Unknown option: $1 (try --help)" ;;
  esac
done

echo ""
echo "ImStudium"
echo "====================="
echo ""

ensure_npm

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)"
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  die "Node.js 20+ required (found v$(node -v 2>/dev/null || echo '?')). Upgrade: https://nodejs.org"
fi

log "Node $(node -v)"

install_optional_tools() {
  local os
  os="$(uname -s)"
  case "$os" in
    Darwin)
      if has_cmd brew && ! has_cmd pdftotext; then
        log "Optional: poppler for PDF slide images (brew install poppler)..."
        brew install poppler 2>/dev/null || warn "Skip for now — run: brew install poppler"
      fi
      ;;
    Linux)
      if has_cmd apt-get && ! has_cmd pdftotext; then
        log "Optional: poppler-utils for PDF slide images..."
        sudo apt-get update -qq && sudo apt-get install -y poppler-utils 2>/dev/null \
          || warn "Skip for now — install poppler-utils later"
      fi
      ;;
  esac
}

install_cli() {
  if [[ "$GLOBAL" -eq 1 ]]; then
    log "Installing @imstudium/cli + @imstudium/mcp globally..."
    npm install -g @imstudium/cli @imstudium/mcp
  else
    log "Ready via npx (no global install needed)."
  fi
}

install_optional_tools
install_cli

log "Wiring all agent harnesses (Cursor, Claude, Codex, Windsurf, OpenCode)..."
if [[ "$GLOBAL" -eq 1 ]]; then
  imstudium onboard --agents-only -y -o "$WORKSPACE"
else
  npx -y @imstudium/cli onboard --agents-only -y -o "$WORKSPACE"
fi

echo ""
echo "✓ ImStudium is installed."
echo ""
echo "Next (one time, in your terminal):"
echo "  imstudium login"
echo "  # Opens your normal browser — sign in with your university account."
echo ""
echo "Then sync your courses:"
echo "  imstudium init -o $WORKSPACE"
echo "  imstudium sync --quiet --extract"
echo ""
echo "Workspace: $WORKSPACE"
echo ""
