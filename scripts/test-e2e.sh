#!/usr/bin/env bash
# Full local pipeline smoke — temp workspace, no network auth required.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$ROOT/packages/cli/dist/cli.js"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "==> E2E workspace: $TMP"

COURSE_SLUG="Test-Course"
mkdir -p "$TMP/current/$COURSE_SLUG/files"
cat > "$TMP/studium.json" <<EOF
{
  "schemaVersion": "1",
  "generatedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "instanceUrl": "https://example.edu",
  "semesters": ["current"],
  "courses": [{
    "id": "e2e-1",
    "title": "Test Course",
    "slug": "$COURSE_SLUG",
    "fileCount": 2,
    "examDates": []
  }],
  "nextDeadlines": []
}
EOF

echo "sample lecture notes" > "$TMP/current/$COURSE_SLUG/files/vorlesung.txt"
echo "# Slides" > "$TMP/current/$COURSE_SLUG/files/folien.md"

node "$CLI" doctor --json | grep -q '"schemaVersion": "1"'
node "$CLI" extract --course "$COURSE_SLUG" -o "$TMP" --json | grep -q '"extracted": 2'

EXTRACTED="$TMP/current/$COURSE_SLUG/extracted"
test -d "$EXTRACTED"
test -f "$EXTRACTED/vorlesung-txt/content.md"

node "$CLI" extract --course "$COURSE_SLUG" -o "$TMP" --json | grep -q '"skipped": 2'

node "$CLI" view --dir "$EXTRACTED/vorlesung-txt" --json | grep -q 'requiredAction'

node "$CLI" setup status --json | grep -q '"detected"'

echo "==> E2E OK"
