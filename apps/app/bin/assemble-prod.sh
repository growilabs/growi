#!/bin/bash
# Assemble production artifacts for GROWI app.
# Run from the workspace root.
set -euo pipefail

echo "[1/3] Deploying production dependencies..."
rm -rf out
pnpm deploy out --prod --legacy --filter @growi/app
rm -rf node_modules
mv out/node_modules node_modules
rm -rf apps/app/node_modules
ln -sfn ../../node_modules apps/app/node_modules
rm -rf out
echo "[1/3] Done."

echo "[2/3] Removing build cache..."
rm -rf apps/app/.next/cache
echo "[2/3] Done."

# Remove next.config.ts to prevent Next.js from attempting to install TypeScript at server startup,
# which would corrupt node_modules (e.g. @growi/core).
echo "[3/3] Removing next.config.ts..."
rm -f apps/app/next.config.ts
echo "[3/3] Done."

echo "Assembly complete."
