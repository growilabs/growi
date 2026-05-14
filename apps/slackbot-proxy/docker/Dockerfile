# syntax = docker/dockerfile:1

ARG NODE_VERSION=24

##
## base
##
FROM node:${NODE_VERSION}-slim AS base

ENV optDir="/opt"

WORKDIR ${optDir}

# Activate corepack so the pnpm version pinned in the workspace package.json
# "packageManager" field is used (avoids drift between Dockerfile and local/CI).
RUN corepack enable
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME/bin:$PATH"

# install turbo
# Note: no cache mount here — pnpm global install links binaries into the store,
# and the BuildKit cache mount would be unmounted after RUN, breaking those links.
RUN pnpm add turbo --global



##
## builder
##
FROM base AS builder

ENV optDir="/opt"

WORKDIR ${optDir}

COPY . .

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
  pnpm install --frozen-lockfile --ignore-scripts

# build
RUN turbo run build --filter @growi/slackbot-proxy

# make artifacts
RUN pnpm deploy out --prod --legacy --filter @growi/slackbot-proxy
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
ARG NODE_VERSION=24
FROM node:${NODE_VERSION}-slim
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
