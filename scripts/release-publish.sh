#!/usr/bin/env bash
# Publish the assembled @imstudium/sdk (.release/sdk, from
# scripts/assemble-sdk.ts) to npmjs.com with npm trusted publishing (OIDC, no
# token) and provenance; fail unless npm shows the provenance attestation.
#
# Used by .github/workflows/release.yml; never run it from a laptop.
#
#   bun scripts/assemble-sdk.ts && bash scripts/release-publish.sh
set -euo pipefail
cd "$(dirname "$0")/.."

dir=.release/sdk
[ -f "$dir/package.json" ] || { echo "$dir is missing: run bun scripts/assemble-sdk.ts first" >&2; exit 1; }
name=$(node -p "require('./$dir/package.json').name")
version=$(node -p "require('./$dir/package.json').version")
registry=$(node -p "require('./$dir/package.json').publishConfig.registry")

if [ "$registry" != "https://registry.npmjs.org/" ]; then
  echo "refusing: $name publishes to npmjs.com only, not $registry" >&2
  exit 1
fi
if [ -n "${NODE_AUTH_TOKEN:-}" ] || [ -n "${NPM_TOKEN:-}" ]; then
  echo "refusing: a token is set; releases publish via trusted publishing only" >&2
  exit 1
fi

if npm view "$name@$version" version >/dev/null 2>&1; then
  echo "$name@$version is already on npm, not publishing again"
else
  (cd "$dir" && npm publish --provenance --access public)
fi

# The registry needs a moment before a new version's metadata is visible;
# until then npm view fails, which must not end the script.
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  count=$( (npm view "$name@$version" dist.attestations --json 2>/dev/null || true) | node -e '
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
