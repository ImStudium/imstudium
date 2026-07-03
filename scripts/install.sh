#!/usr/bin/env bash
# DigiCampus one-line install
set -euo pipefail

echo "→ Installing digicampus CLI + MCP..."
npm install -g digicampus digicampus-mcp

echo "→ Playwright Chromium (browser login)..."
npx playwright install chromium 2>/dev/null || true

echo "→ Onboard (idempotent)..."
digicampus onboard -y -o ~/Studium || digicampus onboard --agents-only -y -o ~/Studium

echo ""
echo "Done. Daily: digicampus sync --quiet --extract"
echo "Status:  digicampus setup status"
echo ""
