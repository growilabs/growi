# syntax=docker/dockerfile:1

ARG NODE_VERSION=24
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

RUN turbo prune @growi/vault-manager --docker


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

# Install dependencies
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
LABEL maintainer="Yuki Takei <yuki@weseek.co.jp>"

ARG OPT_DIR

ENV NODE_ENV="production"
ENV appDir="$OPT_DIR/vault-manager"

# Copy artifacts from builder
WORKDIR ${appDir}
COPY --from=builder --chown=node:node /tmp/release/ ${appDir}/

USER root
WORKDIR ${appDir}/apps/growi-vault-manager

EXPOSE 3001

CMD ["node", "dist/index.js"]
