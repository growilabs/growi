#!/bin/bash
# Check that all .next/node_modules/ symlinks resolve correctly after assemble-prod.sh.
# Usage: bash apps/app/bin/check-next-symlinks.sh (from monorepo root)
set -euo pipefail

NEXT_MODULES="apps/app/.next/node_modules"

# Packages that are intentionally broken symlinks.
# These are only imported via useEffect + dynamic import() and never accessed during SSR.
ALLOWED_BROKEN=(
  fslightbox-react
  @emoji-mart/data
  @emoji-mart/react
  socket.io-client
)

# Build a grep -v pattern from the allowlist
grep_args=()
for pkg in "${ALLOWED_BROKEN[@]}"; do
  grep_args+=(-e "$pkg")
done

broken=$(find "$NEXT_MODULES" -maxdepth 2 -type l | while read -r link; do
  linkdir=$(dirname "$link")
  target=$(readlink "$link")
  resolved=$(cd "$linkdir" 2>/dev/null && realpath -m "$target" 2>/dev/null || echo "UNRESOLVABLE")
  { [ "$resolved" = "UNRESOLVABLE" ] || [ ! -e "$resolved" ]; } && echo "BROKEN: $link"
done | grep -v "${grep_args[@]}" || true)

if [ -n "$broken" ]; then
  echo "ERROR: Broken symlinks found in $NEXT_MODULES:"
  echo "$broken"
  echo ""
  echo "Each broken package must be either:"
  echo "  1. Moved from devDependencies to dependencies in apps/app/package.json"
  echo "  2. Added to ALLOWED_BROKEN in this script (if only used via useEffect + dynamic import)"
  echo ""
  echo "Fix: Follow the step-by-step procedure in apps/app/.claude/skills/learned/fix-broken-next-symlinks/SKILL.md"
  echo "     You MUST execute every step in order — do NOT skip assemble-prod.sh when verifying."
  echo "Ref: apps/app/.claude/rules/package-dependencies.md"
  exit 1
fi

echo "OK: All $NEXT_MODULES symlinks resolve correctly."
