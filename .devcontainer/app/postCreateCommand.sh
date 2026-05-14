sudo chown -R vscode:vscode /workspace;

# Instal additional packages
sudo apt update
sudo apt-get install -y --no-install-recommends \
  iputils-ping net-tools dnsutils
sudo apt-get clean -y

# Set permissions for shared directory for bulk export
mkdir -p /tmp/page-bulk-export
sudo chown -R vscode:vscode /tmp/page-bulk-export
sudo chmod 700 /tmp/page-bulk-export

# Install uv
curl -LsSf https://astral.sh/uv/install.sh | sh

# Install Claude Code
curl -fsSL https://claude.ai/install.sh | bash

# Install global Node.js tools via pnpm.
# PNPM_HOME and PATH are exposed to every VS Code shell via `remoteEnv` in devcontainer.json,
# so installed binaries are discoverable without sourcing ~/.bashrc.
# - turbo: monorepo task runner used by `turbo run bootstrap` below
# - typescript-language-server, typescript: for Claude Code LSP plugin
mkdir -p "$PNPM_HOME"
pnpm install --global turbo typescript-language-server typescript

# Install dependencies
turbo run bootstrap

# Install Lefthook git hooks
pnpm lefthook install
