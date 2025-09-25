# syntax = docker/dockerfile:1

##
## base
##
FROM node:20-slim AS base

ENV optDir="/opt"

WORKDIR ${optDir}

# install pnpm
RUN apt-get update && apt-get install -y ca-certificates wget --no-install-recommends \
  && wget -qO- https://get.pnpm.io/install.sh | ENV="$HOME/.shrc" SHELL="$(which sh)" PNPM_VERSION="10.4.1" sh -
ENV PNPM_HOME="/root/.local/share/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

# install turbo
RUN pnpm add turbo --global



##
## builder
##
FROM base AS builder

ENV optDir="/opt"

WORKDIR ${optDir}

COPY . .

RUN pnpm add node-gyp --global
RUN pnpm install ---frozen-lockfile

# build
RUN turbo run build --filter @growi/slackbot-proxy

# make artifacts
RUN pnpm deploy out --prod --filter @growi/slackbot-proxy
RUN rm -rf apps/slackbot-proxy/node_modules && mv out/node_modules apps/slackbot-proxy/node_modules
RUN tar -zcf packages.tar.gz \
  package.json \
  apps/slackbot-proxy/package.json \
  apps/slackbot-proxy/dist \
  apps/slackbot-proxy/.env \
  apps/slackbot-proxy/node_modules



##
## release
##
FROM node:20-slim
LABEL maintainer="Yuki Takei <yuki@weseek.co.jp>"

ENV NODE_ENV="production"

ENV optDir="/opt"
ENV appDir="${optDir}/slackbot-proxy"

# copy artifacts
COPY --from=builder --chown=node:node \
  ${optDir}/packages.tar.gz ${appDir}/

# extract artifacts as 'node' user
USER node
WORKDIR ${appDir}
RUN tar -xf packages.tar.gz && rm packages.tar.gz

WORKDIR ${appDir}/apps/slackbot-proxy

EXPOSE 8080

CMD ["node", "-r", "dotenv-flow/config", "dist/index.js"]
