#!/usr/bin/env bash
# Link imstudium + imstudium-mcp into PATH via wrapper scripts (works with Bun workspaces).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

ROOT="${IMSTUDIUM_SOURCE:-$ROOT}"
BIN_DIR="${IMSTUDIUM_BIN_DIR:-$HOME/.local/bin}"
CLI_JS="$ROOT/packages/cli/dist/cli.js"
MCP_JS="$ROOT/packages/mcp/dist/index.js"

[[ -f "$CLI_JS" ]] || die "Build first: bun run build (missing $CLI_JS)"
[[ -f "$MCP_JS" ]] || die "Build first: bun run build (missing $MCP_JS)"

mkdir -p "$BIN_DIR"

cat > "$BIN_DIR/imstudium" <<EOF
#!/usr/bin/env bash
exec node "$CLI_JS" "\$@"
EOF

cat > "$BIN_DIR/imstudium-mcp" <<EOF
#!/usr/bin/env bash
exec node "$MCP_JS" "\$@"
EOF

chmod +x "$BIN_DIR/imstudium" "$BIN_DIR/imstudium-mcp"

log "Linked:"
echo "  $BIN_DIR/imstudium"
echo "  $BIN_DIR/imstudium-mcp"

if ! has_cmd imstudium; then
  case ":$PATH:" in
    *":$BIN_DIR:"*) ;;
    *)
      warn "Add to PATH: export PATH=\"$BIN_DIR:\$PATH\""
      ;;
  esac
fi
