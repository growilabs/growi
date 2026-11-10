# syntax = docker/dockerfile:1

# Build from the repository root (the pnpm workspace and its lockfile are needed):
#   docker build -f apps/attachment-text-extractor/docker/Dockerfile .

# Pinned to an exact patch version; glibc (Debian), because anydoc ships a
# prebuilt -gnu native binary. Bump deliberately, together with CI.
ARG NODE_IMAGE=node:24.22.2-bookworm-slim

##
## builder
##
FROM ${NODE_IMAGE} AS builder

WORKDIR /opt

# Activate corepack so the pnpm version pinned in the workspace package.json
# "packageManager" field is used (avoids drift between Dockerfile and local/CI).
RUN corepack enable
ENV PNPM_HOME="/pnpm"

COPY . .

# The whole workspace, because the build script takes `tsc` and `rimraf` from
# the root devDependencies.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
  pnpm install --frozen-lockfile --ignore-scripts

RUN pnpm --filter @growi/attachment-text-extractor run build

# Production dependencies only. --legacy: the workspace does not inject
# workspace packages (same as apps/pdf-converter).
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
  pnpm deploy out --prod --legacy --filter @growi/attachment-text-extractor

# Third-party licence notices: the ones kept in this repository for the libraries
# inside the PDFium WASM, plus the two files the npm package itself carries.
RUN mkdir -p /licenses/pdfium-wasm/pdfium \
  && cp -R apps/attachment-text-extractor/docker/licenses/. /licenses/ \
  && cp out/node_modules/@embedpdf/pdfium/LICENSE \
        out/node_modules/@embedpdf/pdfium/LICENSE.pdfium \
        /licenses/pdfium-wasm/pdfium/



##
## release
##
FROM ${NODE_IMAGE}

# Reaches the HTTP parent only. A conversion child gets an explicit environment
# (src/runner/child-env.ts), which sets RAYON_NUM_THREADS=1 for anydoc itself.
ENV RAYON_NUM_THREADS=1

# Dedicated non-root user; no home dir keeps it compatible with a read-only rootfs.
RUN groupadd --gid 10001 appgroup \
  && useradd --uid 10001 --gid appgroup --shell /usr/sbin/nologin --no-create-home appuser

# The runner starts every conversion child through this absolute path, so the
# build fails here if the base image stops shipping a working prlimit.
RUN /usr/bin/prlimit --version

WORKDIR /app

# package.json carries "type": "module", which dist/ needs to load as ESM.
COPY --from=builder /opt/apps/attachment-text-extractor/package.json ./package.json
COPY --from=builder /opt/out/node_modules ./node_modules
COPY --from=builder /opt/apps/attachment-text-extractor/dist ./dist
COPY --from=builder /licenses /licenses/

USER 10001

EXPOSE 8000

# Exec form, so SIGTERM reaches node directly; it then finishes the requests in
# flight. Conversion children are direct children of node and end themselves
# when it disappears (src/child/parent-watch.ts), so no init is required.
CMD ["node", "dist/main.js"]
