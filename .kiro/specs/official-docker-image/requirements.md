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

#### Acceptance Criteria

1. The Dockerfile shall use Docker Hardened Images (DHI) as the base image. Use `dhi.io/node:24-debian13-dev` for the build stage and `dhi.io/node:24-debian13` for the release stage (glibc-based for performance retention, up to 95% CVE reduction)
2. The Dockerfile shall update the syntax directive to `# syntax=docker/dockerfile:1` (automatically follows the latest stable version)
3. The Dockerfile shall maintain the wget standalone script method for pnpm installation (corepack is not adopted because it will be removed from Node.js 25 onwards)
4. The Dockerfile shall fix the typo `pnpm install ---frozen-lockfile` (three dashes) to `--frozen-lockfile` (two dashes)
5. The Dockerfile shall avoid hardcoding the pnpm version and leverage the `packageManager` field in `package.json` or the latest version retrieval from the install script

### Requirement 2: Memory Management Optimization

**Objective:** As a GROWI operator, I want the Node.js heap size to be appropriately controlled according to container memory constraints, so that the risk of OOMKilled is reduced and memory efficiency in multi-tenant environments is improved

#### Acceptance Criteria

1. The docker-entrypoint.ts shall pass the value of the `GROWI_HEAP_SIZE` environment variable as the `--max-heap-size` flag to the node process when it is set
2. While the `GROWI_HEAP_SIZE` environment variable is not set, the docker-entrypoint.ts shall read the cgroup memory limit (v2: `/sys/fs/cgroup/memory.max`, v1: `/sys/fs/cgroup/memory/memory.limit_in_bytes`) and automatically calculate 60% of it as `--max-heap-size`
3. While the cgroup memory limit cannot be detected (e.g., bare metal) and `GROWI_HEAP_SIZE` is not set, the docker-entrypoint.ts shall not add the `--max-heap-size` flag and defer to V8's default behavior
4. When the `GROWI_OPTIMIZE_MEMORY` environment variable is set to `true`, the docker-entrypoint.ts shall add the `--optimize-for-size` flag to the node process
5. When the `GROWI_LITE_MODE` environment variable is set to `true`, the docker-entrypoint.ts shall add the `--lite-mode` flag to the node process (disables TurboFan to reduce RSS to v20-equivalent levels. Used as a last resort when OOMKilled occurs frequently)
6. The docker-entrypoint.ts shall use `--max-heap-size` and shall not use `--max_old_space_size` (to avoid the trusted_space overhead issue in Node.js 24)
7. The docker-entrypoint.ts shall pass `--max-heap-size` as a direct argument to the node command, not via `NODE_OPTIONS` (due to Node.js constraints)

### Requirement 3: Build Efficiency and Cache Optimization

**Objective:** As a developer, I want Docker builds to be fast and efficient, so that CI/CD pipeline build times are reduced and image size is minimized

#### Acceptance Criteria

1. The Dockerfile shall use `--mount=type=bind` instead of `COPY . .` in the builder stage to avoid including source code in layers
2. The Dockerfile shall maintain pnpm store cache mounts (`--mount=type=cache,target=...`)
3. The Dockerfile shall maintain apt-get cache mounts in the build stage
4. The Dockerfile shall ensure that `.next/cache` is not included in the release stage
5. The Dockerfile shall use the `--mount=type=bind,from=builder` pattern for artifact transfer from the build stage to the release stage

### Requirement 4: Security Hardening

**Objective:** As a security officer, I want the Docker image to comply with security best practices, so that the attack surface is minimized and the safety of the production environment is improved

#### Acceptance Criteria

1. The Dockerfile shall run the application as a non-root user (node) (using `process.setuid/setgid` in the Node.js entrypoint)
2. The Dockerfile shall not install unnecessary packages (build tools such as wget, curl, etc.) in the release stage
3. The Dockerfile shall ensure that `.git`, `node_modules`, test files, secret files, etc. are not included in the build context via `.dockerignore`
4. The Dockerfile shall use `--no-install-recommends` with `apt-get install` to prevent installation of unnecessary recommended packages
5. The Dockerfile shall not include tools only needed at build time (turbo, node-gyp, pnpm, etc.) in the release stage image

### Requirement 5: Operability and Observability Improvement

**Objective:** As an operations engineer, I want the Docker image to have appropriate metadata configured, so that management by container orchestrators is facilitated

#### Acceptance Criteria

1. The Dockerfile shall include OCI standard LABEL annotations (`org.opencontainers.image.source`, `org.opencontainers.image.title`, `org.opencontainers.image.description`, `org.opencontainers.image.vendor`)
2. The Dockerfile shall maintain `EXPOSE 3000` to document the port
3. The Dockerfile shall maintain `VOLUME /data` to document the data persistence point

### Requirement 6: Entrypoint and CMD Refactoring

**Objective:** As a developer, I want the entrypoint script and CMD to have a clear and maintainable structure, so that dynamic assembly of memory flags and future extensions are facilitated

#### Acceptance Criteria

1. The docker-entrypoint.ts shall include the heap size calculation logic (3-tier fallback from Requirement 2)
2. The docker-entrypoint.ts shall assemble the calculated flags as node command arguments and execute via `child_process.spawn` after dropping privileges with `process.setgid` + `process.setuid`
3. The docker-entrypoint.ts shall maintain directory creation, symbolic link setup, and permission configuration for `/data/uploads` (FILE_UPLOAD=local support)
4. The docker-entrypoint.ts shall maintain directory creation and permission configuration for `/tmp/page-bulk-export`
5. The docker-entrypoint.ts shall maintain the current behavior of starting the application after running migrations
6. The docker-entrypoint.ts shall maintain the `--expose_gc` flag (required for explicit GC calls in batch processing)
7. When `GROWI_HEAP_SIZE`, cgroup-calculated value, or various optimization flags are set, the docker-entrypoint.ts shall log the content of the applied flags to standard output
8. The docker-entrypoint.ts shall be written in TypeScript and executed directly using Node.js 24's native TypeScript execution feature (type stripping)

### Requirement 7: Backward Compatibility

**Objective:** As an existing Docker image user, I want existing operations to not break when migrating to the new Dockerfile, so that the risk during upgrades is minimized

#### Acceptance Criteria

1. The Docker image shall support application configuration via environment variables (`MONGO_URI`, `FILE_UPLOAD`, etc.) as before
2. The Docker image shall maintain `VOLUME /data` and preserve compatibility with existing data volume mounts
3. The Docker image shall maintain the current behavior of listening on port 3000
4. While memory management environment variables (`GROWI_HEAP_SIZE`, `GROWI_OPTIMIZE_MEMORY`, `GROWI_LITE_MODE`) are not set, the Docker image shall behave substantially equivalent to the existing behavior (Node.js 24 defaults)
5. The Docker image shall maintain the usage pattern from `docker-compose.yml` / `compose.yaml`

### Requirement 8: Production Replacement and CI/CD Support

**Objective:** As an infrastructure administrator, I want the artifacts in the docker-new directory to officially replace the existing docker directory and the CI/CD pipeline to operate with the new Dockerfile, so that DHI-based images are used in production builds

#### Acceptance Criteria

1. The Docker build configuration shall move all files from `apps/app/docker-new/` (`Dockerfile`, `docker-entrypoint.ts`, `docker-entrypoint.spec.ts`, `Dockerfile.dockerignore`) to `apps/app/docker/`, and delete the old files (old `Dockerfile`, `docker-entrypoint.sh`, old `Dockerfile.dockerignore`). The `codebuild/` directory and `README.md` shall be maintained
2. The Dockerfile shall update the self-referencing path `apps/app/docker-new/docker-entrypoint.ts` to `apps/app/docker/docker-entrypoint.ts`
3. The buildspec.yml shall add a login command to the DHI registry (`dhi.io`) in the pre_build phase. Since DHI uses Docker Hub credentials, the existing `DOCKER_REGISTRY_PASSWORD` secret shall be reused
4. The buildspec.yml shall correctly reference the new Dockerfile path (`./apps/app/docker/Dockerfile`) (verify that no change is needed as it is the same as the current path)
