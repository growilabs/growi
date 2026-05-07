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

# Setup pnpm
SHELL=bash pnpm setup
eval "$(cat /home/vscode/.bashrc)"
pnpm config set store-dir /workspace/.pnpm-store

# Install turbo
pnpm install turbo --global

# Install typescript-language-server for Claude Code LSP plugin
# Use `npm -g` (not `pnpm --global`) so the binary lands in nvm's node bin, which is on the default PATH.
# pnpm's global bin requires PNPM_HOME from ~/.bashrc, which the Claude Code extension's shell doesn't source.
npm install -g typescript-language-server typescript

# Install dependencies
turbo run bootstrap

# Install Lefthook git hooks
pnpm lefthook install
