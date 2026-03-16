# Research: optimise-deps-for-prod-with-turbo-prune

## Summary
- Feature: `optimise-deps-for-prod-with-turbo-prune`
- Discovery Scope: Extension (modifying existing build pipeline)
- Key Findings:
  1. `pnpm deploy --prod --legacy` creates top-level symlinks pointing to the **workspace-root** `.pnpm/` store (not the deploy output's local `.pnpm/`). Removing `--legacy` creates self-contained relative symlinks within the deploy output directory.
  2. Turbopack-generated `.next/node_modules/` symlinks for non-scoped packages use `../../node_modules/.pnpm/` path (2 levels up from `.next/node_modules/` = `apps/app/node_modules/`). After step [2] rewrite: same result. If `node_modules/` is placed at workspace root (4 levels up from `.next/node_modules/` = original Turbopack output `../../../../node_modules/.pnpm/`), no rewrite is needed.
  3. The existing Dockerfile already uses `turbo prune @growi/app @growi/pdf-converter --docker` in the `pruner` stage. The `assemble-prod.sh` runs inside the Docker `builder` stage after `turbo run build`. The workspace root in Docker is `$OPT_DIR` (e.g. `/opt/`).

## Research Log

### Topic: `.next/node_modules/` symlink path analysis
- Context: Determining why step [2] exists and what its target resolves to
- Findings:
  - Examined actual `.next/node_modules/@codemirror/` in devcontainer
  - Non-scoped packages: `../../node_modules/.pnpm/<pkg>/...` (2 levels up from `.next/node_modules/` = `apps/app/node_modules/`)
  - Scoped packages (inside `@scope/`): `../../../node_modules/.pnpm/<pkg>/...` (3 levels up from `@scope/` = `apps/app/node_modules/`)
  - These are AFTER step [2] which rewrote from `../../../../` to `../../`
  - Original Turbopack output (pre-rewrite): `../../../../node_modules/.pnpm/` (4 levels up from `.next/node_modules/` = Docker workspace root `/opt/node_modules/`)
- Implications: If workspace root's `node_modules/` contains prod deps, the original Turbopack symlinks resolve correctly WITHOUT any rewriting

### Topic: `pnpm deploy` symlink behavior with and without `--legacy`
- Context: Understanding why step [1b] rewrites `apps/app/node_modules/` symlinks
- Findings:
  - With `--legacy`: creates "hoisted" node_modules where top-level symlinks reference the workspace root's `.pnpm/` store (not local). After `mv out/node_modules apps/app/node_modules`, these symlinks are broken in production.
  - Without `--legacy`: pnpm's default isolated linker creates symlinks relative to the deploy output's local `.pnpm/` store. Verified: development `apps/app/node_modules/@codemirror/state` → `../.pnpm/@codemirror+state@6.5.4/node_modules/@codemirror/state` (relative, self-contained).
  - `pnpm deploy` (with or without `--legacy`) physically INJECTS workspace packages (copies, not symlinks) into the deploy output.
- Implications: Removing `--legacy` eliminates the need for step [1b] entirely.

### Topic: `apps/app/node_modules` compatibility symlink for migration scripts
- Context: The `migrate` script in `apps/app/package.json` uses path `node_modules/migrate-mongo/bin/migrate-mongo` (relative to `apps/app/`)
- Findings:
  - With the new structure (`node_modules/` at workspace root), the direct path `node_modules/migrate-mongo/...` from `apps/app/` would fail
  - Creating `apps/app/node_modules` as a symlink to `../../node_modules` (workspace root) resolves this
  - Node.js module resolution also follows symlinks, so `require()` calls work correctly
  - `cp -a` preserves symlinks (uses `-d` flag, no dereferencing), so Docker COPY will preserve it
- Implications: A single `ln -sfn ../../node_modules apps/app/node_modules` step replaces the complex `pnpm deploy + mv + symlink rewrite` chain

### Topic: `turbo prune --docker` output structure (context7 official docs)
- Sources: Turborepo official documentation via context7 (/vercel/turborepo)
- Findings:
  - `turbo prune <app> --docker` creates:
    - `out/json/` – package.json files only (for Docker layer caching)
    - `out/full/` – full source code needed for the target
    - `out/pnpm-lock.yaml` – pruned lockfile
  - After `pnpm install --frozen-lockfile` on the pruned `out/json/`, `node_modules/` is created at the workspace root of the pruned context with self-contained symlinks
  - Official examples use Next.js standalone output mode (`output: 'standalone'`) which bundles needed modules into `.next/standalone/`, avoiding symlink issues entirely. GROWI does NOT use standalone mode.
- Implications: GROWI's existing `turbo prune` usage in the Dockerfile is correct. The remaining issue is the `assemble-prod.sh` post-build assembly.

### Topic: Release image directory structure requirements
- Context: Determining what directory structure the release image needs for symlinks to resolve
- Findings:
  - Current release image: `${appDir}/apps/app/.next/` + `${appDir}/apps/app/node_modules/` (from pnpm deploy)
  - `.next/node_modules/` symlinks (after step [2]): `../../node_modules/.pnpm/` → `apps/app/node_modules/.pnpm/` ✓
  - Proposed release image: `${appDir}/node_modules/` + `${appDir}/apps/app/.next/`
  - `.next/node_modules/` symlinks (NO rewrite, original Turbopack output): `../../../../node_modules/.pnpm/` → `${appDir}/node_modules/.pnpm/` ✓
- Implications: Placing `node_modules/` (from pnpm deploy output) at workspace root level in release image, instead of `apps/app/node_modules/`, eliminates step [2] entirely.

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| A: Remove `--legacy` only | Drop `--legacy` from `pnpm deploy`, keep `apps/app/node_modules/` placement | Minimal change; step [1b] eliminated | Step [2] still required | Partial improvement |
| B: `pnpm install --prod` post-build | After build, run `pnpm install --prod --frozen-lockfile` in pruned context | Conceptually clean | Workspace packages remain as symlinks (need `packages/` in release) | Requires larger release image |
| C: `pnpm deploy --prod` (no `--legacy`) + workspace-root staging | Remove `--legacy`, place deploy output at workspace root, create `apps/app/node_modules` symlink | Eliminates BOTH step [1b] AND step [2]; workspace packages still injected (no `packages/` needed) | Need to verify pnpm deploy without `--legacy` creates self-contained `.pnpm/` store | **Selected** |

## Design Decisions

### Decision: Remove `--legacy` from `pnpm deploy` (eliminates step [1b])
- Context: `--legacy` linker creates symlinks pointing to workspace-root `.pnpm/`, requiring step [1b] rewriting
- Alternatives:
  1. Keep `--legacy`, rewrite symlinks (current approach)
  2. Remove `--legacy`, symlinks become self-contained (selected)
- Selected Approach: Remove `--legacy`
- Rationale: Without `--legacy`, pnpm's default isolated linker creates relative symlinks within the deploy output. No rewriting needed after `mv`.
- Trade-offs: Need to verify behavior with current pnpm version. `--legacy` was possibly added as a workaround for an older issue; removing it requires testing.
- Follow-up: Verify `out/node_modules/react` symlink target after `pnpm deploy out --prod --filter @growi/app` in devcontainer

### Decision: Place deploy output at workspace root, not `apps/app/` (eliminates step [2])
- Context: Turbopack generates `.next/node_modules/` symlinks pointing to `../../../../node_modules/.pnpm/` (workspace root in Docker). Step [2] rewrites these to point to `apps/app/node_modules/.pnpm/`.
- Alternatives:
  1. Keep `apps/app/node_modules/`, apply step [2] rewrite (current)
  2. Place deploy output at workspace root, no rewrite needed (selected)
- Selected Approach: `mv out/node_modules node_modules` (replace workspace root `node_modules/`) + `ln -sfn ../../node_modules apps/app/node_modules`
- Rationale: Turbopack's original symlink targets (`../../../../node_modules/.pnpm/`) already point to workspace root. Preserving this structure means no rewriting.
- Trade-offs: Release image now includes `node_modules/` at workspace root (alongside `apps/app/`). The `package.json` at workspace root is already copied in current staging, so minimal structural change.
- Follow-up: Verify Docker `COPY` preserves `apps/app/node_modules` symlink correctly

### Decision: Use `pnpm deploy --prod` (not `pnpm install --prod`)
- Context: Requirements described `pnpm install --prod` as the mechanism. Design evaluated both options.
- Alternatives:
  1. `pnpm install --prod --frozen-lockfile` — modifies existing workspace node_modules
  2. `pnpm deploy out --prod` — creates clean deploy output (selected)
- Selected Approach: `pnpm deploy out --prod --filter @growi/app` without `--legacy`
- Rationale: `pnpm deploy` handles workspace package injection (physically copies `@growi/*` packages into deploy output, no `packages/` directory needed in release image). `pnpm install --prod` would leave `node_modules/@growi/core` as a symlink requiring `packages/core/` to exist in release.
- Trade-offs: `pnpm deploy` takes slightly longer than `pnpm install --prod`. Both produce prod-only node_modules.

## Risks & Mitigations
- pnpm version compatibility: `pnpm deploy` without `--legacy` might behave differently across pnpm versions — Mitigation: pin pnpm version in Dockerfile; verify in CI before merging
- `apps/app/node_modules` symlink + Docker COPY: Docker BuildKit COPY should preserve symlinks, but must be verified — Mitigation: add a verification step in CI that checks symlink integrity in release image
- `rm -rf node_modules` in `assemble-prod.sh`: destroys workspace root `node_modules/` locally (dev workflow change) — Mitigation: document updated local testing procedure; developers must run `pnpm install` to restore after local testing

## References
- [turbo prune --docker official docs](https://github.com/vercel/turborepo/blob/main/apps/docs/content/docs/reference/prune.mdx) — `--docker` flag splits output into `json/` and `full/`
- [Turborepo Docker guide](https://github.com/vercel/turborepo/blob/main/apps/docs/content/docs/guides/tools/docker.mdx) — multi-stage Dockerfile with prune
- [pnpm deploy docs](https://pnpm.io/cli/deploy) — workspace package injection behavior
