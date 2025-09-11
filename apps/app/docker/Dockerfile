# syntax = docker/dockerfile:1.4

ARG OPT_DIR="/opt"
ARG PNPM_HOME="/root/.local/share/pnpm"

##
## base
##
FROM node:22-slim AS base

ARG OPT_DIR
ARG PNPM_HOME

WORKDIR $OPT_DIR

# install tools
RUN --mount=type=cache,target=/var/lib/apt,sharing=locked \
    --mount=type=cache,target=/var/cache/apt,sharing=locked \
  apt-get update && apt-get install -y ca-certificates wget curl --no-install-recommends

# install pnpm
RUN wget -qO- https://get.pnpm.io/install.sh | ENV="$HOME/.shrc" SHELL="$(which sh)" PNPM_VERSION="10.4.1" sh -
ENV PNPM_HOME=$PNPM_HOME
ENV PATH="$PNPM_HOME:$PATH"

# install turbo
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
  pnpm add node-gyp --global
RUN --mount=type=cache,target=$PNPM_HOME/store,sharing=locked \
  pnpm install ---frozen-lockfile

# build
RUN turbo run clean
RUN turbo run build --filter @growi/app

# make artifacts
RUN pnpm deploy out --prod --filter @growi/app
RUN rm -rf apps/app/node_modules && mv out/node_modules apps/app/node_modules
RUN rm -rf apps/app/.next/cache
RUN tar -zcf /tmp/packages.tar.gz \
  package.json \
  apps/app/.next \
  apps/app/config \
  apps/app/dist \
  apps/app/public \
  apps/app/resource \
  apps/app/tmp \
  apps/app/.env.production* \
  apps/app/next.config.js \
  apps/app/package.json \
  apps/app/node_modules



##
## release
##
FROM node:22-slim
LABEL maintainer="Yuki Takei <yuki@weseek.co.jp>"

ARG OPT_DIR

ENV NODE_ENV="production"

ENV appDir="$OPT_DIR/growi"

# Add gosu
# see: https://github.com/tianon/gosu/blob/1.13/INSTALL.md
RUN --mount=type=cache,target=/var/lib/apt,sharing=locked \
    --mount=type=cache,target=/var/cache/apt,sharing=locked \
  set -eux; \
	apt-get update; \
	apt-get install -y gosu; \
	rm -rf /var/lib/apt/lists/*; \
# verify that the binary works
	gosu nobody true

# extract artifacts as 'node' user
USER node
WORKDIR ${appDir}
RUN --mount=type=bind,from=builder,source=/tmp/packages.tar.gz,target=/tmp/packages.tar.gz \
  tar -zxf /tmp/packages.tar.gz -C ${appDir}/

COPY --chown=node:node --chmod=700 apps/app/docker/docker-entrypoint.sh /

USER root
WORKDIR ${appDir}/apps/app

VOLUME /data
EXPOSE 3000

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["npm run migrate && node -r dotenv-flow/config --expose_gc dist/server/app.js"]
