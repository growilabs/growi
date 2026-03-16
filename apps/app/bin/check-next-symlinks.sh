#!/bin/bash
# Check that all .next/node_modules/ symlinks resolve correctly after assemble-prod.sh.
# fslightbox-react is intentionally broken (useEffect-only import, never accessed during SSR).
# Usage: bash apps/app/bin/check-next-symlinks.sh (from monorepo root)
set -euo pipefail

NEXT_MODULES="apps/app/.next/node_modules"

broken=$(find "$NEXT_MODULES" -maxdepth 2 -type l | while read -r link; do
  linkdir=$(dirname "$link")
  target=$(readlink "$link")
  resolved=$(cd "$linkdir" 2>/dev/null && realpath -m "$target" 2>/dev/null || echo "UNRESOLVABLE")
  { [ "$resolved" = "UNRESOLVABLE" ] || [ ! -e "$resolved" ]; } && echo "BROKEN: $link"
done | grep -v 'fslightbox-react' || true)

if [ -n "$broken" ]; then
  echo "ERROR: Broken symlinks found in $NEXT_MODULES:"
  echo "$broken"
  echo "Move these packages from devDependencies to dependencies in apps/app/package.json."
  exit 1
fi

echo "OK: All $NEXT_MODULES symlinks resolve correctly."
