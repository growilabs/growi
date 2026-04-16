#!/bin/bash
set -euo pipefail

# Only run in remote (Claude Code on the web) environments
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# Install all workspace dependencies.
# turbo (root devDependency) and all workspace packages will be installed.
pnpm install

# Install turbo globally (mirrors devcontainer postCreateCommand.sh) so it is
# available as a bare `turbo` command in subsequent Claude tool calls.
# Falls back to adding node_modules/.bin to PATH if the pnpm global store is
# not yet configured in this environment.
if ! command -v turbo &> /dev/null; then
  pnpm install turbo --global 2>/dev/null \
    || echo "export PATH=\"$CLAUDE_PROJECT_DIR/node_modules/.bin:\$PATH\"" >> "$CLAUDE_ENV_FILE"
fi
