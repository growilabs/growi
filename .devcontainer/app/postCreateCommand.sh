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
export PNPM_HOME="${PNPM_HOME:-$HOME/.local/share/pnpm}"
export PATH="$PNPM_HOME/bin:$HOME/.local/bin:$PATH"
mkdir -p "$PNPM_HOME"
# Use the Docker volume mounted at /workspace/.pnpm-store (see .devcontainer/compose.yml).
# Without this, pnpm auto-falls-back to <workspace>/.pnpm-store because $HOME
# (overlay FS) and the workspace (bind mount) are on different filesystems.
pnpm config set store-dir /workspace/.pnpm-store

pnpm install --global turbo

# Install dependencies
turbo run bootstrap

# Install Lefthook git hooks
pnpm lefthook install
