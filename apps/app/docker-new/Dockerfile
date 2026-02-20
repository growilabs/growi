# syntax=docker/dockerfile:1

ARG OPT_DIR="/opt"
ARG PNPM_HOME="/root/.local/share/pnpm"

##
## base — DHI dev image with pnpm + turbo
##
FROM dhi.io/node:24-debian13-dev AS base

ARG OPT_DIR
ARG PNPM_HOME

WORKDIR $OPT_DIR

# Install build dependencies
RUN --mount=type=cache,target=/var/lib/apt,sharing=locked \
    --mount=type=cache,target=/var/cache/apt,sharing=locked \
  apt-get update && apt-get install -y --no-install-recommends ca-certificates wget

# Install pnpm (standalone script, no version hardcoding)
RUN wget -qO- https://get.pnpm.io/install.sh | ENV="$HOME/.shrc" SHELL=/bin/sh sh -
ENV PNPM_HOME=$PNPM_HOME
ENV PATH="$PNPM_HOME:$PATH"

# Install turbo globally
RUN --mount=type=cache,target=$PNPM_HOME/store,sharing=locked \
  pnpm add turbo --global


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
ARG PNPM_HOME

ENV PNPM_HOME=$PNPM_HOME
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR $OPT_DIR

# Copy only package manifests and lockfile for dependency caching
COPY --from=pruner $OPT_DIR/out/json/ .

# Install build tools and dependencies
RUN --mount=type=cache,target=$PNPM_HOME/store,sharing=locked \
  pnpm add node-gyp --global
RUN --mount=type=cache,target=$PNPM_HOME/store,sharing=locked \
  pnpm install --frozen-lockfile


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
RUN pnpm deploy out --prod --filter @growi/app
RUN rm -rf apps/app/node_modules && mv out/node_modules apps/app/node_modules
RUN rm -rf apps/app/.next/cache

# Stage artifacts into a clean directory for COPY --from
RUN mkdir -p /tmp/release/apps/app && \
  cp package.json /tmp/release/ && \
  cp -a apps/app/.next apps/app/config apps/app/dist apps/app/public \
       apps/app/resource apps/app/tmp apps/app/next.config.js \
       apps/app/package.json apps/app/node_modules \
       /tmp/release/apps/app/ && \
  (cp apps/app/.env.production* /tmp/release/apps/app/ 2>/dev/null || true)


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
COPY --chown=node:node apps/app/docker-new/docker-entrypoint.ts /docker-entrypoint.ts

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
