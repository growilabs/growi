# Research & Design Decisions

## Summary
- **Feature**: `reduce-modules-loaded`
- **Discovery Scope**: Complex Integration (build system optimization + potential major framework upgrade)
- **Key Findings**:
  - `next-superjson` SWC plugin is broken in Next.js 15 — critical blocker for upgrade
  - Turbopack (default in v16) does NOT support `webpack()` config — GROWI's null-loader rules and I18NextHMRPlugin are incompatible
  - `optimizePackageImports` expansion and barrel export refactoring are zero-risk optimizations achievable on current v14
  - `bundlePagesRouterDependencies` + `serverExternalPackages` require Next.js 15+ but provide significant server-side bundling control

## Research Log

### Next.js 15 Breaking Changes for Pages Router
- **Context**: Evaluating whether Next.js 15 upgrade is feasible for GROWI's Pages Router architecture
- **Sources Consulted**: [Next.js v15 Upgrade Guide](https://nextjs.org/docs/app/guides/upgrading/version-15)
- **Findings**:
  - React 19 is minimum requirement, but backward compatibility for React 18 is available with Pages Router
  - `bundlePagesRouterDependencies` is now stable (renamed from `experimental.bundlePagesExternals`)
  - `serverExternalPackages` is now stable (renamed from `experimental.serverComponentsExternalPackages`)
  - Async Request APIs change (`cookies`, `headers`, etc.) — App Router only, does NOT affect Pages Router
  - `@next/font` package removed → must use `next/font` (codemod available)
  - Caching defaults changed (fetch, Route Handlers) — primarily App Router concern
- **Implications**:
  - Pages Router migration is relatively low-impact for the async API changes
  - The main upgrade value is `bundlePagesRouterDependencies` + `serverExternalPackages`
  - React 18 backward compat means component migration can be gradual

### next-superjson Compatibility with Next.js 15
- **Context**: GROWI uses `next-superjson` for SSR serialization in `getServerSideProps`
- **Sources Consulted**: [next-superjson GitHub](https://github.com/remorses/next-superjson), web search results
- **Findings**:
  - `next-superjson-plugin` (SWC-based) is broken in Next.js 15 due to SWC version incompatibility
  - The `next-superjson` wrapper (used by GROWI — see `withSuperjson()` in `next.config.js`) may have the same issue
  - GROWI registers custom ObjectId transformer via `superjson.registerCustom`
  - Alternative: Manual superjson serialization in `getServerSideProps` without the plugin
- **Implications**:
  - **Critical blocker** for Next.js 15 upgrade
  - Must either find a compatible version, migrate to manual superjson usage, or replace with native serialization
  - This could affect all 30+ page files that use `getServerSideProps`

### Turbopack Compatibility with GROWI
- **Context**: Turbopack is the default bundler in Next.js 16; evaluating compatibility with GROWI's custom webpack config
- **Sources Consulted**: [Turbopack API Reference](https://nextjs.org/docs/app/api-reference/turbopack)
- **Findings**:
  - Turbopack supports Pages Router and App Router
  - Turbopack does NOT support `webpack()` configuration in `next.config.js`
  - Turbopack does NOT support webpack plugins (e.g., `I18NextHMRPlugin`)
  - Turbopack DOES support webpack loaders via `turbopack.rules` configuration
  - Automatic import optimization eliminates need for `optimizePackageImports`
  - Custom `pageExtensions`, `resolveAlias`, `resolveExtensions` are supported
  - Sass is supported but `sassOptions.functions` is not
- **GROWI-Specific Blockers**:
  - `null-loader` rules for mongoose/dtrace-provider/mathjax-full → must be migrated to `turbopack.rules` or alternative exclusion mechanism
  - `I18NextHMRPlugin` → no Turbopack equivalent; would need alternative HMR approach for i18n
  - `source-map-loader` in dev mode → must be migrated to Turbopack loader config
- **Implications**:
  - Turbopack adoption requires migrating all custom webpack config
  - The `--webpack` flag allows gradual migration (use Turbopack for dev, Webpack for build)
  - Long-term Turbopack adoption is desirable but requires significant config migration

### optimizePackageImports Effectiveness
- **Context**: Evaluating whether expanding `optimizePackageImports` can reduce module count on current v14
- **Sources Consulted**: [optimizePackageImports docs](https://nextjs.org/docs/pages/api-reference/config/next-config-js/optimizePackageImports), [Vercel blog](https://vercel.com/blog/how-we-optimized-package-imports-in-next-js)
- **Findings**:
  - Available since Next.js 13.5 (already usable on v14)
  - Documented to reduce modules by up to 90% for barrel-heavy packages
  - Benchmarks: `@material-ui/icons` 11,738 → 632 modules; `lucide-react` 1,583 → 333 modules
  - Auto-optimized packages include: `lucide-react`, `date-fns`, `lodash-es`, `rxjs`, `@mui/*`, `recharts`, `react-use`, etc.
  - Works by analyzing barrel files and remapping imports to specific module paths
  - Handles nested barrel files and `export * from` patterns automatically
- **Implications**:
  - **Zero-risk, high-impact optimization** — can be applied immediately on v14
  - Current GROWI config only covers 11 `@growi/*` packages
  - Should be expanded to cover internal barrel-heavy directories and any third-party deps not in the auto-list

### Bundle Analysis Tooling
- **Context**: Need tooling to identify top module contributors and verify optimization impact
- **Sources Consulted**: [Package Bundling Guide](https://nextjs.org/docs/pages/guides/package-bundling)
- **Findings**:
  - `@next/bundle-analyzer` already installed in GROWI; activated via `ANALYZE=true`
  - `next experimental-analyze` (Turbopack-based) available in v16.1+ — more advanced with import chain tracing
  - Bundle analyzer generates visual treemap reports for client and server bundles
- **Implications**:
  - Can run `ANALYZE=true pnpm run build` immediately to establish baseline
  - Import chain tracing would help identify server module leakage paths
  - v16.1 analyzer would be ideal but requires major version upgrade

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| Phase 1: v14 Config Optimization | Expand optimizePackageImports, fix import violations, refactor barrel exports | Zero breaking changes, immediate impact, independently verifiable | Limited by Webpack tree-shaking; no `bundlePagesRouterDependencies` | Recommended first step |
| Phase 2a: Next.js 15 Upgrade | Upgrade to v15 for `bundlePagesRouterDependencies` + `serverExternalPackages` | Unlocks Pages Router bundling control; stable features | next-superjson broken; React 19 migration | Requires superjson workaround |
| Phase 2b: Turbopack Adoption (v16) | Upgrade to v16 with Turbopack default | Auto import optimization; 14x faster dev | webpack() config not supported; plugin migration | Longest-term option |

## Design Decisions

### Decision: Phased Approach — Config-First, Then Upgrade
- **Context**: Need to reduce 10,066 modules with minimal risk while keeping upgrade path open
- **Alternatives Considered**:
  1. Direct Next.js 15 upgrade — high risk, next-superjson blocker
  2. Config-only on v14 — safe but misses v15 bundling features
  3. Hybrid phased approach — config first, upgrade informed by results
- **Selected Approach**: Hybrid phased approach (Option C from gap analysis)
- **Rationale**: Phase 1 provides immediate, low-risk wins. Phase 1 metrics inform whether Phase 2 upgrade is worth the migration cost. next-superjson blocker can be researched during Phase 1 without blocking progress.
- **Trade-offs**: More total effort if upgrade is needed, but each phase independently delivers value
- **Follow-up**: Measure module count after Phase 1; research next-superjson alternatives

### Decision: Expand optimizePackageImports Before Refactoring Barrel Exports
- **Context**: Both approaches reduce barrel export impact, but differ in effort and risk
- **Alternatives Considered**:
  1. Refactor all barrel exports to direct imports — high effort, many files affected
  2. Expand `optimizePackageImports` to handle barrel files automatically — low effort, config-only
  3. Both — maximum effect
- **Selected Approach**: Expand `optimizePackageImports` first, measure impact, then refactor remaining barrels if needed
- **Rationale**: `optimizePackageImports` achieves similar results to barrel refactoring with zero code changes. If the module count drops sufficiently, barrel refactoring may be unnecessary.
- **Trade-offs**: `optimizePackageImports` may not catch all barrel patterns (e.g., side-effect-heavy modules)
- **Follow-up**: Verify with bundle analysis which barrels are still problematic after config expansion

### Decision: Fix Server Import Violations Over Expanding null-loader
- **Context**: Server modules leaking into client bundle via direct imports
- **Alternatives Considered**:
  1. Expand null-loader rules for every server package — covers symptoms, not root cause
  2. Fix import violations at source — eliminates the leakage path
  3. Both — belt and suspenders
- **Selected Approach**: Fix import violations at source as primary approach; expand null-loader as safety net for packages that might be transitively included
- **Rationale**: Fixing imports is more maintainable than maintaining an ever-growing null-loader list. However, null-loader provides defense-in-depth for undiscovered leakage paths.
- **Trade-offs**: Import fixes require more careful analysis; null-loader is simpler but masks problems
- **Follow-up**: Use bundle analysis to confirm which server packages actually appear in client bundle

## Risks & Mitigations
- **Risk**: next-superjson incompatibility blocks Next.js 15 upgrade → **Mitigation**: Research alternatives during Phase 1; manual superjson serialization as fallback
- **Risk**: Barrel export refactoring causes import breakage across codebase → **Mitigation**: Use `optimizePackageImports` first; refactor incrementally with tests
- **Risk**: Module count reduction is insufficient from config-only changes → **Mitigation**: Bundle analysis will reveal if server module leakage is the primary cause, guiding whether upgrade is needed
- **Risk**: I18NextHMRPlugin has no Turbopack equivalent → **Mitigation**: Use `--webpack` flag for dev until alternative is available; Turbopack adoption is Phase 2b

## Phase 3: Next.js 15+ Feature Evaluation (Task 9.1)

### Context

Phase 2 achieved significant module reduction (initial: 2,704 → 895, -67%) through dynamic imports, null-loader expansion, and dependency replacement. Phase 3 evaluates whether upgrading to Next.js 15 provides additional meaningful optimization via `bundlePagesRouterDependencies` and `serverExternalPackages`.

### Current State

| Component | Version | Notes |
|-----------|---------|-------|
| Next.js | 14.2.35 | Pages Router, Webpack 5 |
| React | 18.2.0 | |
| next-superjson | 1.0.7 | SWC plugin wrapper for superjson serialization |
| Node.js | 24.13.1 | Exceeds v15 minimum (18.18.0) |

### Next.js 15 Features Relevant to Module Reduction

#### 1. `bundlePagesRouterDependencies` (Stable)

- **What it does**: Enables automatic server-side dependency bundling for Pages Router, matching App Router default behavior. All server-side dependencies are bundled into the server output instead of using native Node.js `require()` at runtime.
- **Impact**: Improved cold start (pre-resolved deps), smaller deployment footprint via tree-shaking of server bundles. Does NOT directly reduce client-side initial module count (our primary KPI), but improves overall server-side build efficiency.
- **Configuration**: `bundlePagesRouterDependencies: true` in `next.config.js`
- **Risk**: Low — Next.js maintains an auto-exclude list for packages with native bindings (mongoose, mongodb, express, @aws-sdk/*, sharp are all auto-excluded)

#### 2. `serverExternalPackages` (Stable)

- **What it does**: Opt-out specific packages from server-side bundling when `bundlePagesRouterDependencies` is enabled. These packages use native `require()`.
- **Auto-excluded packages relevant to GROWI**: `mongoose`, `mongodb`, `express`, `@aws-sdk/client-s3`, `@aws-sdk/s3-presigned-post`, `sharp`, `pino`, `ts-node`, `typescript`, `webpack`
- **GROWI packages that may need manual addition**: `passport`, `ldapjs`, `nodemailer`, `multer`, `redis`, `connect-redis`, `@elastic/elasticsearch*`
- **Configuration**: `serverExternalPackages: ['passport', ...]`

#### 3. Turbopack (Stable for Dev in v15)

- **Status**: Turbopack Dev is stable in Next.js 15. Default bundler in Next.js 16.
- **Benefits**: Automatic import optimization (eliminates need for `optimizePackageImports`), 14x faster cold starts, 28x faster HMR
- **GROWI blockers**: Does NOT support `webpack()` config. GROWI's null-loader rules, I18NextHMRPlugin, source-map-loader, and ChunkModuleStatsPlugin all require webpack config.
- **Mitigation**: Can run with `--webpack` flag in dev to keep Webpack while upgrading Next.js. Turbopack adoption deferred to separate task.

#### 4. Improved Tree-shaking and Module Resolution

- **Better dead code elimination** in both Webpack and Turbopack modes
- **SWC improvements** for barrel file optimization
- **Not directly measurable** without upgrading — included as potential secondary benefit

### `next-superjson` Compatibility Assessment

#### Current Architecture

GROWI uses `withSuperjson()` in `next.config.js` (line 184) which:
1. Injects a custom webpack loader targeting `pages/` directory files
2. The loader runs `@swc/core` with `next-superjson-plugin` to AST-transform each page
3. **Auto-wraps** `getServerSideProps` with `withSuperJSONProps()` (serializes props via superjson)
4. **Auto-wraps** page default export with `withSuperJSONPage()` (deserializes props on client)

Custom serializers registered in `_app.page.tsx`:
- `registerTransformerForObjectId()` — handles MongoDB ObjectId serialization (no mongoose dependency)
- `registerPageToShowRevisionWithMeta()` — handles page revision data (called in `[[...path]]` page)

#### Compatibility Options

| Option | Approach | Risk | Effort |
|--------|----------|------|--------|
| A. Upgrade `next-superjson` to 1.0.8 | Claims v15 support via frozen `@swc/core@1.4.17` | Medium — fragile SWC binary pinning; underlying plugin unmaintained | Minimal (version bump) |
| B. Use `superjson-next@0.7.x` fork | Community SWC plugin with native v15 support | Medium — third-party fork, SWC plugins inherently fragile | Low (config change) |
| C. Manual superjson (per-page wrapping) | Remove plugin; use helper functions + wrap each page's `getServerSideProps` | Low — no SWC plugin dependency | Medium (create helpers, wrap 38 pages) |
| **D. Custom webpack loader (Recommended)** | **Remove plugin; use a simple regex-based webpack loader to auto-wrap `getServerSideProps`** | **Low — no SWC/Babel dependency, webpack loader API is stable** | **Low (create loader + config, no per-page changes)** |

#### Detailed Assessment of Option A: `next-superjson` v1.0.8 / v2.0.0

Both v1.0.8 and v2.0.0 were published on the same day (Oct 18, 2025). They share identical code — the only difference is the peer dependency declaration (`next >= 10` vs `next >= 16`).

**How v1.0.8 achieves "Next.js 15 support"**:
1. Does NOT use Next.js's built-in SWC plugin system
2. Registers a custom webpack/turbopack loader targeting `pages/` directory files
3. This loader uses a **bundled `@swc/core` pinned to v1.4.17 (March 2024)** to run a separate SWC compilation
4. The pinned SWC loads the `next-superjson-plugin` v0.6.3 WASM binary

**Risks**:
- **Double SWC compilation**: Page files are compiled by both Next.js's SWC and the plugin's frozen SWC — potential for conflicts and performance overhead
- **Pinned binary fragility**: `@swc/core@1.4.17` is from early 2024; SWC plugin ABI is notoriously unstable across versions
- **Unmaintained upstream**: The `next-superjson-plugin` v0.6.3 WASM binary comes from `blitz-js/next-superjson-plugin`, which has unmerged PRs and open issues for v15 compatibility
- **Low adoption**: Published Oct 2025, minimal community usage

**Conclusion**: The "support" is a fragile workaround, not genuine compatibility. Rejected.

#### Recommended: Option D — Custom Webpack Loader

**Why**: Achieves the same zero-page-change DX as the original `next-superjson` plugin, but without any SWC/Babel dependency. The loader is a simple regex-based source transform (~15 lines) that auto-wraps `getServerSideProps` exports with `withSuperJSONProps()`. Webpack's loader API is stable across versions, making this future-proof.

**How it works**:
1. A webpack loader targets `.page.{ts,tsx}` files
2. If the file exports `getServerSideProps`, the loader:
   - Prepends `import { withSuperJSONProps } from '~/pages/utils/superjson-ssr'`
   - Renames `export const getServerSideProps` → `const __getServerSideProps__`
   - Appends `export const getServerSideProps = __withSuperJSONProps__(__getServerSideProps__)`
3. Deserialization is centralized in `_app.page.tsx` (same as Option C)

**Migration plan**:
1. Create `withSuperJSONProps()` and `deserializeSuperJSONProps()` helpers in `src/pages/utils/superjson-ssr.ts`
2. Create `src/utils/superjson-ssr-loader.js` — simple regex-based webpack loader
3. Add loader rule in `next.config.js` webpack config (targets `.page.{ts,tsx}` files)
4. Add centralized deserialization in `_app.page.tsx`
5. Remove `next-superjson` dependency and `withSuperjson()` from `next.config.js`
6. Keep `superjson` as direct dependency; keep all `registerCustom` calls unchanged

**Advantages over Option C**:
- Zero per-page file changes (38 fewer files modified)
- Diff is ~20 lines total instead of ~660 lines
- Closer to the original `next-superjson` DX (config-only, transparent to page authors)
- New pages automatically get superjson serialization without manual wrapping

**Scope**: 3 files changed (loader, next.config.js, _app.page.tsx) + 1 new file (superjson-ssr.ts with helpers)

### Breaking Changes Affecting GROWI (Pages Router)

| Change | Impact | Action Required |
|--------|--------|-----------------|
| Node.js ≥ 18.18.0 required | None — GROWI uses Node 24.x | No action |
| `@next/font` → `next/font` | None — GROWI does not use `@next/font` | No action |
| `swcMinify` enabled by default | Low — already effective | No action |
| `next/dynamic` `suspense` prop removed | Verify — GROWI uses `next/dynamic` extensively | Check all `dynamic()` calls for `suspense` prop |
| `eslint-plugin-react-hooks` v5.0.0 | Low — may trigger new lint warnings | Run lint after upgrade |
| Config renames (`experimental.bundlePagesExternals` → `bundlePagesRouterDependencies`) | None — GROWI doesn't use the experimental names | No action |
| `next/image` `Content-Disposition` changed | None — GROWI uses standard `next/image` | No action |
| Async Request APIs (cookies, headers) | None — App Router only | No action |
| React 19 peer dependency | None — Pages Router supports React 18 backward compat | Stay on React 18 |

### Decision: Proceed with Next.js 15 Upgrade

**Rationale**:
1. **`bundlePagesRouterDependencies` + `serverExternalPackages`** provide proper server-side dependency bundling, completing the optimization work started in Phase 2
2. **Breaking changes for Pages Router are minimal** — no async API changes, no React 19 requirement
3. **`next-superjson` blocker is resolved** via custom webpack loader (Option D) — zero per-page changes, same transparent DX as original plugin
4. **No Turbopack migration needed** — continue using Webpack with `--webpack` flag in dev
5. **Phase 2 results (initial: 895 modules)** are already strong; v15 features provide server-side improvements and lay groundwork for future Turbopack adoption

**Expected benefits**:
- Server-side bundle optimization via `bundlePagesRouterDependencies`
- Proper `serverExternalPackages` support (replaces null-loader workaround for some packages)
- Modern Next.js foundation for future improvements (Turbopack, App Router migration path)
- Elimination of fragile SWC plugin dependency (`next-superjson`) — replaced by simple webpack loader with no external dependencies

**Risks and mitigations**:
- `I18NextHMRPlugin` — Keep using Webpack bundler in dev (`--webpack` flag if needed)
- Test regressions — Full test suite + typecheck + lint + build verification
- Superjson serialization — Test all page routes for correct data serialization/deserialization

## References
- [Next.js v15 Upgrade Guide](https://nextjs.org/docs/app/guides/upgrading/version-15) — Breaking changes inventory
- [Turbopack API Reference](https://nextjs.org/docs/app/api-reference/turbopack) — Supported features and known gaps
- [optimizePackageImports (Pages Router)](https://nextjs.org/docs/pages/api-reference/config/next-config-js/optimizePackageImports) — Config documentation
- [Package Bundling Guide (Pages Router)](https://nextjs.org/docs/pages/guides/package-bundling) — bundlePagesRouterDependencies, serverExternalPackages
- [How we optimized package imports in Next.js](https://vercel.com/blog/how-we-optimized-package-imports-in-next-js) — Benchmarks and approach
- [next-superjson GitHub](https://github.com/remorses/next-superjson) — Compatibility status
- [next-superjson-plugin GitHub](https://github.com/blitz-js/next-superjson-plugin) — SWC plugin (unmaintained)
- [superjson-next fork](https://github.com/serg-and/superjson-next) — Community fork with v15 support
- [Next.js 15.5 Blog Post](https://nextjs.org/blog/next-15-5) — Latest features
- [server-external-packages.jsonc](https://github.com/vercel/next.js/blob/canary/packages/next/src/lib/server-external-packages.jsonc) — Auto-excluded server packages
