# syntax=docker/dockerfile:1

ARG NODE_VERSION=24
ARG OPT_DIR="/opt"

##
## base — official Node.js image with pnpm + turbo
##
FROM node:24-bookworm AS base

ARG OPT_DIR

WORKDIR $OPT_DIR

# Activate corepack so the pnpm version pinned in the workspace package.json
# "packageManager" field is used (avoids drift between Dockerfile and local/CI).
RUN corepack enable
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME/bin:$PATH"

# Install turbo globally
# Note: no cache mount here — pnpm global install links binaries into the store,
# and the BuildKit cache mount would be unmounted after RUN, breaking those links.
RUN pnpm add turbo --global


##
## pruner — turbo prune for Docker-optimized monorepo subset
##
FROM base AS pruner

ARG OPT_DIR

WORKDIR $OPT_DIR

COPY . .

# Include @growi/pdf-converter because @growi/pdf-converter-client has a turbo
# task dependency on @growi/pdf-converter#gen:swagger-spec (generates the OpenAPI
# spec that orval uses to build the client). Without it, turbo cannot resolve
# the cross-package task dependency in the pruned workspace.
RUN turbo prune @growi/app @growi/pdf-converter --docker


##
## deps — dependency installation (layer cached when only source changes)
##
FROM base AS deps

ARG OPT_DIR

WORKDIR $OPT_DIR

# Copy only package manifests and lockfile for dependency caching
COPY --from=pruner $OPT_DIR/out/json/ .

# --ignore-scripts: postinstall (prisma generate) needs full source, runs in builder stage.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
  pnpm install --frozen-lockfile --ignore-scripts


##
## builder — build + produce artifacts
##
FROM deps AS builder

ARG OPT_DIR

WORKDIR $OPT_DIR

# Copy full source on top of installed dependencies
COPY --from=pruner $OPT_DIR/out/full/ .

# turbo prune does not include root-level config files in its output.
# tsconfig.base.json is referenced by most packages via "extends": "../../tsconfig.base.json"
COPY tsconfig.base.json .

# Build
RUN turbo run clean
RUN turbo run build --filter @growi/app

# Produce artifacts
RUN bash apps/app/bin/assemble-prod.sh

# Point a fixed-name symlink at the Prisma query engine for THIS image's target
# architecture. The release stage references it via a static PRISMA_QUERY_ENGINE_LIBRARY,
# which @prisma/client returns verbatim — WITHOUT an existence check and skipping its
# internal engine search, which the Turbopack-bundled SSR client cannot satisfy at
# runtime (its __dirname / baked output paths are rewritten). A wrong or dangling target
# would therefore only surface at runtime as a prod-only 500, so this step is
# deliberately fail-fast:
#   - arch comes from BuildKit's TARGETARCH, not `dpkg`/`uname`: it is independent of the
#     builder base image and of future `--platform`/buildx multi-arch builds. Non-BuildKit
#     builders leave it empty, which is intentionally unsupported (-> exit 1); CI enables
#     BuildKit via DOCKER_BUILDKIT=1 (apps/app/docker/codebuild/buildspec.yml).
#   - an unknown/unset arch exits 1 (no silent `sed` passthrough)
#   - the real engine must exist (`test -f`) before the symlink is created (no dangling link)
# NOTE: keep this arch->target mapping in sync with apps/app/prisma/schema.prisma
# `binaryTargets` and the runtime base image libc (dhi.io/node:24-debian13 = glibc).
ARG TARGETARCH
RUN set -eu; \
  case "$TARGETARCH" in \
    amd64) target=debian-openssl-3.0.x ;; \
    arm64) target=linux-arm64-openssl-3.0.x ;; \
    *) echo "unsupported/unset TARGETARCH='$TARGETARCH' — enable BuildKit (DOCKER_BUILDKIT=1) or use docker buildx" >&2; exit 1 ;; \
  esac; \
  dir=apps/app/dist/generated/prisma; \
  test -f "$dir/libquery_engine-${target}.so.node" \
    || { echo "prisma engine missing: libquery_engine-${target}.so.node" >&2; exit 1; }; \
  ln -sfn "libquery_engine-${target}.so.node" "$dir/libquery_engine-active.so.node"

# Stage artifacts into a clean directory for COPY --from
RUN mkdir -p /tmp/release/apps/app && \
  cp package.json /tmp/release/ && \
  cp -a node_modules /tmp/release/ && \
  cp -a apps/app/.next apps/app/config apps/app/dist apps/app/public \
       apps/app/resource apps/app/tmp \
       apps/app/package.json apps/app/node_modules \
       apps/app/next.config.js \
       /tmp/release/apps/app/ && \
  (cp apps/app/.env.production* /tmp/release/apps/app/ 2>/dev/null || true)


##
## release — DHI runtime (no shell, no additional binaries)
##
FROM dhi.io/node:24-debian13 AS release

ARG OPT_DIR

ENV NODE_ENV="production"
ENV appDir="$OPT_DIR/growi"

# Resolve the Prisma query engine via this public, stable env var. @prisma/client
# returns it directly, before (and instead of) its internal engine search — which the
# Turbopack-bundled SSR client cannot satisfy at runtime. Points at the per-arch
# `libquery_engine-active.so.node` symlink staged in the builder stage.
ENV PRISMA_QUERY_ENGINE_LIBRARY="${appDir}/apps/app/dist/generated/prisma/libquery_engine-active.so.node"

# Copy artifacts from builder (no shell required)
WORKDIR ${appDir}
COPY --from=builder --chown=node:node /tmp/release/ ${appDir}/

# Copy TypeScript entrypoint
COPY --chown=node:node apps/app/docker/docker-entrypoint.ts /docker-entrypoint.ts

# Switch back to root for entrypoint (it handles privilege drop)
USER root
WORKDIR ${appDir}/apps/app

# OCI standard labels
LABEL org.opencontainers.image.source="https://github.com/weseek/growi"
LABEL org.opencontainers.image.title="GROWI"
LABEL org.opencontainers.image.description="Team collaboration wiki using Markdown"
LABEL org.opencontainers.image.vendor="WESEEK, Inc."

VOLUME /data
EXPOSE 3000

ENTRYPOINT ["node", "/docker-entrypoint.ts"]
