# syntax=docker/dockerfile:1

ARG NODE_VERSION=24
ARG OPT_DIR="/opt"

##
## base — official Node.js image with pnpm + turbo
##
## Build stages run on the official image (not DHI) because corepack's global
## pnpm shim is not executable on the DHI dev image. Only the release stage uses
## DHI — the build artifacts (dist + prod node_modules) are pure JS, so running
## them on the DHI runtime carries no native-ABI risk. Mirrors apps/app.
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

RUN turbo prune @growi/vault-manager --docker


##
## deps — dependency installation (layer cached when only source changes)
##
FROM base AS deps

ARG OPT_DIR

WORKDIR $OPT_DIR

# Copy only package manifests and lockfile for dependency caching
COPY --from=pruner $OPT_DIR/out/json/ .

# Install dependencies (PNPM_HOME / PATH inherited from base)
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
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

# Build vault-manager
RUN turbo run build --filter @growi/vault-manager

# Produce artifacts (production-only node_modules)
RUN pnpm deploy out --prod --legacy --filter @growi/vault-manager
RUN rm -rf apps/growi-vault-manager/node_modules && \
  mv out/node_modules apps/growi-vault-manager/node_modules

# Stage artifacts into a clean directory for COPY --from
RUN mkdir -p /tmp/release/apps/growi-vault-manager && \
  cp package.json /tmp/release/ && \
  cp -a apps/growi-vault-manager/dist \
        apps/growi-vault-manager/node_modules \
        apps/growi-vault-manager/package.json \
        /tmp/release/apps/growi-vault-manager/


##
## release — DHI dev variant runtime (git binary required for git upload-pack spawn)
##
FROM dhi.io/node:24-debian13-dev AS release

ARG OPT_DIR

ENV NODE_ENV="production"
ENV appDir="$OPT_DIR/vault-manager"

# Copy artifacts from builder
WORKDIR ${appDir}
COPY --from=builder --chown=node:node /tmp/release/ ${appDir}/

# Copy the entrypoint, run directly via Node 24 type stripping. It lives outside
# src/ so it never enters the compiled dist/ artifact.
COPY --chown=node:node apps/growi-vault-manager/docker/docker-entrypoint.ts /docker-entrypoint.ts

# Stay root for the entrypoint: it creates/chowns the bare repo on the shared
# /data volume, then drops to the node user (uid/gid 1000) before exec'ing the
# app — so vault-manager and apps/app share the volume under one uid.
USER root
WORKDIR ${appDir}/apps/growi-vault-manager

# OCI standard labels
LABEL org.opencontainers.image.source="https://github.com/weseek/growi"
LABEL org.opencontainers.image.title="GROWI Vault Manager"
LABEL org.opencontainers.image.description="GROWI Vault internal execution engine: namespace tree builder + git upload-pack server"
LABEL org.opencontainers.image.vendor="WESEEK, Inc."
LABEL org.opencontainers.image.authors="Yuki Takei <yuki@weseek.co.jp>"

EXPOSE 3001

ENTRYPOINT ["node", "/docker-entrypoint.ts"]
