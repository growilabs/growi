# Research & Design Decisions

---
**Purpose**: Capture discovery findings, architectural investigations, and rationale for the Next.js v16 upgrade.
---

## Summary
- **Feature**: `nextjs-v16-upgrade`
- **Discovery Scope**: Complex Integration (framework major version upgrade)
- **Key Findings**:
  - `--webpack` flag works for both `next dev` and `next build`, preserving all custom webpack config unchanged
  - React 18 remains fully supported for Pages Router in Next.js 16 — no React upgrade required
  - GROWI has no middleware file, no runtime config, no AMP, no legacy image imports — most v16 removals don't apply

## Research Log

### Next.js 16 Webpack Flag Behavior
- **Context**: GROWI has extensive custom webpack config (5 loaders/plugins, 7 null-loader rules). Need to understand v16 webpack compatibility.
- **Sources Consulted**: nextjs.org/docs/app/api-reference/cli/next, nextjs.org/docs/app/api-reference/config/next-config-js/webpack, nextjs.org/blog/next-16
- **Findings**:
  - `next dev --webpack` and `next build --webpack` both use webpack exactly as before
  - The `webpack()` function in next.config.ts is invoked identically when `--webpack` flag is used
  - If `next build` runs without `--webpack` and a `webpack()` function exists, the build **fails** (hard error, not warning)
  - The webpack API (function signature, arguments, hooks) is unchanged between v15 and v16
- **Implications**: GROWI must add `--webpack` flag to build and dev scripts. All existing webpack config works without modification.

### Turbopack resolveAlias (Future Reference)
- **Context**: Documenting Turbopack equivalents for potential future migration.
- **Sources Consulted**: nextjs.org/docs/app/api-reference/config/next-config-js/turbopack
- **Findings**:
  - null-loader → `turbopack.resolveAlias` with `{ browser: './empty.ts' }` per package
  - `resolve.fallback: { fs: false }` → `turbopack.resolveAlias: { fs: { browser: './empty.ts' } }`
  - Custom loaders partially supported via `turbopack.rules` (babel-loader, @svgr/webpack, etc.)
  - `null-loader` is NOT in the supported loaders list
  - `superjson-ssr-loader.ts` would need testing with Turbopack
- **Implications**: Full Turbopack migration is a separate, substantial effort. Not in scope for this upgrade.

### `.next/dev` Isolated Build Directory
- **Context**: v16 introduces `isolatedDevBuild` (enabled by default), changing dev output to `.next/dev`.
- **Sources Consulted**: nextjs.org/docs/app/api-reference/config/next-config-js/isolatedDevBuild
- **Findings**:
  - `next dev` outputs to `.next/dev` (regardless of `--webpack` or Turbopack)
  - `next build` outputs to `.next` (unchanged)
  - Can disable with `experimental: { isolatedDevBuild: false }`
  - A lockfile mechanism prevents multiple `next dev` instances on same project
- **Implications**: `bin/measure-chunk-stats.sh` cleans `.next` (line 27) and runs `npx next dev` (line 31). Both need updating: clean `.next/dev` and add `--webpack` flag.

### React 18 Compatibility with Next.js 16
- **Context**: GROWI uses React 18.2.0 with Pages Router.
- **Sources Consulted**: nextjs.org/blog/next-16, github.com/vercel/next.js/pull/69484, next.js package.json
- **Findings**:
  - Next.js 16 peer dependencies: `"react": "^18.2.0 || ^19.0.0"`
  - App Router requires React 19 for new features (View Transitions, useEffectEvent, etc.)
  - Pages Router continues full React 18 support
- **Implications**: No React version change required. GROWI can stay on React 18.2.0.

### Middleware to Proxy Rename
- **Context**: v16 deprecates `middleware.ts` → `proxy.ts`.
- **Sources Consulted**: nextjs.org/docs/messages/middleware-to-proxy
- **Findings**:
  - GROWI has **no** `middleware.ts` or `middleware.js` file
  - The rename is a deprecation (old filename still works with warning)
- **Implications**: No action required.

### Phase Config and process.argv
- **Context**: v16 changes when next.config is loaded during `next dev`, affecting `process.argv` checks.
- **Sources Consulted**: nextjs.org/docs/app/guides/upgrading/version-16
- **Findings**:
  - `process.argv.includes('dev')` returns `false` in v16 during `next dev`
  - GROWI uses `phase` parameter (PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER) — NOT process.argv
- **Implications**: No impact on GROWI's phase-based config.

### Sass Tilde Imports
- **Context**: Turbopack doesn't support tilde (`~`) prefix for node_modules imports in Sass.
- **Findings**:
  - Only 1 node_modules tilde import: `@import '~react-toastify/scss/main'` in `toastr.scss`
  - All other `~/...` patterns are Next.js path aliases (resolve to source root) — NOT affected
- **Implications**: Single file change required. Other SCSS files are unaffected.

### @next/bundle-analyzer Version
- **Context**: Currently `^15.0.0`, needs verification for v16 compatibility.
- **Findings**:
  - `@next/bundle-analyzer` follows Next.js versioning
  - Must be upgraded to `^16.0.0` alongside Next.js
- **Implications**: Version bump required in package.json.

### Deprecated/Removed Features Audit
- **Context**: v16 removes several features. Need to verify GROWI doesn't use any.
- **Findings**:
  - `serverRuntimeConfig`/`publicRuntimeConfig`: NOT used
  - `next/config` getConfig: NOT used
  - `next/legacy/image`: NOT used
  - AMP (`useAmp`, `next/amp`): NOT used
  - `next lint`: NOT used (GROWI uses Biome)
  - `images.domains`: NOT used
  - `devIndicators` removed options: NOT used
- **Implications**: All v16 removals are non-impacting for GROWI.

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| A: Webpack-only | Keep `--webpack` everywhere | Zero migration risk, all config preserved | No Turbopack benefits | **Selected** |
| B: Hybrid | Turbopack for dev, webpack for build | Faster dev restarts | Config duplication, potential behavior drift | Not recommended now |
| C: Full Turbopack | Migrate all webpack config | Future-proof, best perf | High effort, null-loader unsupported, custom loaders risk | Separate initiative |

## Design Decisions

### Decision: Webpack-Only Upgrade Strategy
- **Context**: GROWI has 5 webpack loaders/plugins and 7 null-loader rules. Turbopack doesn't support null-loader.
- **Alternatives Considered**:
  1. Option A: Upgrade with `--webpack` flag (preserve all config)
  2. Option B: Partial Turbopack migration (dev only)
  3. Option C: Full Turbopack migration
- **Selected Approach**: Option A — use `--webpack` flag for both dev and build
- **Rationale**: Zero risk to existing module reduction achievements. Turbopack migration requires resolveAlias rewrites, custom loader testing, and I18NextHMRPlugin replacement — substantial effort with unclear benefit for Pages Router.
- **Trade-offs**: No Turbopack performance benefits vs. guaranteed stability
- **Follow-up**: Evaluate Turbopack migration as separate initiative after v16 stabilization

### Decision: Keep React 18
- **Context**: Next.js 16 supports React 18.2.0+ for Pages Router via peer dependency range.
- **Selected Approach**: Stay on React ^18.2.0
- **Rationale**: React 19 features (View Transitions, useEffectEvent) are App Router only. Pages Router gets no benefit.
- **Follow-up**: React 19 upgrade can be paired with future App Router migration

### Decision: Disable isolatedDevBuild
- **Context**: GROWI runs a custom Express server that initializes Next.js programmatically via `next({ dev })`. The `.next/dev` directory split may complicate the custom server setup.
- **Alternatives Considered**:
  1. Accept `.next/dev` and update all tooling
  2. Disable `isolatedDevBuild` to maintain `.next` as output
- **Selected Approach**: Accept `.next/dev` (Option 1) — align with v16 defaults
- **Rationale**: Only `measure-chunk-stats.sh` needs updating. The custom server calls `next({ dev })` which handles directory resolution internally.
- **Follow-up**: Verify custom server works correctly with `.next/dev`

## Risks & Mitigations
- **Risk 1**: `@next/bundle-analyzer@^15` incompatible with Next.js 16 — Mitigation: bump to `^16.0.0`
- **Risk 2**: Custom superjson-ssr-loader may have subtle behavior changes with webpack version bundled in Next.js 16 — Mitigation: existing superjson-ssr.spec.ts tests cover round-trip serialization
- **Risk 3**: `ts-node` hook preservation may behave differently if v16 changes config transpiler — Mitigation: existing workaround logic is defensive (check-and-restore pattern)
- **Risk 4**: `next-i18next` or `i18next-hmr` may have compatibility issues with Next.js 16 — Mitigation: test in dev mode, fallback to disabling HMR plugin

## References
- [Next.js 16 Upgrade Guide](https://nextjs.org/docs/app/guides/upgrading/version-16) — primary migration reference
- [Next.js 16 Blog Post](https://nextjs.org/blog/next-16) — feature overview
- [Next.js CLI Reference](https://nextjs.org/docs/app/api-reference/cli/next) — `--webpack` flag docs
- [Turbopack Config](https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopack) — future migration reference
- [isolatedDevBuild](https://nextjs.org/docs/app/api-reference/config/next-config-js/isolatedDevBuild) — `.next/dev` behavior
