#!/bin/bash
# Assemble production artifacts for GROWI app.
# Run from the workspace root.
set -euo pipefail

echo "[1/4] Collecting production dependencies..."
rm -rf out
pnpm deploy out --prod --legacy --filter @growi/app
echo "[1/4] Done."

echo "[2/4] Reorganizing node_modules..."
rm -rf node_modules
mv out/node_modules node_modules
rm -rf apps/app/node_modules
ln -sfn ../../node_modules apps/app/node_modules
rm -rf out
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
