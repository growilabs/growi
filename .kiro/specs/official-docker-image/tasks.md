# Implementation Plan

> **Task ordering design policy**:
> - **Phase 1 (this phase)**: Reproduce an image with the same specifications as the current one using a DHI base image + TypeScript entrypoint. The build pipeline (3-stage structure using `COPY . .`) is kept as-is, **prioritizing a safe runtime migration**.
> - **Phase 2 (next phase)**: Introduction of build optimization via the `turbo prune --docker` pattern. This will be done after runtime is stable in Phase 1. Adding pruner/deps stages to create a 5-stage structure.
>
> **Implementation directory**: Create new files in `apps/app/docker-new/`. The existing `apps/app/docker/` will not be modified at all. Maintain a state where parallel comparison and verification is possible.
>
> Directory permission handling is implemented and tested as the highest priority to detect regressions early. Since the entrypoint (TypeScript) and Dockerfile are independent files, some tasks can be executed in parallel.

## Phase 1: DHI + TypeScript entrypoint (maintaining current build pattern)

- [x] 1. (P) Strengthen build context filter
  - Add `.git`, `.env*` (except production), test files, IDE configuration files, etc. to the current exclusion rules
  - Verify that security-sensitive files (secrets, credentials) are not included in the context
  - Maintain the current exclusion rules (`node_modules`, `.next`, `.turbo`, `apps/slackbot-proxy`, etc.)
  - _Requirements: 4.3_

- [x] 2. TypeScript entrypoint directory initialization and permission management
- [x] 2.1 (P) Create entrypoint skeleton and recursive chown helper
  - Create a new TypeScript file that can be directly executed with Node.js 24 type stripping (no enums, erasable syntax only)
  - Structure the main execution flow as a `main()` function with top-level try-catch for error handling
  - Implement a helper function that recursively changes ownership of files and subdirectories within a directory
  - Create unit tests for the helper function (verify recursive behavior with nested directory structures)
  - _Requirements: 6.8_

- [x] 2.2 Implement directory initialization processing
  - Implement creation of `/data/uploads`, symlink creation to `./public/uploads`, and recursive ownership change
  - Implement creation of `/tmp/page-bulk-export`, recursive ownership change, and permission 700 setting
  - Ensure idempotency (`recursive: true` for mkdir, prevent duplicate symlink creation)
  - Create unit tests that **guarantee the same behavior as the current `docker-entrypoint.sh`** (using fs mocks, verifying each state of directories, symlinks, ownership, and permissions)
  - Verify that the process exits (exit code 1) on failure (e.g., volume mount not configured)
  - _Requirements: 6.3, 6.4_

- [x] 2.3 Implement privilege dropping
  - Implement demotion from root to node user (UID 1000, GID 1000)
  - Initialize supplementary groups, strictly following the order of setgid then setuid (reverse order causes setgid to fail)
  - Output an error message and exit the process on privilege drop failure
  - _Requirements: 4.1, 6.2_

- [x] 3. Heap size calculation and node flag assembly
- [x] 3.1 (P) Implement cgroup memory limit detection
  - Implement reading and numeric parsing of cgroup v2 files (treat the `"max"` string as unlimited)
  - Implement fallback to cgroup v1 files (treat values exceeding 64GB as unlimited)
  - Calculate 60% of the memory limit as the heap size (in MB)
  - On file read failure, output a warning log and continue without flags (V8 default)
  - Create unit tests for each pattern (v2 normal detection, v2 unlimited, v1 fallback, v1 unlimited, detection unavailable)
  - _Requirements: 2.2, 2.3_

- [x] 3.2 (P) Implement heap size specification via environment variable
  - Implement parsing and validation of the `GROWI_HEAP_SIZE` environment variable (positive integer, in MB)
  - On invalid values (NaN, negative numbers, empty string), output a warning log and fall back to no flags
  - Confirm via tests that the environment variable takes priority over cgroup auto-calculation
  - _Requirements: 2.1_

- [x] 3.3 Implement node flag assembly and log output
  - Implement the 3-tier fallback integration logic (environment variable -> cgroup calculation -> V8 default)
  - Always include the `--expose_gc` flag
  - Add `--optimize-for-size` when `GROWI_OPTIMIZE_MEMORY=true`, and `--lite-mode` when `GROWI_LITE_MODE=true`
  - Pass `--max-heap-size` directly as a spawn argument (do not use `--max_old_space_size`, do not include in `NODE_OPTIONS`)
  - Log the applied flags to stdout (including which tier determined the value)
  - Create unit tests for each combination of environment variables (all unset, HEAP_SIZE only, all enabled, etc.)
  - _Requirements: 2.4, 2.5, 2.6, 2.7, 6.1, 6.6, 6.7_

- [x] 4. Migration execution and app process management
- [x] 4.1 Direct migration execution
  - Execute migrate-mongo by directly calling the node binary (do not use npm run, do not go through a shell)
  - Inherit stdio to display migration logs
  - On migration failure, catch the exception and exit the process, prompting restart by the container orchestrator
  - _Requirements: 6.5_

- [x] 4.2 App process startup and signal management
  - Start the application as a child process with the calculated node flags included in the arguments
  - Forward SIGTERM, SIGINT, and SIGHUP to the child process
  - Propagate the child process exit code (or signal) as the entrypoint exit code
  - Create tests to verify PID 1 responsibilities (signal forwarding, child process reaping, graceful shutdown)
  - _Requirements: 6.2, 6.5_

- [x] 5. Dockerfile reconstruction (current 3-stage pattern + DHI)
- [x] 5.1 (P) Build the base stage
  - Set the DHI dev image as the base and update the syntax directive to auto-follow the latest stable version
  - Install pnpm via wget standalone script (eliminate hardcoded versions)
  - Install turbo globally
  - Install packages required for building with `--no-install-recommends` and apply apt cache mounts
  - _Requirements: 1.1, 1.2, 1.3, 1.5, 3.3, 4.4_

- [x] 5.2 Build the builder stage
  - Maintain the current `COPY . .` pattern to copy the entire monorepo, then install dependencies, build, and extract production dependencies
  - Fix the `--frozen-lockfile` typo (3 dashes -> 2 dashes)
  - Configure pnpm store cache mounts to reduce rebuild time
  - Extract only production dependencies and package them into tar.gz (including the `apps/app/tmp` directory)
  - Guarantee that `.next/cache` is not included in the artifact
  - _Requirements: 1.4, 3.2, 3.4_

- [x] 5.3 Build the release stage
  - Set the DHI runtime image as the base with no additional binary copying
  - Extract build stage artifacts via bind mount
  - COPY the TypeScript entrypoint file and set ENTRYPOINT to direct execution via node
  - Verify that build tools (turbo, pnpm, node-gyp, etc.) and build packages (wget, curl, etc.) are not included in the release stage
  - _Requirements: 1.1, 3.5, 4.2, 4.5_

- [x] 5.4 (P) Configure OCI labels and port/volume declarations
  - Set OCI standard labels (source, title, description, vendor)
  - Maintain `EXPOSE 3000` and `VOLUME /data`
  - _Requirements: 5.1, 5.2, 5.3_

- [x] 6. Integration verification and backward compatibility confirmation
- [x] 6.1 Docker build E2E verification
  - Execute a Docker build where all 3 stages complete successfully and confirm there are no build errors
  - Verify that the release image does not contain a shell, apt, or build tools
  - _Requirements: 1.1, 4.2, 4.5_

- [x] 6.2 Runtime behavior and backward compatibility verification
  - Verify that environment variables (`MONGO_URI`, `FILE_UPLOAD`, etc.) are transparently passed to the application as before
  - Verify compatibility with `/data` volume mounts and file upload functionality
  - Verify listening on port 3000
  - Verify that V8 default behavior is used when memory management environment variables are not set
  - Verify startup with `docker compose up` and graceful shutdown via SIGTERM
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

## Phase 2: turbo prune --docker build optimization

> To be done after runtime is stable in Phase 1. Migrate from the current `COPY . .` + 3-stage structure to a `turbo prune --docker` + 5-stage structure to improve build cache efficiency.

- [x] 7. Introduction of turbo prune --docker pattern
- [x] 7.1 Create pruner stage
  - Add a pruner stage immediately after the base stage, minimizing the monorepo for Docker with `turbo prune @growi/app @growi/pdf-converter --docker`
  - Reason for including `@growi/pdf-converter`: `@growi/pdf-converter-client/turbo.json` has a task dependency on `@growi/pdf-converter#gen:swagger-spec`, so turbo cannot resolve task dependencies unless it is included in the pruned workspace
  - Verified compatibility with pnpm workspace (18 packages are correctly output)
  - Confirmed that the output (json directory, lockfile, full directory) is generated correctly
  - _Requirements: 3.1_

- [x] 7.2 Separate deps stage and restructure builder
  - Separate dependency installation from the builder stage into an independent deps stage
  - Copy only the package.json files and lockfile from pruner output to install dependencies (layer cache optimization)
  - Change the builder stage to a structure that uses deps as a base and only copies source code and builds
  - Verify that the dependency installation layer is cached when there are no dependency changes and only source code changes
  - _Requirements: 3.1, 3.2_

- [x] 7.3 Integration verification of 5-stage structure
  - Confirm that all 5 stages (base -> pruner -> deps -> builder -> release) complete successfully
  - Confirm that the same runtime behavior as the Phase 1 3-stage structure is maintained
  - Verify improvement in build cache efficiency (dependency installation is skipped when only source code changes)
  - _Requirements: 3.1, 3.2, 3.4_

## Phase 3: Production replacement and CI/CD support

> To be done after the 5-stage structure is stable in Phase 2. Move the artifacts from `apps/app/docker-new/` to `apps/app/docker/`, delete the old files, and update the CI/CD pipeline for DHI support.

- [x] 8. Production replacement and CI/CD support
- [x] 8.1 (P) Replace docker-new directory with docker directory
  - Delete old files in `apps/app/docker/` (old `Dockerfile`, `docker-entrypoint.sh`, old `Dockerfile.dockerignore`)
  - Move all files in `apps/app/docker-new/` (`Dockerfile`, `docker-entrypoint.ts`, `docker-entrypoint.spec.ts`, `Dockerfile.dockerignore`) to `apps/app/docker/`
  - Delete the `apps/app/docker-new/` directory
  - Confirm that the `codebuild/` directory and `README.md` are maintained within `apps/app/docker/`
  - Update the entrypoint copy path in the Dockerfile (from `apps/app/docker-new/docker-entrypoint.ts` to `apps/app/docker/docker-entrypoint.ts`)
  - _Requirements: 8.1, 8.2_

- [x] 8.2 (P) Add DHI registry login to buildspec.yml
  - Add a `docker login dhi.io` command to the pre_build phase of `apps/app/docker/codebuild/buildspec.yml`
  - DHI uses Docker Hub credentials, so reuse the existing `DOCKER_REGISTRY_PASSWORD` secret and `growimoogle` username
  - Confirm that the Dockerfile path in buildspec.yml (`./apps/app/docker/Dockerfile`) is correct after replacement
  - _Requirements: 8.3, 8.4_

- [x] 8.3 Integration verification after replacement
  - Confirm that Docker build completes successfully with the replaced `apps/app/docker/Dockerfile`
  - Confirm that existing external references (`codebuild.tf`, `.github/workflows/release.yml`, `ci-app.yml`, `update-readme.sh`) work correctly
  - _Requirements: 8.1, 8.2, 8.3, 8.4_
