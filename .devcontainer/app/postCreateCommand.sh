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

# Setup pnpm
SHELL=bash pnpm setup
eval "$(cat /home/vscode/.bashrc)"
pnpm config set store-dir /workspace/.pnpm-store

# Install turbo
pnpm install turbo --global

# Install Claude Code
pnpm install @anthropic-ai/claude-code --global

# Install dependencies
turbo run bootstrap
