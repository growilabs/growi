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

# Install dependencies
turbo run bootstrap
