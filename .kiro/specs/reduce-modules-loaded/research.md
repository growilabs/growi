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

## References
- [Next.js v15 Upgrade Guide](https://nextjs.org/docs/app/guides/upgrading/version-15) — Breaking changes inventory
- [Turbopack API Reference](https://nextjs.org/docs/app/api-reference/turbopack) — Supported features and known gaps
- [optimizePackageImports (Pages Router)](https://nextjs.org/docs/pages/api-reference/config/next-config-js/optimizePackageImports) — Config documentation
- [Package Bundling Guide (Pages Router)](https://nextjs.org/docs/pages/guides/package-bundling) — bundlePagesRouterDependencies, serverExternalPackages
- [How we optimized package imports in Next.js](https://vercel.com/blog/how-we-optimized-package-imports-in-next-js) — Benchmarks and approach
- [next-superjson GitHub](https://github.com/remorses/next-superjson) — Compatibility status
