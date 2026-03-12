#!/bin/bash
# Assemble production artifacts for GROWI app.
# Run from the workspace root.
set -euo pipefail

# Deploy production dependencies into out/, then replace apps/app/node_modules/.
rm -rf out
pnpm deploy out --prod --legacy --filter @growi/app
rm -rf apps/app/node_modules
mv out/node_modules apps/app/node_modules

# Redirect .next/node_modules/ symlinks from workspace root to deployed apps/app/node_modules/.pnpm/.
# Turbopack generates symlinks pointing to ../../../../node_modules/.pnpm/ (workspace root),
# which will not exist in production environments.
# Rewriting to ../../node_modules/.pnpm/ (apps/app/) uses the pnpm deploy output instead,
# preserving pnpm's isolated structure so transitive deps remain resolvable.
if [ -d apps/app/.next/node_modules ]; then
  find apps/app/.next/node_modules -maxdepth 2 -type l | while read -r link; do
    target=$(readlink "$link")
    new_target=$(echo "$target" | sed 's|../../../../node_modules/\.pnpm/|../../node_modules/.pnpm/|')
    [ "$target" != "$new_target" ] && ln -sfn "$new_target" "$link"
  done
fi

# Remove build cache
rm -rf apps/app/.next/cache

# Remove next.config.ts to prevent Next.js from attempting to install TypeScript at server startup,
# which would corrupt node_modules (e.g. @growi/core). The compiled next.config.js is used instead.
rm -f apps/app/next.config.ts
