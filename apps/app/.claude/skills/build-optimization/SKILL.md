---
name: build-optimization
description: GROWI apps/app webpack configuration, module optimization, and build measurement tooling. Auto-invoked when working in apps/app.
user-invocable: false
---

# Build Optimization (apps/app)

## Next.js Version & Bundler Strategy

- **Next.js 16** (`^16.0.0`) with **Webpack** bundler (not Turbopack)
- Turbopack is the default in v16, but GROWI opts out via `--webpack` flag due to custom webpack configuration
- Build: `next build --webpack`; Dev: Express server calls `next({ dev })` which uses webpack when `webpack()` config exists
- React stays at `^18.2.0` — Pages Router has full React 18 support in v16

## Custom Webpack Configuration

| Component | File | Purpose |
|-----------|------|---------|
| **superjson-ssr-loader** | `src/utils/superjson-ssr-loader.js` | Auto-wraps `getServerSideProps` with SuperJSON serialization |
| **null-loader rules** (7) | `next.config.ts` | Exclude server-only packages from client bundle |
| **I18NextHMRPlugin** | `next.config.ts` | i18n hot module replacement in dev mode |
| **ChunkModuleStatsPlugin** | `src/utils/next.config.utils.js` | Dev-time module count analysis (initial/async-only/total) |
| **source-map-loader** | `next.config.ts` | Source map extraction in dev builds |

### null-loader Rules

7 packages excluded from client bundle: `dtrace-provider`, `mongoose`, `mathjax-full`, `i18next-fs-backend`, `bunyan`, `bunyan-format`, `core-js`

**Important**: Any changes to these loaders/plugins must be verified against the module count baseline.

## SuperJSON Serialization Architecture

The `next-superjson` SWC plugin was replaced by a custom webpack loader:

- **Build time**: `superjson-ssr-loader.js` auto-wraps `getServerSideProps` in `.page.{ts,tsx}` files with `withSuperJSONProps()`
- **Runtime (server)**: `withSuperJSONProps()` in `src/pages/utils/superjson-ssr.ts` serializes props via superjson
- **Runtime (client)**: `_app.page.tsx` calls `deserializeSuperJSONProps()` for centralized deserialization
- **No per-page changes needed** — new pages automatically get superjson serialization
- Custom serializers registered in `_app.page.tsx` (ObjectId, PageRevisionWithMeta)

## Module Optimization Configuration

- `bundlePagesRouterDependencies: true` — bundles server-side dependencies for Pages Router
- `serverExternalPackages: ['handsontable']` — packages excluded from server-side bundling
- `optimizePackageImports` — 11 `@growi/*` packages configured (expansion to third-party packages was tested and reverted — it increased dev module count)

## Module Count Measurement

KPI: `[ChunkModuleStats] initial: N, async-only: N, total: N`

- `initial` = modules in eager (initial) chunks — the primary reduction target
- Measured via `bin/measure-chunk-stats.sh` (cleans `.next`, starts `next dev`, triggers compilation)
- Any changes to webpack config or import patterns should be verified against the `initial` count

## Effective Module Reduction Techniques

Techniques that have proven effective for reducing module count, ordered by typical impact:

| Technique | When to Use |
|-----------|-------------|
| `next/dynamic({ ssr: true })` | Heavy rendering pipelines (markdown, code highlighting) that can be deferred to async chunks while preserving SSR |
| `next/dynamic({ ssr: false })` | Client-only heavy components (e.g., Mermaid diagrams, interactive editors) |
| Subpath imports | Packages with large barrel exports (e.g., `date-fns/format` instead of `date-fns`) |
| Deep ESM imports | Packages that re-export multiple engines via barrel (e.g., `react-syntax-highlighter/dist/esm/prism-async-light`) |
| null-loader | Server-only packages leaking into client bundle via transitive imports |
| Lightweight replacements | Replace large libraries used for a single feature (e.g., `tinykeys` instead of `react-hotkeys`, regex instead of `validator`) |

### Techniques That Did NOT Work

- **Expanding `optimizePackageImports` to third-party packages** — In dev mode, this resolves individual sub-module files instead of barrel, resulting in MORE module entries. Reverted.
- **Refactoring internal barrel exports** — Internal barrels (`states/`, `features/`) are small and well-scoped; refactoring had no measurable impact.

## Turbopack Migration Path (Future)

Turbopack adoption is deferred. Key blockers:

- `webpack()` config not supported — null-loader rules need `turbopack.resolveAlias` migration
- Custom loaders (superjson-ssr-loader) need Turbopack rules testing
- I18NextHMRPlugin has no Turbopack equivalent
- Use `--webpack` flag in both dev and build until migration is complete
