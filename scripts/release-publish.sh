#!/usr/bin/env bash
# Publish one workspace package with npm trusted publishing (OIDC, no token)
# and fail unless the registry shows a provenance attestation for it.
# Used by .github/workflows/release.yml; never run it from a laptop.
#
#   bash scripts/release-publish.sh <contract|sdk|cli|mcp>
set -euo pipefail
cd "$(dirname "$0")/.."

dir="${1:?package dir under packages/}"
name=$(node -p "require('./packages/$dir/package.json').name")
version=$(node -p "require('./packages/$dir/package.json').version")

if [ -n "${NODE_AUTH_TOKEN:-}" ] || [ -n "${NPM_TOKEN:-}" ]; then
  echo "refusing: a token is set; releases publish via trusted publishing only" >&2
  exit 1
fi

if npm view "$name@$version" version >/dev/null 2>&1; then
  echo "$name@$version is already on npm — not publishing again"
else
  (cd "packages/$dir" && npm publish --provenance --access public)
fi

# The registry needs a moment before the new version's metadata is visible.
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  count=$(npm view "$name@$version" dist.attestations --json 2>/dev/null | node -e '
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      try { const a = JSON.parse(s || "null"); console.log(a ? (Array.isArray(a) ? a.length : Object.keys(a).length) : 0); }
      catch { console.log(0); }
    });')
  if [ "${count:-0}" -gt 0 ]; then
    echo "$name@$version: provenance attestation present"
    exit 0
  fi
  echo "waiting for $name@$version attestations (attempt $attempt)…"
  sleep 15
done
echo "$name@$version has no provenance attestation on npm" >&2
exit 1
