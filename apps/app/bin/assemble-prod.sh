#!/bin/bash
# Assemble production artifacts for GROWI app.
# Run from the workspace root.
set -euo pipefail

echo "[1/4] Deploying production dependencies..."
rm -rf out
pnpm deploy out --prod --legacy --filter @growi/app
rm -rf apps/app/node_modules
mv out/node_modules apps/app/node_modules
echo "[1/4] Done."

# Redirect .next/node_modules/ symlinks from workspace root to deployed apps/app/node_modules/.pnpm/.
# Turbopack generates symlinks pointing to ../../../../node_modules/.pnpm/ (workspace root),
# which will not exist in production environments.
# Rewriting to ../../node_modules/.pnpm/ (apps/app/) uses the pnpm deploy output instead,
# preserving pnpm's isolated structure so transitive deps remain resolvable.
echo "[2/4] Rewriting .next/node_modules symlinks..."
if [ -d apps/app/.next/node_modules ]; then
  find apps/app/.next/node_modules -maxdepth 2 -type l | while read -r link; do
    target=$(readlink "$link")
    new_target=$(echo "$target" | sed 's|../../../../node_modules/\.pnpm/|../../node_modules/.pnpm/|')
    if [ "$target" != "$new_target" ]; then ln -sfn "$new_target" "$link"; fi
  done
else
  echo "[2/4] Skipped (no .next/node_modules directory)."
fi
echo "[2/4] Done."

echo "[3/4] Removing build cache..."
rm -rf apps/app/.next/cache
echo "[3/4] Done."

# Remove next.config.ts to prevent Next.js from attempting to install TypeScript at server startup,
# which would corrupt node_modules (e.g. @growi/core).
echo "[4/4] Removing next.config.ts..."
rm -f apps/app/next.config.ts
echo "[4/4] Done."

echo "Assembly complete."
