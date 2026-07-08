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
## jemalloc — provides libjemalloc2 for the hardened runtime (which has no
## package manager). debian:13 matches the release image's distro so the
## library is built against the same glibc generation. Its only runtime deps
## (libc/libm/libstdc++/libgcc) are already present in any Node.js image.
##
FROM debian:13-slim AS jemalloc

# Normalize the multiarch path (x86_64-linux-gnu / aarch64-linux-gnu) to one
# canonical location so the release-stage COPY needs no wildcard-rename.
RUN apt-get update \
  && apt-get install -y --no-install-recommends libjemalloc2 \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /jemalloc \
  && cp /usr/lib/*-linux-gnu/libjemalloc.so.2 /jemalloc/libjemalloc.so.2


##
## release — DHI runtime (no shell, no additional binaries)
##
FROM dhi.io/node:24-debian13 AS release

ARG OPT_DIR

ENV NODE_ENV="production"
ENV appDir="$OPT_DIR/growi"

# Copy artifacts from builder (no shell required)
WORKDIR ${appDir}
COPY --from=builder --chown=node:node /tmp/release/ ${appDir}/

# Copy TypeScript entrypoint
COPY --chown=node:node apps/app/docker/docker-entrypoint.ts /docker-entrypoint.ts

# jemalloc for the opt-in allocator (JEMALLOC_ENABLED=true — see
# docker-entrypoint.ts).
COPY --from=jemalloc /jemalloc/libjemalloc.so.2 /usr/local/lib/libjemalloc.so.2

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
