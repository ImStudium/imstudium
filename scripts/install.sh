#!/usr/bin/env bash
# ImStudium end-user installer — Node/npm only. No Bun required when packages are on npm.
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/paddy-shrp/imstudium/main/scripts/install.sh | bash
#   bash scripts/install.sh [--global] [--workspace DIR]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

GLOBAL=1
WORKSPACE="${IMSTUDIUM_WORKSPACE:-$HOME/Studium}"
IMSTUDIUM_REPO="${IMSTUDIUM_REPO:-https://github.com/paddy-shrp/imstudium.git}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --global) GLOBAL=1; shift ;;
    --no-global) GLOBAL=0; shift ;;
    -o|--workspace) WORKSPACE="$2"; shift 2 ;;
    -h|--help)
      cat <<'EOF'
ImStudium install — Node.js 20+.

  curl -fsSL .../scripts/install.sh | bash
  bash scripts/install.sh [--no-global] [-o ~/Studium]

Options:
  --global          npm install -g @imstudium/cli @imstudium/mcp (default)
  --no-global       Use npx only (no global imstudium on PATH)
  -o, --workspace   Studium workspace path (default: ~/Studium)

Falls back to building from GitHub when @imstudium/cli is not on npm yet.
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

npm_package_available() {
  npm view @imstudium/cli version >/dev/null 2>&1
}

install_optional_tools() {
  : # ingest is AnyDoc + pdf-inspector (bundled). No Tesseract / poppler.
}

install_from_npm() {
  log "Installing @imstudium/cli + @imstudium/mcp from npm..."
  npm install -g @imstudium/cli @imstudium/mcp
}

install_from_source() {
  local src="${1:-}"
  if [[ -z "$src" ]]; then
    local install_dir="${IMSTUDIUM_INSTALL_DIR:-$HOME/.local/share/imstudium/source}"
    log "Installing source to $install_dir..."
    if ! has_cmd git; then
      die "git required to install from source. Install git or publish @imstudium/cli to npm."
    fi
    rm -rf "$install_dir"
    git clone --depth 1 "$IMSTUDIUM_REPO" "$install_dir"
    src="$install_dir"
  fi

  log "Building ImStudium from source ($src)..."
  ensure_bun
  (
    cd "$src"
    bun install --frozen-lockfile 2>/dev/null || bun install
    bun run build
    IMSTUDIUM_SOURCE="$src" bash scripts/link-global.sh
  )

  export PATH="$HOME/.local/bin:$PATH"
}

install_cli() {
  if npm_package_available; then
    if [[ "$GLOBAL" -eq 1 ]]; then
      install_from_npm
    else
      log "Using npx @imstudium/cli (no global install)."
    fi
    return
  fi

  warn "@imstudium/cli not on npm yet — installing from source."
  if [[ -f "${IMSTUDIUM_SOURCE:-$HOME/Documents/GitHub/imstudium}/packages/cli/dist/cli.js" ]]; then
    install_from_source "${IMSTUDIUM_SOURCE:-$HOME/Documents/GitHub/imstudium}"
  else
    install_from_source ""
  fi
}

imstudium_cmd() {
  export PATH="$HOME/.local/bin:$PATH"
  if has_cmd imstudium; then
    imstudium "$@"
  else
    npx -y @imstudium/cli "$@"
  fi
}

warn_path() {
  export PATH="$HOME/.local/bin:$PATH"
  if [[ "$GLOBAL" -eq 1 ]] && ! has_cmd imstudium; then
    local prefix
    prefix="$(npm prefix -g 2>/dev/null || echo "")"
    if [[ -n "$prefix" && -x "$prefix/bin/imstudium" ]]; then
      warn "imstudium not on PATH. Add: export PATH=\"$prefix/bin:\$PATH\""
    elif [[ -x "$HOME/.local/bin/imstudium" ]]; then
      warn "imstudium not on PATH. Add: export PATH=\"$HOME/.local/bin:\$PATH\""
    fi
  fi
}

install_optional_tools
install_cli
warn_path

log "Migrating legacy DigiCampus install (if any)..."
imstudium_cmd setup migrate -y -o "$WORKSPACE" 2>/dev/null || true

log "Wiring agent harnesses (Cursor, Claude, Codex, Windsurf, OpenCode)..."
imstudium_cmd onboard --agents-only -y -o "$WORKSPACE"

echo ""
echo "✓ ImStudium is installed."
echo ""
echo "Next (one time, in your terminal):"
echo "  imstudium login"
echo "  # Opens your normal browser — sign in with your university account."
echo ""
echo "Then sync your courses:"
echo "  imstudium sync --quiet --extract"
echo ""
echo "Workspace: $WORKSPACE"
echo ""
