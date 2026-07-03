#!/usr/bin/env bash
# DigiCampus end-user installer — Node/npm only. No Bun, no Playwright, no Chrome permissions.
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/paddy-shrp/digicampus/main/scripts/install.sh | bash
#   bash scripts/install.sh [--global] [--workspace DIR]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

GLOBAL=0
WORKSPACE="${DIGICAMPUS_WORKSPACE:-$HOME/Studium}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --global) GLOBAL=1; shift ;;
    -o|--workspace) WORKSPACE="$2"; shift 2 ;;
    -h|--help)
      cat <<'EOF'
DigiCampus install — Node.js only. No Bun or extra browser tools required.

  curl -fsSL .../scripts/install.sh | bash
  bash scripts/install.sh [--global] [-o ~/Studium]

Options:
  --global          npm install -g digicampus digicampus-mcp
  -o, --workspace   Studium workspace path (default: ~/Studium)
EOF
      exit 0
      ;;
    *) die "Unknown option: $1 (try --help)" ;;
  esac
done

echo ""
echo "DigiCampus Studium OS"
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
    log "Installing digicampus + digicampus-mcp globally..."
    npm install -g digicampus digicampus-mcp
  else
    log "Ready via npx (no global install needed)."
  fi
}

install_optional_tools
install_cli

log "Wiring Cursor / Claude / Codex agents..."
if [[ "$GLOBAL" -eq 1 ]]; then
  digicampus onboard --agents-only -y -o "$WORKSPACE"
else
  npx -y digicampus onboard --agents-only -y -o "$WORKSPACE"
fi

echo ""
echo "✓ DigiCampus is installed."
echo ""
echo "Next (one time, in your terminal):"
echo "  digicampus login"
echo "  # Opens your normal browser — saved passwords work. Paste one cookie when done."
echo ""
echo "Then sync your courses:"
echo "  digicampus init -o $WORKSPACE"
echo "  digicampus sync --quiet --extract"
echo ""
echo "Workspace: $WORKSPACE"
echo ""
