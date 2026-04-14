# Requirements Document

## Introduction

Modernize and optimize the GROWI official Docker image's Dockerfile (`apps/app/docker/Dockerfile`) and `docker-entrypoint.sh` based on 2025-2026 best practices. Target Node.js 24 and incorporate findings from the memory report (`apps/app/tmp/memory-results/REPORT.md`) to improve memory management.

### Summary of Current State Analysis

**Current Dockerfile structure:**
- 3-stage structure: `base` → `builder` → `release` (based on node:20-slim)
- Monorepo build with pnpm + turbo, production dependency extraction via `pnpm deploy`
- Privilege drop from root to node user using gosu (after directory creation in entrypoint)
- `COPY . .` copies the entire context into the builder
- Application starts after running `npm run migrate` in CMD

**GROWI-specific design intentions (items to maintain):**
- Privilege drop pattern: The entrypoint must create and set permissions for `/data/uploads` and `/tmp/page-bulk-export` with root privileges, then drop to the node user for execution
- `pnpm deploy --prod`: The official method for extracting only production dependencies from a pnpm monorepo
- Inter-stage artifact transfer via tar.gz: Cleanly transfers build artifacts to the release stage
- `apps/app/tmp` directory: Required in the production image as files are placed there during operation
- `--expose_gc` flag: Required for explicitly calling `gc()` in batch processing (ES rebuild, import, etc.)
- `npm run migrate` in CMD: Automatically runs migrations at startup for the convenience of Docker image users

**References:**
- [Future Architect: 2024 Dockerfile Best Practices](https://future-architect.github.io/articles/20240726a/)
- [Snyk: 10 best practices to containerize Node.js](https://snyk.io/blog/10-best-practices-to-containerize-nodejs-web-applications-with-docker/)
- [ByteScrum: Dockerfile Best Practices 2025](https://blog.bytescrum.com/dockerfile-best-practices-2025-secure-fast-and-modern)
- [OneUptime: Docker Health Check Best Practices 2026](https://oneuptime.com/blog/post/2026-01-30-docker-health-check-best-practices/view)
- [Docker: Introduction to heredocs in Dockerfiles](https://www.docker.com/blog/introduction-to-heredocs-in-dockerfiles/)
- [Docker Hardened Images: Node.js Migration Guide](https://docs.docker.com/dhi/migration/examples/node/)
- [Docker Hardened Images Catalog: Node.js](https://hub.docker.com/hardened-images/catalog/dhi/node)
- GROWI Memory Usage Investigation Report (`apps/app/tmp/memory-results/REPORT.md`)

## Requirements

### Requirement 1: Modernize Base Image and Build Environment

**Objective:** As an infrastructure administrator, I want the Dockerfile's base image and syntax to comply with the latest best practices, so that security patch application, performance improvements, and maintainability enhancements are achieved

**Summary**: DHI base images adopted (`dhi.io/node:24-debian13-dev` for build, `dhi.io/node:24-debian13` for release) with up to 95% CVE reduction. Syntax directive updated to auto-follow latest stable. pnpm installed via wget standalone script (corepack not adopted due to planned removal in Node.js 25+). Fixed `---frozen-lockfile` typo and eliminated hardcoded pnpm version.

### Requirement 2: Memory Management Optimization

**Objective:** As a GROWI operator, I want the Node.js heap size to be appropriately controlled according to container memory constraints, so that the risk of OOMKilled is reduced and memory efficiency in multi-tenant environments is improved

**Summary**: 3-tier heap size fallback implemented in docker-entrypoint.ts: (1) `GROWI_HEAP_SIZE` env var, (2) cgroup v2/v1 auto-calculation at 60%, (3) V8 default. Uses `--max-heap-size` (not `--max_old_space_size`) passed as direct spawn arguments (not `NODE_OPTIONS`). Additional flags: `--optimize-for-size` via `GROWI_OPTIMIZE_MEMORY=true`, `--lite-mode` via `GROWI_LITE_MODE=true`.

### Requirement 3: Build Efficiency and Cache Optimization

**Objective:** As a developer, I want Docker builds to be fast and efficient, so that CI/CD pipeline build times are reduced and image size is minimized

**Summary**: `turbo prune --docker` pattern adopted to eliminate `COPY . .` and maximize layer cache (dependency install cached separately from source changes). pnpm store and apt-get cache mounts maintained. `.next/cache` excluded from release stage. Artifact transfer uses `COPY --from=builder` (adapted from design's `--mount=type=bind,from=builder` due to shell-less DHI runtime).

### Requirement 4: Security Hardening

**Objective:** As a security officer, I want the Docker image to comply with security best practices, so that the attack surface is minimized and the safety of the production environment is improved

**Summary**: Non-root execution via Node.js native `process.setuid/setgid` (no gosu/setpriv). Release stage contains no unnecessary packages — no shell, no apt, no build tools. Enhanced `.dockerignore` excludes `.git`, secrets, test files, IDE configs. `--no-install-recommends` used for apt-get in build stage.

### Requirement 5: Operability and Observability Improvement

**Objective:** As an operations engineer, I want the Docker image to have appropriate metadata configured, so that management by container orchestrators is facilitated

**Summary**: OCI standard LABEL annotations added (`org.opencontainers.image.source`, `.title`, `.description`, `.vendor`). `EXPOSE 3000` and `VOLUME /data` maintained.

### Requirement 6: Entrypoint and CMD Refactoring

**Objective:** As a developer, I want the entrypoint script and CMD to have a clear and maintainable structure, so that dynamic assembly of memory flags and future extensions are facilitated

**Summary**: Entrypoint rewritten in TypeScript (`docker-entrypoint.ts`) executed via Node.js 24 native type stripping. Handles: directory setup (`/data/uploads`, `/tmp/page-bulk-export`), heap size calculation (3-tier fallback), privilege drop (`process.setgid` + `process.setuid`), migration execution (`execFileSync`), app process spawn with signal forwarding. Always includes `--expose_gc`. Logs applied flags to stdout.

### Requirement 7: Backward Compatibility

**Objective:** As an existing Docker image user, I want existing operations to not break when migrating to the new Dockerfile, so that the risk during upgrades is minimized

**Summary**: Full backward compatibility maintained. Environment variables (`MONGO_URI`, `FILE_UPLOAD`, etc.), `VOLUME /data`, port 3000, and docker-compose usage patterns all work as before. Without memory management env vars, behavior is equivalent to V8 defaults.

### Requirement 8: Production Replacement and CI/CD Support

**Objective:** As an infrastructure administrator, I want the artifacts in the docker-new directory to officially replace the existing docker directory and the CI/CD pipeline to operate with the new Dockerfile, so that DHI-based images are used in production builds

**Summary**: All files moved from `apps/app/docker-new/` to `apps/app/docker/`, old files deleted. Dockerfile self-referencing path updated. `docker login dhi.io` added to buildspec.yml pre_build phase, reusing existing `DOCKER_REGISTRY_PASSWORD` secret. `codebuild/` directory and `README.md` maintained.
