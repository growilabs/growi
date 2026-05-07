# syntax = docker/dockerfile:1.4

ARG NODE_VERSION=24
ARG OPT_DIR="/opt"
ARG PNPM_HOME="/root/.local/share/pnpm"

##
## base
##
FROM node:${NODE_VERSION}-alpine AS base

ARG OPT_DIR
ARG PNPM_HOME

WORKDIR $OPT_DIR

# Install git binary required for git upload-pack (git v2.30+)
RUN apk add --no-cache git

# Install pnpm
RUN wget -qO- https://get.pnpm.io/install.sh | ENV="$HOME/.shrc" SHELL="$(which sh)" PNPM_VERSION="10.32.1" sh -
ENV PNPM_HOME=$PNPM_HOME
ENV PATH="$PNPM_HOME:$PATH"

# Install turbo
RUN --mount=type=cache,target=$PNPM_HOME/store,sharing=locked \
  pnpm add turbo --global



##
## builder
##
FROM base AS builder

ENV PNPM_HOME=$PNPM_HOME
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR $OPT_DIR

COPY . .

RUN --mount=type=cache,target=$PNPM_HOME/store,sharing=locked \
  pnpm install --frozen-lockfile

# Build vault-manager
RUN turbo run build --filter @growi/vault-manager

# Make artifacts
RUN pnpm deploy out --prod --legacy --filter @growi/vault-manager
RUN rm -rf apps/growi-vault-manager/node_modules && mv out/node_modules apps/growi-vault-manager/node_modules
RUN tar -zcf /tmp/packages.tar.gz \
  package.json \
  apps/growi-vault-manager/package.json \
  apps/growi-vault-manager/dist \
  apps/growi-vault-manager/node_modules



##
## release
##
ARG NODE_VERSION=24
FROM node:${NODE_VERSION}-alpine
LABEL maintainer="Yuki Takei <yuki@weseek.co.jp>"

ARG OPT_DIR

ENV NODE_ENV="production"

ENV appDir="$OPT_DIR/vault-manager"

# Install git binary for git upload-pack operations
RUN apk add --no-cache git

# Extract artifacts as 'node' user
USER node
WORKDIR ${appDir}
RUN --mount=type=bind,from=builder,source=/tmp/packages.tar.gz,target=/tmp/packages.tar.gz \
  tar -zxf /tmp/packages.tar.gz -C ${appDir}/

USER root
WORKDIR ${appDir}/apps/growi-vault-manager

EXPOSE 3001

CMD ["node", "dist/index.js"]
