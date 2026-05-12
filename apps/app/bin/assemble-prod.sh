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

# Provide a CJS runtime config so the production server can load it without TypeScript.
# next.config.js takes precedence over next.config.ts in Next.js, so the .ts file
# is left in place but effectively ignored at runtime.
echo "[4/4] Installing runtime next.config.js..."
cp apps/app/next.config.prod.cjs apps/app/next.config.js
echo "[4/4] Done."

echo "Assembly complete."
