#!/usr/bin/env bash
# Publish one workspace package to the registry its publishConfig names.
#
#   GitHub Packages (npm.pkg.github.com, for now): with the workflow's own
#   GITHUB_TOKEN as NODE_AUTH_TOKEN. That registry has no provenance.
#   npmjs.com: with npm trusted publishing (OIDC, no token) and provenance;
#   the script fails unless npm shows an attestation for the package.
#
# Used by .github/workflows/release.yml; never run it from a laptop.
#
#   bash scripts/release-publish.sh <contract|sdk|cli|mcp>
set -euo pipefail
cd "$(dirname "$0")/.."

dir="${1:?package dir under packages/}"
name=$(node -p "require('./packages/$dir/package.json').name")
version=$(node -p "require('./packages/$dir/package.json').version")
registry=$(node -p "require('./packages/$dir/package.json').publishConfig.registry")

case "$registry" in
  https://npm.pkg.github.com*)
    if [ -z "${NODE_AUTH_TOKEN:-}" ] || [ -n "${NPM_TOKEN:-}" ]; then
      echo "refusing: GitHub Packages publishes with the workflow's GITHUB_TOKEN only" >&2
      exit 1
    fi
    if npm view "$name@$version" version --registry "$registry" >/dev/null 2>&1; then
      echo "$name@$version is already on GitHub Packages — not publishing again"
    else
      (cd "packages/$dir" && npm publish --registry "$registry")
    fi
    for attempt in 1 2 3 4 5 6; do
      if npm view "$name@$version" version --registry "$registry" >/dev/null 2>&1; then
        echo "$name@$version: on GitHub Packages"
        exit 0
      fi
      echo "waiting for $name@$version on GitHub Packages (attempt $attempt)…"
      sleep 10
    done
    echo "$name@$version is not visible on GitHub Packages" >&2
    exit 1
    ;;
  https://registry.npmjs.org*) ;;
  *)
    echo "refusing: unknown registry $registry for $name" >&2
    exit 1
    ;;
esac

if [ -n "${NODE_AUTH_TOKEN:-}" ] || [ -n "${NPM_TOKEN:-}" ]; then
  echo "refusing: a token is set; npmjs.com releases publish via trusted publishing only" >&2
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
