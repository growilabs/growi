# Research & Design Decisions

## Summary
- **Feature**: `migrate-to-turbopack`
- **Discovery Scope**: Complex Integration
- **Key Findings**:
  - Next.js 16 `next()` programmatic API officially supports `turbopack: true` for custom servers — the primary blocker is resolved
  - Turbopack `rules` with `condition: { not: 'browser' }` enables server-only loaders, making `superjson-ssr-loader` migration feasible
  - Turbopack is stable for both dev and production builds in Next.js 16, meaning full migration (not dev-only) is possible
  - `i18next-hmr` webpack plugin has no Turbopack equivalent; i18n HMR requires alternative approach or manual reload tradeoff
  - `resolveAlias` with `{ browser: ... }` conditional aliasing replaces both `resolve.fallback` and `null-loader` patterns

## Research Log

### Custom Server + Turbopack Compatibility
- **Context**: GROWI uses Express custom server calling `next({ dev, webpack: true })`. Need to confirm Turbopack works with programmatic API.
- **Sources Consulted**:
  - [Next.js Custom Server Guide](https://nextjs.org/docs/app/guides/custom-server) (v16.1.6, 2026-02-27)
  - [GitHub Discussion #49325](https://github.com/vercel/next.js/discussions/49325)
  - [GitHub Issue #65479](https://github.com/vercel/next.js/issues/65479)
- **Findings**:
  - The `next()` function in Next.js 16 accepts: `turbopack: boolean` (enabled by default) and `webpack: boolean`
  - GROWI's current `next({ dev, webpack: true })` explicitly opts out of Turbopack
  - Switching to `next({ dev })` or `next({ dev, turbopack: true })` enables Turbopack with custom server
  - No `TURBOPACK=1` env var hack needed — official API parameter available
- **Implications**: The custom server is NOT a blocker. Migration focus shifts entirely to webpack config equivalents.

### Turbopack Loader System (turbopack.rules)
- **Context**: `superjson-ssr-loader` must run server-side only on `.page.{ts,tsx}` files.
- **Sources Consulted**:
  - [Turbopack Config Docs](https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopack) (v16.1.6)
  - [GitHub Discussion #63150](https://github.com/vercel/next.js/discussions/63150) — server/client conditional loaders
- **Findings**:
  - `turbopack.rules` supports glob-based file matching with `condition` for environment targeting
  - Server-only condition: `condition: { not: 'browser' }`
  - Browser-only condition: `condition: 'browser'`
  - Advanced conditions available: `all`, `any`, `not`, `path` (glob/RegExp), `content` (RegExp), `foreign`, `development`, `production`
  - Loaders must return JavaScript code (our superjson-ssr-loader already does)
  - Missing loader APIs: `importModule`, `loadModule`, `emitFile`, `this.mode`, `this.target`, `this.resolve`
  - `superjson-ssr-loader` uses only `source` parameter (simple string transform) — compatible with loader-runner subset
- **Implications**: superjson-ssr-loader migration is straightforward via `turbopack.rules` with server condition.

### resolveAlias for Package Exclusion (null-loader replacement)
- **Context**: 7 packages excluded from client bundle via null-loader, plus fs fallback.
- **Sources Consulted**:
  - [Turbopack Config Docs](https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopack)
  - [Turbopack Resolve Fallback Forum](https://nextjs-forum.com/post/1189694920328487023)
  - [GitHub Issue #88540](https://github.com/vercel/next.js/issues/88540) — resolveAlias transitive dependency issues
- **Findings**:
  - `turbopack.resolveAlias` supports conditional aliasing: `{ browser: './empty-module.js' }`
  - For `fs`: `resolveAlias: { fs: { browser: './src/lib/empty.ts' } }` with an empty file
  - For null-loader replacements: alias each package to an empty module in browser context
  - Known issue: resolveAlias may not resolve transitive dependencies correctly (GitHub #88540), but our null-loader targets are direct imports not transitive
  - Regex-based test patterns (e.g., `/\/bunyan\//`) need conversion to package-name aliases
- **Implications**: Direct 1:1 mapping possible. Need an `empty.ts` module (`export default {}` or empty file). Regex patterns convert to package name strings.

### I18NextHMRPlugin and i18n HMR
- **Context**: `I18NextHMRPlugin` is a webpack plugin providing HMR for translation JSON files. Turbopack has no plugin API.
- **Sources Consulted**:
  - [i18next-hmr npm](https://www.npmjs.com/package/i18next-hmr)
  - [GitHub Issue #2113](https://github.com/i18next/next-i18next/issues/2113) — Turbopack support
  - [i18next-hmr GitHub](https://github.com/felixmosh/i18next-hmr)
- **Findings**:
  - `i18next-hmr` provides: (1) `I18NextHMRPlugin` webpack plugin for client, (2) `HMRPlugin` i18next plugin for server and client
  - The webpack plugin watches locale files and triggers HMR updates — no Turbopack equivalent exists
  - next-i18next + Turbopack compatibility status is unclear/problematic (issue #2113 closed as stale)
  - `next-i18next` core functionality (i18n routing, SSR) should work independently of bundler, since it uses Next.js i18n config
  - The HMR plugin is dev-only convenience — not required for functionality
- **Implications**:
  - Drop `I18NextHMRPlugin` webpack plugin when using Turbopack
  - Also drop `HMRPlugin` from `next-i18next.config.js` `use` array when Turbopack is active
  - Translation changes require manual browser refresh in Turbopack dev mode
  - Acceptable tradeoff: Turbopack's overall faster compilation outweighs i18n HMR loss

### Turbopack Production Build Status
- **Context**: Need to determine if production builds can also use Turbopack.
- **Sources Consulted**:
  - [Next.js 16 Blog](https://nextjs.org/blog/next-16)
  - [Turbopack Stable Announcement](https://nextjs.org/blog/turbopack-for-development-stable)
  - [Progosling: Turbopack Default](https://progosling.com/en/dev-digest/2026-02/nextjs-16-turbopack-default)
- **Findings**:
  - Turbopack is stable for both `next dev` and `next build` in Next.js 16
  - 50%+ dev sessions and 20%+ production builds already on Turbopack (Next.js 15.3+ stats)
  - `next build` with custom webpack config will fail by default — must use `--webpack` flag or migrate config
  - Both Turbopack config (`turbopack` key) and webpack config (`webpack()` hook) can coexist in next.config.ts
- **Implications**: Full migration (dev + build) is feasible. Incremental approach: dev first, then production build.

### ChunkModuleStatsPlugin Replacement
- **Context**: Custom webpack plugin logging initial/async module counts. Turbopack has no plugin API.
- **Sources Consulted**: Turbopack API docs, no third-party analysis tools found for Turbopack
- **Findings**:
  - Turbopack exposes no compilation hooks or chunk graph API
  - No equivalent plugin mechanism exists
  - `@next/bundle-analyzer` may work with Turbopack production builds (uses webpack-bundle-analyzer under the hood — needs verification)
  - Alternative: Use Turbopack's built-in trace/debug features or browser DevTools for analysis
- **Implications**: Defer module analysis tooling. Accept this as a temporary limitation. Existing webpack mode can be used for detailed analysis when needed.

### ESM transpilePackages under Turbopack
- **Context**: 70+ packages in `transpilePackages` for ESM compatibility.
- **Sources Consulted**: Turbopack docs, Next.js 16 upgrade guide
- **Findings**:
  - `transpilePackages` is supported by both webpack and Turbopack in Next.js
  - Turbopack handles ESM natively with better resolution than webpack
  - Some packages in the list may not need explicit transpilation under Turbopack
  - `optimizePackageImports` (experimental) is also supported under Turbopack
- **Implications**: Keep `transpilePackages` config as-is initially. Test removing entries incrementally after migration verified.

### Vendor CSS Handling under Turbopack Pages Router
- **Context**: Turbopack Pages Router strictly enforces that global CSS can only be imported from `_app.page.tsx`. Components importing vendor CSS (e.g., `import 'katex/dist/katex.min.css'`) fail to compile. Need a strategy that avoids centralizing all vendor CSS in `_app` (which would degrade FCP for pages that don't need those styles).
- **Sources Consulted**:
  - [Next.js CSS Modules Docs](https://nextjs.org/docs/app/getting-started/css#css-modules)
  - [Vite CSS ?inline Suffix](https://vite.dev/guide/features.html#disabling-css-injection-into-the-page)
  - Implementation experiments in this repository
- **Approaches Evaluated**:
  1. **Centralize in `_app.page.tsx`** — Move all vendor CSS imports to `_app`. Simple but degrades FCP for pages that don't need those styles.
  2. **CSS Module wrappers** (`:global { @import '...' }`) — Create `vendor-*.module.scss` files wrapping vendor CSS in `:global {}`. Failed because Turbopack rejects `:global` block form entirely.
  3. **Vite precompilation with `?inline`** — Create `*.vendor-styles.ts` entry points that import CSS via Vite's `?inline` suffix (inlines CSS as a string), then inject into `document.head` via `<style>` tags at runtime. Components import the prebuilt `.js` output instead of raw CSS.
- **Findings**:
  - Approach 2 failed: Turbopack does not support `:global` block form in CSS Modules — not just for selectors but also for `@import` wrappers
  - Approach 3 works: Vite `?inline` converts CSS to a JS string export. The prebuilt JS file contains no CSS imports, so Turbopack sees it as a regular JS module
  - `handsontable/dist/handsontable.full.min.css` contains IE CSS hacks (`*zoom:1`, `filter:alpha()`) that Turbopack's CSS parser (lightningcss) cannot parse. Switched to `handsontable/dist/handsontable.css` (non-full, non-minified variant)
  - Vite's `?inline` approach runs at prebuild time (before Turbopack/Next.js), fitting naturally into the existing Turborepo task pipeline alongside `pre:styles-commons`
  - SSR caveat: CSS injected via `<style>` tags is not available during SSR. Most consuming components already use `next/dynamic` with `ssr: false`, so FOUC is not a practical concern
- **Implications**: Selected Approach 3. Two-track vendor CSS system: commons track (`vendor.scss` for globally shared CSS like `simplebar-react`) and components track (`*.vendor-styles.ts` for component-specific CSS precompiled by Vite).

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| Dev-Only Migration | Use Turbopack for dev, keep webpack for build | Low risk, immediate DX gain | Dual config maintenance | Recommended as Phase 1 |
| Full Migration | Use Turbopack for both dev and build | Single config, simpler maintenance | Higher risk, production impact | Target as Phase 2 |
| Feature-Flag Approach | Environment variable toggles bundler choice | Maximum flexibility, easy rollback | Complexity in config | Use during transition |

## Design Decisions

### Decision: Dual-Config with Phased Migration
- **Context**: Need to migrate 6 webpack customizations while maintaining stability
- **Alternatives Considered**:
  1. Big-bang migration — convert everything at once, remove webpack config
  2. Dev-only first — Turbopack for dev, webpack for build
  3. Feature-flag approach — `USE_WEBPACK=1` toggles between bundlers
- **Selected Approach**: Option 3 (feature-flag) as implementation vehicle, with Option 2 as the initial target state
- **Rationale**: Allows any developer to fall back to webpack instantly if Turbopack issues arise. The flag approach naturally supports phased rollout.
- **Trade-offs**: Slightly more complex next.config.ts during transition. Both configs must be maintained until webpack is fully removed.
- **Follow-up**: After verification period, remove webpack config and flag in a cleanup task.

### Decision: Drop i18n HMR Plugin
- **Context**: `I18NextHMRPlugin` is webpack-only. No Turbopack equivalent.
- **Alternatives Considered**:
  1. Keep webpack for dev to preserve i18n HMR
  2. Drop i18n HMR, accept manual refresh for translation changes
  3. Investigate custom Turbopack-compatible i18n HMR solution
- **Selected Approach**: Option 2 — drop i18n HMR
- **Rationale**: The performance gain from Turbopack (5-10x faster Fast Refresh) far outweighs the loss of i18n-specific HMR. Translation editing is a small fraction of dev time.
- **Trade-offs**: Translation file changes require manual browser refresh. Overall dev experience still dramatically improved.
- **Follow-up**: Monitor if `i18next-hmr` adds Turbopack support in the future.

### Decision: Empty Module File for resolveAlias
- **Context**: null-loader replaces modules with empty exports. Turbopack resolveAlias needs an actual file path.
- **Alternatives Considered**:
  1. Create `src/lib/empty-module.ts` with `export default {}`
  2. Use `false` value in resolveAlias (like webpack resolve.fallback)
  3. Use inline empty string path
- **Selected Approach**: Option 1 — create a dedicated empty module file
- **Rationale**: Explicit, documented, easy to understand. Works reliably with conditional browser aliasing.
- **Trade-offs**: One extra file in the codebase.
- **Follow-up**: Verify all 7 null-loader targets work correctly with the alias approach.

### Decision: Vite Precompilation for Vendor CSS
- **Context**: Turbopack Pages Router rejects global CSS imports outside `_app.page.tsx`. Need per-component vendor CSS without centralizing everything in `_app`.
- **Alternatives Considered**:
  1. Centralize all vendor CSS in `_app.page.tsx` — simple but degrades FCP
  2. CSS Module wrappers with `:global { @import }` — Turbopack rejects `:global` block form
  3. Vite precompilation with `?inline` suffix — CSS inlined into JS at prebuild time
- **Selected Approach**: Option 3 — Vite precompilation
- **Rationale**: Keeps CSS co-located with consuming components (no FCP penalty for unrelated pages). Fits naturally into the existing Turborepo prebuild pipeline (parallel to `pre:styles-commons`). No Turbopack restrictions apply since the output is pure JS.
- **Trade-offs**: Additional prebuild step (fast in practice). Runtime CSS injection means styles are not available during SSR (acceptable since most consuming components use `ssr: false`).
- **Naming Convention**: `{ComponentName}.vendor-styles.ts` → `{ComponentName}.vendor-styles.prebuilt.js`

## Risks & Mitigations
- **Risk 1**: next-i18next may have runtime issues under Turbopack (not just HMR) — **Mitigation**: Test i18n routing and SSR early; maintain webpack fallback flag
- **Risk 2**: superjson-ssr-loader may use unsupported loader-runner API features — **Mitigation**: The loader only performs regex-based string transforms on the `source` argument; no advanced APIs used. If issues arise, convert to a Babel plugin or code generation.
- **Risk 3**: resolveAlias may not handle transitive dependencies from null-loaded packages — **Mitigation**: Current null-loader targets are matched by regex on file paths; resolveAlias uses package names. Test each package individually.
- **Risk 4**: ESM packages may behave differently under Turbopack resolution — **Mitigation**: Keep `transpilePackages` list unchanged initially; test pages using remark/rehype ecosystem.
- **Risk 5**: Production build regression — **Mitigation**: Phase 1 keeps webpack for production; Phase 2 migrates production only after dev is verified stable.

## References
- [Next.js Custom Server Guide](https://nextjs.org/docs/app/guides/custom-server) — confirms `turbopack` option in `next()` API
- [Next.js Turbopack Config](https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopack) — rules, resolveAlias, conditions
- [Next.js 16 Release Blog](https://nextjs.org/blog/next-16) — Turbopack stable for dev and build
- [Next.js Upgrade Guide v16](https://nextjs.org/docs/app/guides/upgrading/version-16) — migration steps
- [GitHub Discussion #63150](https://github.com/vercel/next.js/discussions/63150) — server/client conditional loaders
- [GitHub Discussion #49325](https://github.com/vercel/next.js/discussions/49325) — custom server + Turbopack
- [i18next-hmr](https://github.com/felixmosh/i18next-hmr) — webpack/vite only, no Turbopack support
- [Turbopack Loader API Limitations](https://nextjs.org/docs/app/api-reference/turbopack) — missing features documented
