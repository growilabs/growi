#!/bin/bash
# init-home.sh
#
# Host-side initialization script. Invoked from devcontainer.json's initializeCommand
# before `docker compose up`, so that bind-mount target directories exist with the
# correct ownership/permission on the host. Without this, Docker creates the missing
# host directories as root, breaking writes from the non-root vscode user inside
# the container.
#
# Idempotent: safe to re-run; never destroys existing content.
#
# - Pre-create ~/.claude/, ~/.config/gh/, ~/.config/glab-cli/ on the host so the
#   compose bind mounts succeed.
# - Generate .devcontainer/compose.extend.yml as an empty-stub if missing, so
#   `docker compose up` does not fail with a missing-file error before the user
#   has authored their own extension.
# - Write UID/GID into .devcontainer/.env (merge, do not clobber existing keys)
#   so compose.yml can expand ${UID}/${GID} without depending on shell exports.
#
# POSIX-portable (bash + coreutils). No GNU-only flags so macOS/Linux both work.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEVCONTAINER_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DEVCONTAINER_ENV="${DEVCONTAINER_DIR}/.env"
COMPOSE_EXTEND="${DEVCONTAINER_DIR}/compose.extend.yml"

# ---------------------------------------------------------------------------
# Pre-create bind-mount target directories on the host.
# mkdir -p is idempotent and preserves existing contents.
# Creating them here (as the host user) prevents Docker from creating them
# as root when the bind mount is first applied.
# ---------------------------------------------------------------------------
mkdir -p \
    "${HOME}/.claude" \
    "${HOME}/.config/gh" \
    "${HOME}/.config/glab-cli"

# ---------------------------------------------------------------------------
# Stub compose.extend.yml: prevents file-not-found errors on `docker compose up`
# for users who have not authored their own overrides yet.
# ---------------------------------------------------------------------------
if [ ! -f "${COMPOSE_EXTEND}" ]; then
    cat > "${COMPOSE_EXTEND}" <<'EOF'
services:
  {}
EOF
fi

# ---------------------------------------------------------------------------
# Merge UID/GID into .devcontainer/.env without clobbering other keys.
# compose.yml and docker compose auto-load this file as a variable source.
# id -u / id -g are POSIX-standard on both macOS and Linux.
# ---------------------------------------------------------------------------
HOST_UID="$(id -u)"
HOST_GID="$(id -g)"

if [ -f "${DEVCONTAINER_ENV}" ]; then
    # Drop any existing UID=/GID= lines, then append fresh values.
    tmp_env="$(mktemp)"
    grep -Ev '^(UID|GID)=' "${DEVCONTAINER_ENV}" > "${tmp_env}" || true
    mv "${tmp_env}" "${DEVCONTAINER_ENV}"
fi

{
    echo "UID=${HOST_UID}"
    echo "GID=${HOST_GID}"
} >> "${DEVCONTAINER_ENV}"

echo "init-home.sh: initialization complete"
echo "  host dirs: ~/.claude, ~/.config/gh, ~/.config/glab-cli"
echo "  ${DEVCONTAINER_ENV}: UID=${HOST_UID}, GID=${HOST_GID}"
