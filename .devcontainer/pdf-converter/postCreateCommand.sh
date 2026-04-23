# Instal additional packages
sudo apt update
sudo apt-get install -y --no-install-recommends \
  chromium fonts-lato fonts-ipafont-gothic fonts-noto-cjk
sudo apt-get clean -y

# Set permissions for shared directory for bulk export
mkdir -p /tmp/page-bulk-export
sudo chown -R node:node /tmp/page-bulk-export
sudo chmod 700 /tmp/page-bulk-export

# Setup pnpm
SHELL=bash pnpm setup
eval "$(cat /home/node/.bashrc)"
pnpm config set store-dir /workspace/.pnpm-store

# Update pnpm
pnpm i -g pnpm

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
