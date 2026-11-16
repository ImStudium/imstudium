#!/usr/bin/env bash
# Install the assembled @imstudium/sdk the way a student does (npm pack, then
# a global install from the tarball into a throwaway prefix) and start both
# commands: `imstudium --version` and one MCP handshake with tools/list.
# Nothing here signs in or reaches Stud.IP.
#
#   bun run build && bun scripts/assemble-sdk.ts && bash scripts/package-smoke.sh
set -euo pipefail
cd "$(dirname "$0")/.."

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
version=$(node -p "require('./.release/sdk/package.json').version")
tarball=$(cd .release/sdk && npm pack --pack-destination "$work" --silent | tail -1)
npm install -g --prefix "$work/prefix" "$work/$tarball" --allow-scripts=keytar --no-audit --no-fund >/dev/null

bin="$work/prefix/bin"
got=$("$bin/imstudium" --version)
[ "$got" = "$version" ] || { echo "imstudium --version says $got, expected $version" >&2; exit 1; }
echo "imstudium $got"

reply=$(printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' |
  HOME="$work/home" timeout 30 "$bin/imstudium-mcp" 2>/dev/null || true)
echo "$reply" | node -e '
  let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
    const msgs = s.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const init = msgs.find((m) => m.id === 1), list = msgs.find((m) => m.id === 2);
    if (!init?.result || !list?.result?.tools?.length) { console.error("imstudium-mcp did not answer the handshake"); process.exit(1); }
    if (init.result.serverInfo.version !== process.argv[1]) { console.error(`imstudium-mcp says ${init.result.serverInfo.version}`); process.exit(1); }
    console.log(`imstudium-mcp ${init.result.serverInfo.version}: ${list.result.tools.length} tools`);
  });' "$version"
