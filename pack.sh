#!/usr/bin/env bash
# pack.sh — bundle the extension into a Chrome Web Store–ready zip.
#
# Usage: ./pack.sh [--out <dir>]
#   --out   directory for the output zip (default: dist)
#
# Output: dist/llo-tracker-<version>.zip
# The zip contains extension files at root level (no wrapper directory),
# which is what the Chrome Web Store uploader expects.

set -euo pipefail

# ── Parse args ────────────────────────────────────────────────────────────────

OUTDIR="dist"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --out) OUTDIR="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

# ── Resolve paths ─────────────────────────────────────────────────────────────

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_ROOT"

# ── Read version from manifest ────────────────────────────────────────────────

VERSION=$(grep -o '"version"\s*:\s*"[^"]*"' manifest.json | grep -o '"[0-9][^"]*"' | tr -d '"')
if [[ -z "$VERSION" ]]; then
  echo "error: could not read version from manifest.json" >&2
  exit 1
fi

# ── Files to include ──────────────────────────────────────────────────────────
# Keep this list explicit so new dev files don't sneak into the release.

INCLUDE=(
  manifest.json
  background.js
  inject.js
  content.js
  content.css
  sidepanel/sidepanel.html
  sidepanel/sidepanel.js
  sidepanel/sidepanel.css
  icons/icon16.png
  icons/icon48.png
  icons/icon128.png
)

# ── Verify all files exist before touching anything ───────────────────────────

MISSING=()
for f in "${INCLUDE[@]}"; do
  [[ -e "$f" ]] || MISSING+=("$f")
done
if [[ ${#MISSING[@]} -gt 0 ]]; then
  echo "error: missing files:" >&2
  printf '  %s\n' "${MISSING[@]}" >&2
  exit 1
fi

# ── Build zip ─────────────────────────────────────────────────────────────────

mkdir -p "$OUTDIR"
OUTFILE="$OUTDIR/llo-tracker-${VERSION}.zip"
rm -f "$OUTFILE"

# Zip from REPO_ROOT so paths inside the archive are relative (no wrapper dir).
zip -q -r "$OUTFILE" "${INCLUDE[@]}"

# ── Summary ───────────────────────────────────────────────────────────────────

SIZE=$(du -sh "$OUTFILE" | cut -f1)
echo "✓ $OUTFILE  ($SIZE)"
echo ""
echo "Contents:"
zip -sf "$OUTFILE" | sed 's/^/  /'
echo ""
echo "Next: Chrome Web Store Developer Dashboard → upload the zip above."
