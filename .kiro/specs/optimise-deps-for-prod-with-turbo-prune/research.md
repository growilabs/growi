# Research: optimise-deps-for-prod-with-turbo-prune

## Summary
- Feature: `optimise-deps-for-prod-with-turbo-prune`
- Discovery Scope: Extension (modifying existing build pipeline)
- Key Findings:
  1. **pnpm v10**: `pnpm deploy --prod --legacy` creates self-contained symlinks within the deploy output's local `.pnpm/` store (verified: `out/node_modules/react` → `.pnpm/react@18.2.0/node_modules/react`). The `--legacy` flag no longer causes workspace-root-pointing symlinks. Without `--legacy`, pnpm v10 requires `inject-workspace-packages=true` and also produces self-contained symlinks — but introduces an extra config dependency. Keeping `--legacy` is the simpler choice.
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

### Topic: `pnpm deploy` symlink behavior with and without `--legacy` (pnpm v10)
- Context: Understanding why step [1b] rewrites `apps/app/node_modules/` symlinks
- Findings:
  - **pnpm v10 + `--legacy`**: produces a pnpm-native `.pnpm/` structure with self-contained relative symlinks. Verified in pnpm v10.32.1: `out/node_modules/react` → `.pnpm/react@18.2.0/node_modules/react`; `out/node_modules/@codemirror/state` → `../.pnpm/@codemirror+state@6.5.4/node_modules/@codemirror/state`. The `--legacy` flag now only bypasses the `inject-workspace-packages` gate introduced in pnpm v10; it does NOT produce hoisted/workspace-root-pointing symlinks.
  - **pnpm v10 without `--legacy`**: fails with `ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE` unless `inject-workspace-packages=true` is set in `.npmrc`. When set, it also produces self-contained symlinks — identical output to `--legacy`. Introduces an extra config dependency with no practical benefit over keeping `--legacy`.
  - **Legacy assumption (pre-pnpm v10)**: Earlier pnpm versions with `--legacy` created symlinks referencing the workspace-root `.pnpm/` store, which required step [1b] to rewrite them after `mv`. This assumption is no longer valid in pnpm v10.
  - `pnpm deploy` (with or without `--legacy`) physically INJECTS workspace packages (copies, not symlinks) into the deploy output.
- Implications: Step [1b] is no longer needed in pnpm v10 regardless of `--legacy`. The real root cause of step [1b] was placing the deploy output at `apps/app/` (not `--legacy` itself). Changing the placement to workspace root eliminates both step [1b] and step [2].

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
| A: Remove `--legacy` only | Drop `--legacy` from `pnpm deploy`, keep `apps/app/node_modules/` placement | Minimal change | Step [2] still required; pnpm v10 requires `inject-workspace-packages=true` | Partial improvement; adds config dependency |
| B: `pnpm install --prod` post-build | After build, run `pnpm install --prod --frozen-lockfile` in pruned context | Conceptually clean | Workspace packages remain as symlinks (need `packages/` in release) | Requires larger release image |
| C: Keep `--legacy` + workspace-root staging | Keep `--legacy`, place deploy output at workspace root, create `apps/app/node_modules` symlink | Eliminates BOTH step [1b] AND step [2]; workspace packages still injected (no `packages/` needed); no `.npmrc` changes | `--legacy` flag remains (cosmetically); pnpm v10 behavior verified | **Selected** |

## Design Decisions

### Decision: Keep `--legacy` in `pnpm deploy`; eliminate step [1b] by changing placement (not by removing `--legacy`)
- Context: The original assumption was that `--legacy` caused workspace-root-pointing symlinks, requiring step [1b]. Verified in pnpm v10: `--legacy` produces self-contained `.pnpm/` symlinks — step [1b] is unnecessary regardless of `--legacy`.
- Alternatives:
  1. Remove `--legacy` — requires `inject-workspace-packages=true` in pnpm v10 (extra config); same symlink output
  2. Keep `--legacy` — works in pnpm v10 without any `.npmrc` changes (selected)
- Selected Approach: Keep `--legacy`; eliminate step [1b] by changing placement from `apps/app/` to workspace root
- Rationale: The true root cause of step [1b] was placing the deploy output at `apps/app/` (misaligned with Turbopack's symlink base), not `--legacy` itself. Fixing placement eliminates both step [1b] and step [2] without requiring `.npmrc` changes.
- Trade-offs: `--legacy` flag remains in the script. It is now a pnpm v10 gate-bypass, not a linker-mode selector.

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
- Selected Approach: `pnpm deploy out --prod --legacy --filter @growi/app`
- Rationale: `pnpm deploy` handles workspace package injection (physically copies `@growi/*` packages into deploy output, no `packages/` directory needed in release image). `pnpm install --prod` would leave `node_modules/@growi/core` as a symlink requiring `packages/core/` to exist in release.
- Trade-offs: `pnpm deploy` takes slightly longer than `pnpm install --prod`. Both produce prod-only node_modules.

## Risks & Mitigations
- pnpm version compatibility: `--legacy` behavior changed between pnpm v9 and v10 (v9: hoisted symlinks; v10: self-contained). The implementation assumes pnpm v10+ behavior. — Mitigation: verify in CI with the same pnpm version as the Dockerfile; if downgrading pnpm, step [1b] may need to be reinstated.
- `apps/app/node_modules` symlink + Docker COPY: Docker BuildKit COPY should preserve symlinks, but must be verified — Mitigation: add a verification step in CI that checks symlink integrity in release image
- `rm -rf node_modules` in `assemble-prod.sh`: destroys workspace root `node_modules/` locally (dev workflow change) — Mitigation: document updated local testing procedure; developers must run `pnpm install` to restore after local testing

## References
- [turbo prune --docker official docs](https://github.com/vercel/turborepo/blob/main/apps/docs/content/docs/reference/prune.mdx) — `--docker` flag splits output into `json/` and `full/`
- [Turborepo Docker guide](https://github.com/vercel/turborepo/blob/main/apps/docs/content/docs/guides/tools/docker.mdx) — multi-stage Dockerfile with prune
- [pnpm deploy docs](https://pnpm.io/cli/deploy) — workspace package injection behavior
