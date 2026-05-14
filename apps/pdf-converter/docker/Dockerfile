# syntax = docker/dockerfile:1.4

ARG NODE_VERSION=24
ARG OPT_DIR="/opt"

##
## base
##
FROM node:${NODE_VERSION}-slim AS base

ARG OPT_DIR

WORKDIR $OPT_DIR

# Activate corepack so the pnpm version pinned in the workspace package.json
# "packageManager" field is used (avoids drift between Dockerfile and local/CI).
RUN corepack enable
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

# install turbo
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
  pnpm add turbo --global



##
## builder
##
FROM base AS builder

WORKDIR $OPT_DIR

COPY . .

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
  pnpm install --frozen-lockfile --ignore-scripts

# build
RUN turbo run clean
RUN turbo run build --filter @growi/pdf-converter

# make artifacts
RUN pnpm deploy out --prod --legacy --filter @growi/pdf-converter
RUN rm -rf apps/pdf-converter/node_modules && mv out/node_modules apps/pdf-converter/node_modules
RUN tar -zcf /tmp/packages.tar.gz \
  package.json \
  apps/pdf-converter/package.json \
  apps/pdf-converter/dist \
  apps/pdf-converter/.env \
  apps/pdf-converter/node_modules



##
## release
##
ARG NODE_VERSION=24
FROM node:${NODE_VERSION}-slim
LABEL maintainer="Yuki Takei <yuki@weseek.co.jp>"

ARG OPT_DIR

ENV NODE_ENV="production"
ENV PUPPETEER_EXECUTABLE_PATH="/usr/bin/chromium"
ENV LANG="ja_JP.UTF-8"

ENV appDir="$OPT_DIR/pdf-converter"

RUN --mount=type=cache,target=/var/lib/apt,sharing=locked \
  --mount=type=cache,target=/var/cache/apt,sharing=locked \
  apt-get update; \
  apt-get install -y chromium fonts-lato fonts-ipafont-gothic fonts-noto-cjk gosu; \
  rm -rf /var/lib/apt/lists/*; \
  # verify that the binary works
  gosu nobody true

# extract artifacts as 'node' user
USER node
WORKDIR ${appDir}
RUN --mount=type=bind,from=builder,source=/tmp/packages.tar.gz,target=/tmp/packages.tar.gz \
  tar -zxf /tmp/packages.tar.gz -C ${appDir}/

COPY --chown=node:node --chmod=700 apps/pdf-converter/docker/docker-entrypoint.sh /

USER root
WORKDIR ${appDir}/apps/pdf-converter

EXPOSE 3010

ENTRYPOINT ["/docker-entrypoint.sh"]
