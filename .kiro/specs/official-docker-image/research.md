# Research & Design Decisions

---
**Purpose**: Discovery findings and design decision rationale for the official Docker image modernization.
---

## Summary
- **Feature**: `official-docker-image`
- **Discovery Scope**: Extension (major improvement of existing Dockerfile)
- **Key Findings**:
  - The DHI runtime image (`dhi.io/node:24-debian13`) is a minimal configuration that does not include a shell, package manager, or coreutils. By adopting a Node.js entrypoint (TypeScript), a configuration requiring no shell or additional binaries is achieved
  - `--mount=type=bind` is impractical for monorepo multi-step builds. `turbo prune --docker` is the officially recommended Docker optimization approach by Turborepo
  - gosu is replaced by Node.js native `process.setuid/setgid`. External binaries (gosu/setpriv/busybox) are completely unnecessary
  - HEALTHCHECK is not adopted (k8s uses its own probes. Docker Compose users can configure it themselves)
  - Node.js 24 supports native TypeScript execution (type stripping). The entrypoint can be written in TypeScript

## Research Log

### DHI Runtime Image Configuration

- **Context**: Investigation of constraints when adopting `dhi.io/node:24-debian13` as the base image for the release stage
- **Sources Consulted**:
  - [DHI Catalog GitHub](https://github.com/docker-hardened-images/catalog) — `image/node/debian-13/` directory
  - [DHI Documentation](https://docs.docker.com/dhi/)
  - [DHI Use an Image](https://docs.docker.com/dhi/how-to/use/)
- **Findings**:
  - Pre-installed packages in the runtime image: only `base-files`, `ca-certificates`, `libc6`, `libgomp1`, `libstdc++6`, `netbase`, `tzdata`
  - **No shell**, **no apt**, **no coreutils**, **no curl/wget**
  - Default user: `node` (UID 1000, GID 1000)
  - Dev image (`-dev`): `apt`, `bash`, `git`, `util-linux`, `coreutils`, etc. are pre-installed
  - Available tags: `dhi.io/node:24-debian13`, `dhi.io/node:24-debian13-dev`
  - Platforms: `linux/amd64`, `linux/arm64`
- **Implications**:
  - By writing the entrypoint in Node.js (TypeScript), neither a shell nor additional binaries are needed at all
  - gosu/setpriv are replaced by Node.js native `process.setuid/setgid`. No need to copy external binaries
  - HEALTHCHECK is not adopted (k8s uses its own probes). Health checks via curl/Node.js http module are unnecessary

### Applicability of `--mount=type=bind` in Monorepo Builds

- **Context**: Investigation of the feasibility of Requirement 3.1 "Use `--mount=type=bind` instead of `COPY . .` in the builder stage"
- **Sources Consulted**:
  - [Docker Build Cache Optimization](https://docs.docker.com/build/cache/optimize/)
  - [Dockerfile Reference - RUN --mount](https://docs.docker.com/reference/dockerfile/)
  - [pnpm Docker Documentation](https://pnpm.io/docker)
  - [Turborepo Docker Guide](https://turbo.build/repo/docs/handbook/deploying-with-docker)
- **Findings**:
  - `--mount=type=bind` is **only valid during the execution of a RUN instruction** and is not carried over to the next RUN instruction
  - In the multi-step process of monorepo builds (install -> build -> deploy), each step depends on artifacts from the previous step, making it difficult to achieve with bind mounts alone
  - It is possible to combine all steps into a single RUN, but this loses the benefits of layer caching
  - **Turborepo official recommendation**: Use `turbo prune --docker` to minimize the monorepo for Docker
    - `out/json/` — only package.json files needed for dependency install
    - `out/pnpm-lock.yaml` — lockfile
    - `out/full/` — source code needed for the build
  - This approach avoids `COPY . .` while leveraging layer caching
- **Implications**:
  - Requirement 3.1 should be achieved using the `turbo prune --docker` pattern instead of `--mount=type=bind`
  - The goal (minimizing source code layers / improving cache efficiency) can be equally achieved
  - **However**, compatibility of `turbo prune --docker` with pnpm workspaces needs to be verified during implementation

### Alternatives to gosu

- **Context**: Investigation of alternatives since gosu is not available in the DHI runtime image
- **Sources Consulted**:
  - [gosu GitHub](https://github.com/tianon/gosu) — list of alternative tools
  - [Debian Packages - gosu in trixie](https://packages.debian.org/trixie/admin/gosu)
  - [PhotoPrism: Switch from gosu to setpriv](https://github.com/photoprism/photoprism/pull/2730)
  - [MongoDB Docker: Replace gosu by setpriv](https://github.com/docker-library/mongo/pull/714)
  - Node.js `process.setuid/setgid` documentation
- **Findings**:
  - `setpriv` is part of `util-linux` and is pre-installed in the DHI dev image
  - `gosu node command` can be replaced with `setpriv --reuid=node --regid=node --init-groups -- command`
  - PhotoPrism and the official MongoDB Docker image have already migrated from gosu to setpriv
  - **Node.js native**: Can be fully replaced with `process.setgid(1000)` + `process.setuid(1000)` + `process.initgroups('node', 1000)`
  - When adopting a Node.js entrypoint, no external binaries (gosu/setpriv/busybox) are needed at all
- **Implications**:
  - **Final decision**: Adopt Node.js native `process.setuid/setgid` (setpriv is also unnecessary)
  - No need to copy gosu/setpriv binaries, resulting in no additional binaries in the release stage
  - Maintains the minimized attack surface of the DHI runtime as-is

### HEALTHCHECK Implementation Approach (Not Adopted)

- **Context**: Investigation of HEALTHCHECK implementation approaches since curl is not available in the DHI runtime image
- **Sources Consulted**:
  - [Docker Healthchecks in Distroless Node.js](https://www.mattknight.io/blog/docker-healthchecks-in-distroless-node-js)
  - [Docker Healthchecks: Why Not to Use curl](https://blog.sixeyed.com/docker-healthchecks-why-not-to-use-curl-or-iwr/)
  - GROWI healthcheck endpoint: `apps/app/src/server/routes/apiv3/healthcheck.ts`
- **Findings**:
  - Node.js `http` module is sufficient (curl is unnecessary)
  - GROWI's `/_api/v3/healthcheck` endpoint returns `{ status: 'OK' }` without any parameters
  - Docker HEALTHCHECK is useful for Docker Compose's `depends_on: service_healthy` dependency order control
  - In k8s environments, custom probes (liveness/readiness) are used, so the Dockerfile's HEALTHCHECK is unnecessary
- **Implications**:
  - **Final decision: Not adopted**. k8s uses its own probes, and Docker Compose users can configure it themselves in compose.yaml
  - By not including HEALTHCHECK in the Dockerfile, simplicity is maintained

### Shell Dependency of npm run migrate

- **Context**: Investigation of whether `npm run migrate` within CMD requires a shell
- **Sources Consulted**:
  - GROWI `apps/app/package.json`'s `migrate` script
- **Findings**:
  - The actual `migrate` script content: `node -r dotenv-flow/config node_modules/migrate-mongo/bin/migrate-mongo up -f config/migrate-mongo-config.js`
  - `npm run` internally uses `sh -c`, so a shell is required
  - Alternative: Running the script contents directly with node eliminates the need for npm/sh
  - However, using npm run is more maintainable (can track changes in package.json)
- **Implications**:
  - **Final decision**: Use `child_process.execFileSync` in the Node.js entrypoint to directly execute the migration command (not using npm run, no shell needed)
  - Adopt the approach of directly writing the `migrate` script contents within the entrypoint
  - When package.json changes, the entrypoint also needs to be updated, but priority is given to fully shell-less DHI runtime

### Node.js 24 Native TypeScript Execution

- **Context**: Investigation of whether Node.js 24's native TypeScript execution feature can be used when writing the entrypoint in TypeScript
- **Sources Consulted**:
  - [Node.js 23 Release Notes](https://nodejs.org/en/blog/release/v23.0.0) — `--experimental-strip-types` unflagged
  - [Node.js Type Stripping Documentation](https://nodejs.org/docs/latest/api/typescript.html)
- **Findings**:
  - From Node.js 23, type stripping is enabled by default (no `--experimental-strip-types` flag needed)
  - Available as a stable feature in Node.js 24
  - **Constraint**: "Non-erasable syntax" such as enum and namespace cannot be used. `--experimental-transform-types` is required for those
  - interface, type alias, and type annotations (`: string`, `: number`, etc.) can be used without issues
  - Can be executed directly with `ENTRYPOINT ["node", "docker-entrypoint.ts"]`
- **Implications**:
  - The entrypoint can be written in TypeScript, enabling type-safe implementation
  - Do not use enum; use union types (`type Foo = 'a' | 'b'`) as alternatives
  - tsconfig.json is not required (type stripping operates independently)

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| DHI runtime + busybox-static | Copy busybox-static to provide sh/coreutils | Minimal addition (~1MB) enables full functionality | Contradicts the original intent of DHI adoption (minimizing attack surface). Additional binaries are attack vectors | Rejected |
| DHI runtime + bash/coreutils copy | Copy bash and various binaries individually from the dev stage | Full bash functionality available | Shared library dependencies are complex, many files need to be copied | Rejected |
| DHI dev image as runtime | Use the dev image as-is for production | Minimal configuration changes | Increased attack surface due to apt/git etc., diminishes the meaning of DHI | Rejected |
| Node.js entrypoint (TypeScript, shell-less) | Write the entrypoint in TypeScript. Runs with Node.js 24's native TypeScript execution | Completely shell-free, maintains DHI runtime's attack surface as-is, type-safe | Migration command written directly (not using npm run), updates needed when package.json changes | **Adopted** |

## Design Decisions

### Decision: Node.js TypeScript Entrypoint (Completely Shell-Free)

- **Context**: The DHI runtime image contains neither a shell nor coreutils. Copying busybox-static contradicts the intent of DHI adoption (minimizing attack surface)
- **Alternatives Considered**:
  1. Copy busybox-static to provide shell + coreutils — Contradicts DHI's attack surface minimization
  2. Copy bash + coreutils individually — Complex dependencies
  3. Node.js TypeScript entrypoint — Everything can be accomplished with `fs`, `child_process`, and `process.setuid/setgid`
- **Selected Approach**: Write the entrypoint in TypeScript (`docker-entrypoint.ts`). Execute directly using Node.js 24's native TypeScript execution (type stripping)
- **Rationale**: No additional binaries needed in the DHI runtime whatsoever. Directory operations via fs module, privilege dropping via process.setuid/setgid, migration via execFileSync, and app startup via spawn. Improved maintainability through type safety
- **Trade-offs**: Migration command is written directly (not using npm run). When the migrate script in package.json changes, the entrypoint also needs to be updated
- **Follow-up**: Verify that Node.js 24's type stripping works correctly with a single-file entrypoint without import statements

### Decision: Privilege Dropping via Node.js Native process.setuid/setgid

- **Context**: gosu cannot be installed in the DHI runtime. busybox-static/setpriv are also not adopted (policy of eliminating additional binaries)
- **Alternatives Considered**:
  1. Copy gosu binary — Works but goes against industry trends
  2. Copy setpriv binary — Works but goes against the policy of eliminating additional binaries
  3. Node.js `process.setuid/setgid` — Standard Node.js API
  4. Docker `--user` flag — Cannot handle dynamic processing in the entrypoint
- **Selected Approach**: Drop privileges with `process.initgroups('node', 1000)` + `process.setgid(1000)` + `process.setuid(1000)`
- **Rationale**: No external binaries needed at all. Can be called directly within the Node.js entrypoint. Safe privilege dropping in the order setgid -> setuid
- **Trade-offs**: The entrypoint starts as a Node.js process running as root, and the app becomes its child process (not an exec like gosu). However, the app process is separated via spawn, and signal forwarding fulfills PID 1 responsibilities
- **Follow-up**: None

### Decision: turbo prune --docker Pattern

- **Context**: Requirement 3.1 requires eliminating `COPY . .`, but `--mount=type=bind` is impractical for monorepo builds
- **Alternatives Considered**:
  1. `--mount=type=bind` — Does not persist across RUN instructions, unsuitable for multi-step builds
  2. Combine all steps into a single RUN — Poor cache efficiency
  3. `turbo prune --docker` — Officially recommended by Turborepo
- **Selected Approach**: Use `turbo prune --docker` to minimize the monorepo for Docker, using optimized COPY patterns
- **Rationale**: Officially recommended by Turborepo. Separates dependency install and source copy to maximize layer cache utilization. Eliminates `COPY . .` while remaining practical
- **Trade-offs**: One additional build stage (pruner stage), but offset by improved cache efficiency
- **Follow-up**: Verify `turbo prune --docker` compatibility with pnpm workspaces during implementation

### Decision: Flag Injection via spawn Arguments

- **Context**: `--max-heap-size` cannot be used in `NODE_OPTIONS`. It needs to be passed as a direct argument to the node command
- **Alternatives Considered**:
  1. Export environment variable `GROWI_NODE_FLAGS` and inject via shell variable expansion in CMD — Requires a shell
  2. Rewrite CMD string with sed in the entrypoint — Fragile
  3. Pass directly as arguments to `child_process.spawn` in the Node.js entrypoint — No shell needed
- **Selected Approach**: Build a flag array within the entrypoint and pass it directly with `spawn(process.execPath, [...nodeFlags, ...appArgs])`
- **Rationale**: No shell variable expansion needed. Passed directly as an array, resulting in zero risk of shell injection. Natural integration with the Node.js entrypoint
- **Trade-offs**: CMD becomes unnecessary (the entrypoint handles all startup processing). Overriding the command with docker run does not affect the logic within the entrypoint
- **Follow-up**: None

### DHI Registry Authentication and CI/CD Integration

- **Context**: Investigation of the authentication method required for pulling DHI base images and how to integrate with the existing CodeBuild pipeline
- **Sources Consulted**:
  - [DHI How to Use an Image](https://docs.docker.com/dhi/how-to/use/) — DHI usage instructions
  - Existing `apps/app/docker/codebuild/buildspec.yml` — Current CodeBuild build definition
  - Existing `apps/app/docker/codebuild/secretsmanager.tf` — AWS Secrets Manager configuration
- **Findings**:
  - DHI uses Docker Hub credentials (DHI is a feature of Docker Business/Team subscriptions)
  - Authentication is possible with `docker login dhi.io --username <dockerhub-user> --password-stdin`
  - The existing buildspec.yml is already logged into docker.io with the `DOCKER_REGISTRY_PASSWORD` secret
  - The same credentials can be used to log into `dhi.io` as well (no additional secrets required)
  - The flow of CodeBuild's `reusable-app-build-image.yml` -> CodeBuild Project -> buildspec.yml does not need to change
- **Implications**:
  - Can be addressed by simply adding one line of `docker login dhi.io` to the pre_build in buildspec.yml
  - No changes to `secretsmanager.tf` are needed
  - Login to both Docker Hub and DHI is required (docker.io for push, dhi.io for pull)

### Impact Scope of Directory Replacement (Codebase Investigation)

- **Context**: Confirming that existing references will not break when replacing `apps/app/docker-new/` with `apps/app/docker/`
- **Sources Consulted**: Grep investigation of the entire codebase with the `apps/app/docker` keyword
- **Findings**:
  - `buildspec.yml`: `-f ./apps/app/docker/Dockerfile` — Same path after replacement (no change needed)
  - `codebuild.tf`: `buildspec = "apps/app/docker/codebuild/buildspec.yml"` — Same (no change needed)
  - `.github/workflows/release.yml`: `readme-filepath: ./apps/app/docker/README.md` — Same (no change needed)
  - `.github/workflows/ci-app.yml` / `ci-app-prod.yml`: `!apps/app/docker/**` exclusion pattern — Same (no change needed)
  - `apps/app/bin/github-actions/update-readme.sh`: `cd docker` + sed — Same (no change needed)
  - Within Dockerfile: line 122 `apps/app/docker-new/docker-entrypoint.ts` — **Needs updating** (self-referencing path)
  - `package.json` and `vitest.config` for docker-related references — None
  - `lefthook.yml` for docker-related hooks — None
- **Implications**:
  - Only one location within the Dockerfile (self-referencing path) needs to be updated during replacement
  - All external references (CI/CD, GitHub Actions) already use the `apps/app/docker/` path and require no changes
  - The `codebuild/` directory and `README.md` are maintained as-is within `docker/`

## Risks & Mitigations

- **Stability of Node.js 24 native TypeScript execution**: Type stripping was unflagged in Node.js 23. It is a stable feature in Node.js 24. However, non-erasable syntax such as enum cannot be used -> Use only interface/type
- **Direct description of migration command**: The `migrate` script from package.json is written directly in the entrypoint, so synchronization is needed when changes occur -> Clearly noted in comments during implementation
- **turbo prune compatibility with pnpm workspaces**: Verify during implementation. If incompatible, fall back to an optimized COPY pattern
- **Limitations of process.setuid/setgid**: `process.initgroups` is required for supplementary group initialization. The order setgid -> setuid must be strictly followed
- **docker login requirement for DHI images**: `docker login dhi.io` is required in CI/CD. Security considerations for credential management are needed

## Production Implementation Discoveries

### DHI Dev Image Minimal Configuration (Phase 1 E2E)

- **Issue**: The DHI dev image (`dhi.io/node:24-debian13-dev`) did not include the `which` command
- **Resolution**: Changed pnpm installation from `SHELL="$(which sh)"` to `SHELL=/bin/sh`
- **Impact**: Minor — only affects the pnpm install script invocation

### Complete Absence of Shell in DHI Runtime Image (Phase 1 E2E)

- **Issue**: The DHI runtime image (`dhi.io/node:24-debian13`) did not have `/bin/sh`. The design planned `--mount=type=bind,from=builder` + `RUN tar -zxf`, but `RUN` instructions require `/bin/sh`
- **Resolution**:
  - **builder stage**: Changed from `tar -zcf` to `cp -a` into a staging directory `/tmp/release/`
  - **release stage**: Changed from `RUN --mount=type=bind... tar -zxf` to `COPY --from=builder --chown=node:node`
- **Impact**: Design Req 3.5 (`--mount=type=bind,from=builder` pattern) was replaced with `COPY --from=builder`. The security goal of not requiring a shell at runtime was achieved even more robustly
- **Lesson**: DHI runtime images are truly minimal — `COPY`, `WORKDIR`, `ENV`, `LABEL`, `ENTRYPOINT` are processed by the Docker daemon and do not require a shell

### process.initgroups() Type Definition Gap

- **Issue**: `process.initgroups('node', 1000)` was called for in the design, but implementation was deferred because the type definition does not exist in `@types/node`
- **Status**: Deferred (Known Issue)
- **Runtime**: `process.initgroups` does exist at runtime in Node.js 24
- **Workaround options**: Wait for `@types/node` fix, or use `(process as any).initgroups('node', 1000)`
- **Practical impact**: Low — the node user in a Docker container typically has no supplementary groups

## References

- [Docker Hardened Images Documentation](https://docs.docker.com/dhi/) — Overview and usage of DHI
- [DHI Catalog GitHub](https://github.com/docker-hardened-images/catalog) — Image definitions and tag list
- [Turborepo Docker Guide](https://turbo.build/repo/docs/handbook/deploying-with-docker) — turbo prune --docker pattern
- [pnpm Docker Documentation](https://pnpm.io/docker) — pnpm Docker build recommendations
- [Future Architect: 2024 Edition Dockerfile Best Practices](https://future-architect.github.io/articles/20240726a/) — Modern Dockerfile syntax
- [MongoDB Docker: gosu -> setpriv](https://github.com/docker-library/mongo/pull/714) — Precedent for setpriv migration
- [Docker Healthchecks in Distroless](https://www.mattknight.io/blog/docker-healthchecks-in-distroless-node-js) — Health checks without curl
- GROWI memory usage investigation report (`apps/app/tmp/memory-results/REPORT.md`) — Basis for heap size control
