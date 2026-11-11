#!/usr/bin/env bash
# The image check of the attachment-text-extractor (Req 8.1-8.3, 9.1, 9.5).
# The CI job runs the steps one by one (`memory` only when the workflow is
# started by hand); with docker, `check-image.sh all` runs the same steps on
# any machine.
#
#   check-image.sh <step>...
#
#   build     builds the image (context: the repository root)
#   size      the image is no larger than IMAGE_MAX_BYTES
#   contents  what the image must and must not hold
#   start     starts the container: read-only rootfs, uid 10001, no
#             capabilities, no network, no tmpfs
#   service   /readyz, POST /extract (PDF, DOCX), prlimit and /openapi.json,
#             checked from inside the container
#   memory    the memory figures of tasks 6.12 (minutes; not part of `all`)
#   logs      prints the container's log
#   stop      removes the container
#   all       build size contents start service, then stop
#
# `service` needs the workspace's dependencies installed here (it runs
# TypeScript).
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PACKAGE=$(cd "$HERE/../.." && pwd)
REPO=$(cd "$PACKAGE/../.." && pwd)

IMAGE_TAG=${IMAGE_TAG:-attachment-text-extractor:ci}
# Req 8.1.
IMAGE_MAX_BYTES=${IMAGE_MAX_BYTES:-400000000}
CONTAINER_NAME=${CONTAINER_NAME:-ate-smoke}
WORK_DIR=${WORK_DIR:-${RUNNER_TEMP:-${TMPDIR:-/tmp}}/ate-image-check}
# A file with this name in a node_modules of the checkout must not reach the
# build context.
SENTINEL=.ate-build-context-sentinel

mkdir -p "$WORK_DIR"

# Runs a TypeScript script of this package (the loader resolves from here).
ts_node() {
  (cd "$PACKAGE" && node --import @swc-node/register/esm-register "$@")
}

build() {
  local sentinels=() dir
  for dir in "$REPO/node_modules" "$PACKAGE/node_modules"; do
    if [[ -d "$dir" ]]; then
      touch "$dir/$SENTINEL"
      sentinels+=("$dir/$SENTINEL")
    fi
  done
  local status=0
  docker build --progress=plain -f "$PACKAGE/docker/Dockerfile" -t "$IMAGE_TAG" "$REPO" || status=$?
  if [[ $status -eq 0 ]]; then
    # The same build, stopped at the first stage: every layer is in the cache.
    docker build -f "$PACKAGE/docker/Dockerfile" --target builder -t "$IMAGE_TAG-builder" "$REPO" || status=$?
  fi
  if [[ ${#sentinels[@]} -gt 0 ]]; then rm -f "${sentinels[@]}"; fi
  return "$status"
}

size() {
  local bytes
  bytes=$(docker image inspect "$IMAGE_TAG" --format '{{.Size}}')
  echo "image size: ${bytes} bytes (limit ${IMAGE_MAX_BYTES})"
  test "$bytes" -le "$IMAGE_MAX_BYTES"
}

contents() {
  # The build context (Dockerfile.dockerignore): this app only, without its
  # tests, and nothing from a node_modules of the checkout.
  docker run --rm --network none "$IMAGE_TAG-builder" sh -c '
    set -eu
    apps=$(ls /opt/apps)
    if [ "$apps" != attachment-text-extractor ]; then
      echo "the build context holds other apps: $apps" >&2
      exit 1
    fi
    for path in \
      /opt/apps/attachment-text-extractor/test \
      /opt/apps/attachment-text-extractor/benchmark \
      "/opt/node_modules/$0" \
      "/opt/apps/attachment-text-extractor/node_modules/$0"
    do
      if [ -e "$path" ]; then
        echo "in the build context, but must be ignored: $path" >&2
        exit 1
      fi
    done
  ' "$SENTINEL"

  # The image, as its own default user.
  docker run --rm --network none --read-only "$IMAGE_TAG" sh -c '
    set -eu
    uid=$(id -u)
    if [ "$uid" != 10001 ]; then
      echo "the image runs as uid $uid, not 10001" >&2
      exit 1
    fi
    for file in \
      /app/package.json \
      /app/dist/main.js \
      /app/dist/child/child-entry.js \
      /licenses/THIRD-PARTY-NOTICES.md \
      /licenses/pdfium-wasm/pdfium/LICENSE \
      /licenses/pdfium-wasm/pdfium/LICENSE.pdfium
    do
      if [ ! -s "$file" ]; then
        echo "missing from the image: $file" >&2
        exit 1
      fi
    done
    for path in \
      /app/src /app/test /app/benchmark /app/scripts \
      /app/node_modules/vitest \
      /app/node_modules/@swc /app/node_modules/@swc-node \
      /app/node_modules/playwright-core
    do
      if [ -e "$path" ]; then
        echo "must not be in the image: $path" >&2
        exit 1
      fi
    done
    node --version
    /usr/bin/prlimit --version
  '
}

start() {
  local token
  token=$(node -e 'process.stdout.write(require("node:crypto").randomBytes(16).toString("hex"))')
  # No published port exists with --network none, so `service` checks from
  # inside the container. No tmpfs: the service writes no file.
  ATTACHMENT_EXTRACTOR_SERVICE_TOKEN="$token" docker run -d --name "$CONTAINER_NAME" \
    --read-only --user 10001:10001 --cap-drop ALL --security-opt no-new-privileges \
    --network none \
    -e ATTACHMENT_EXTRACTOR_SERVICE_TOKEN \
    "$IMAGE_TAG"
}

# Runs service-client.mjs inside the container.
client() {
  docker exec -i "$CONTAINER_NAME" node --input-type=module -e "$(cat "$HERE/service-client.mjs")" -- "$@"
}

service() {
  local attempt ready=0
  for attempt in $(seq 1 30); do
    if client readyz </dev/null; then
      ready=1
      break
    fi
    echo "not ready yet (attempt $attempt)" >&2
    sleep 2
  done
  if [[ $ready -ne 1 ]]; then
    echo "the service did not become ready" >&2
    return 1
  fi

  ts_node scripts/image-check/generate-samples.ts --out-dir "$WORK_DIR/samples" >"$WORK_DIR/samples.tsv"
  local file mime marker extracted=0
  while IFS=$'\t' read -r file mime marker <&3; do
    client extract --filename "$file" --mime "$mime" --expect "$marker" <"$WORK_DIR/samples/$file"
    extracted=$((extracted + 1))
  done 3<"$WORK_DIR/samples.tsv"
  # A PDF and a DOCX (Req 8.2): an empty or cut-short list must not pass.
  if [[ $extracted -lt 2 ]]; then
    echo "only $extracted sample(s) went through POST /extract; a PDF and a DOCX are required" >&2
    return 1
  fi

  # Req 9.5: under the container's own conditions.
  client prlimit </dev/null

  # The document the image serves (production dependencies only) is the one
  # the export script writes from the sources.
  client openapi </dev/null >"$WORK_DIR/openapi.served.json"
  ts_node scripts/export-openapi.ts --output "$WORK_DIR/openapi.exported.json"
  node "$PACKAGE/scripts/check-openapi-drift.ts" "$WORK_DIR/openapi.served.json" "$WORK_DIR/openapi.exported.json"
  echo "the served OpenAPI document equals the exported one"
}

memory() {
  ts_node scripts/image-check/memory/measure-memory.ts --image "$IMAGE_TAG" \
    ${GITHUB_STEP_SUMMARY:+--summary "$GITHUB_STEP_SUMMARY"}
}

logs() {
  docker logs "$CONTAINER_NAME"
}

stop() {
  docker rm -f "$CONTAINER_NAME"
}

all() {
  # The log first when a step failed; the container goes either way.
  trap 'if [[ $? -ne 0 ]]; then docker logs "$CONTAINER_NAME" || true; fi; docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true' EXIT
  build
  size
  contents
  start
  service
}

if [[ $# -eq 0 ]]; then
  sed -n '2,/^set -euo/p' "${BASH_SOURCE[0]}" | sed '$d' >&2
  exit 2
fi
for step in "$@"; do
  case "$step" in
    build | size | contents | start | service | memory | logs | stop | all) "$step" ;;
    *)
      echo "unknown step: $step" >&2
      exit 2
      ;;
  esac
done
