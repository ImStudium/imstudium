#!/usr/bin/env bash
# DigiCampus end-user installer — zero Bun/pnpm required.
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
DigiCampus install — works with Node/npm only (no Bun required).

  curl -fsSL .../scripts/install.sh | bash
  bash scripts/install.sh [--global] [-o ~/Studium]

Options:
  --global     npm install -g digicampus digicampus-mcp (default: npx, no global install)
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

install_system_tools() {
  local os
  os="$(uname -s)"
  case "$os" in
    Darwin)
      if has_cmd brew; then
        if ! has_cmd pdftotext; then
          log "Installing poppler (PDF + slide images)..."
          brew install poppler || warn "poppler install failed — run: brew install poppler"
        fi
      else
        warn "Install poppler for slide images: brew install poppler"
      fi
      ;;
    Linux)
      if has_cmd apt-get && ! has_cmd pdftotext; then
        log "Installing poppler-utils..."
        sudo apt-get update -qq && sudo apt-get install -y poppler-utils \
          || warn "Install poppler-utils manually for PDF page images"
      elif ! has_cmd pdftotext; then
        warn "Install poppler for slide images (poppler-utils on Debian/Ubuntu)"
      fi
      ;;
  esac
}

install_cli() {
  if [[ "$GLOBAL" -eq 1 ]]; then
    log "Installing digicampus + digicampus-mcp globally..."
    npm install -g digicampus digicampus-mcp
    DIGICAMPUS_CMD=digicampus
  else
    log "Using npx (no global install)..."
    DIGICAMPUS_CMD="npx -y digicampus"
  fi
}

install_system_tools
install_cli

log "Playwright Chromium (browser login)..."
npx -y playwright install chromium 2>/dev/null || warn "Playwright install skipped — run: npx playwright install chromium"

log "Onboarding workspace at $WORKSPACE..."
if [[ "$GLOBAL" -eq 1 ]]; then
  digicampus onboard -y -o "$WORKSPACE" \
    || digicampus onboard --agents-only -y -o "$WORKSPACE"
else
  npx -y digicampus onboard -y -o "$WORKSPACE" \
    || npx -y digicampus onboard --agents-only -y -o "$WORKSPACE"
fi

echo ""
echo "✓ DigiCampus is ready."
echo ""
echo "  Daily sync:  digicampus sync --quiet --extract"
echo "  Or via npx:  npx -y digicampus sync --quiet --extract"
echo "  Status:      digicampus setup status"
echo "  Workspace:   $WORKSPACE"
echo ""
echo "Next: digicampus login   # browser auth (MFA)"
echo ""
