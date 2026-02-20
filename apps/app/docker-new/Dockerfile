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
RUN wget -qO- https://get.pnpm.io/install.sh | ENV="$HOME/.shrc" SHELL="$(which sh)" sh -
ENV PNPM_HOME=$PNPM_HOME
ENV PATH="$PNPM_HOME:$PATH"

# Install turbo globally
RUN --mount=type=cache,target=$PNPM_HOME/store,sharing=locked \
  pnpm add turbo --global



##
## builder — build + produce artifacts (current 3-stage COPY . . pattern)
##
FROM base AS builder

ARG OPT_DIR
ARG PNPM_HOME

ENV PNPM_HOME=$PNPM_HOME
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR $OPT_DIR

COPY . .

RUN --mount=type=cache,target=$PNPM_HOME/store,sharing=locked \
  pnpm add node-gyp --global
RUN --mount=type=cache,target=$PNPM_HOME/store,sharing=locked \
  pnpm install --frozen-lockfile

# Build
RUN turbo run clean
RUN turbo run build --filter @growi/app

# Produce artifacts
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
## release — DHI runtime (no shell, no additional binaries)
##
FROM dhi.io/node:24-debian13 AS release

ARG OPT_DIR

ENV NODE_ENV="production"
ENV appDir="$OPT_DIR/growi"

# Extract artifacts as node user
USER node
WORKDIR ${appDir}
RUN --mount=type=bind,from=builder,source=/tmp/packages.tar.gz,target=/tmp/packages.tar.gz \
  tar -zxf /tmp/packages.tar.gz -C ${appDir}/

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
