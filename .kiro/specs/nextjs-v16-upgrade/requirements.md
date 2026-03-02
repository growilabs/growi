# Requirements Document

## Introduction

Upgrade the GROWI main application (`apps/app`) from Next.js 15.5.12 to Next.js 16. Next.js 16 makes Turbopack the default bundler and introduces several breaking changes. GROWI has extensive custom webpack configuration (null-loader rules, superjson-ssr-loader, ChunkModuleStatsPlugin, I18NextHMRPlugin) established during the `reduce-modules-loaded` feature. The upgrade must preserve all existing optimizations while adapting to v16 changes.

**Current State**:
- Next.js: ^15.0.0 (installed 15.5.12)
- React: ^18.2.0
- Node.js: ^24
- TypeScript: ~5.0.0
- Custom webpack config: 5 loaders/plugins, 7 null-loader rules, superjson-ssr-loader, ChunkModuleStatsPlugin

**Key v16 Changes Impacting GROWI**:
- Turbopack is the default bundler — `next build` fails if custom `webpack()` config exists unless `--webpack` flag is used
- `middleware` filename deprecated → renamed to `proxy`
- `next lint` command removed (GROWI uses Biome — no impact)
- Dev output directory changed to `.next/dev`
- Sass tilde (`~`) imports not supported by Turbopack
- AMP support removed (GROWI doesn't use — no impact)
- `serverRuntimeConfig`/`publicRuntimeConfig` removed (GROWI doesn't use — no impact)

## Requirements

### Requirement 1: Next.js Version Upgrade

**Objective:** As a developer, I want to upgrade Next.js from v15 to v16, so that the application benefits from improved performance, Turbopack stability, and continued framework support.

#### Acceptance Criteria
1. The build system shall upgrade the `next` dependency from `^15.0.0` to `^16.0.0` in `apps/app/package.json`.
2. When `next build` is executed, the build system shall use the `--webpack` flag to opt out of Turbopack as the default bundler, preserving all existing custom webpack configuration.
3. When `next dev` is executed, the build system shall continue to use webpack for development, maintaining compatibility with all custom loaders and plugins.
4. The build system shall verify that `@types/react` and `@types/react-dom` are compatible with the upgraded Next.js version.
5. When the upgrade is complete, the build system shall pass all existing quality checks: `lint:typecheck`, `lint:biome`, `test`, and `build`.

### Requirement 2: Webpack Configuration Preservation

**Objective:** As a developer, I want all custom webpack configurations from the `reduce-modules-loaded` feature to remain functional after the upgrade, so that the module reduction achievements (67% initial chunk reduction) are not lost.

#### Acceptance Criteria
1. The build system shall preserve all 7 null-loader rules (dtrace-provider, mongoose, mathjax-full, i18next-fs-backend, bunyan, bunyan-format, core-js) after the upgrade.
2. The build system shall preserve the custom superjson-ssr-loader for automatic `getServerSideProps` wrapping on `.page.(tsx|ts)` files.
3. The build system shall preserve the I18NextHMRPlugin for i18next hot module replacement in development mode.
4. The build system shall preserve the ChunkModuleStatsPlugin for development-time module analysis.
5. The build system shall preserve the source-map-loader configuration for development builds.
6. When `next dev` is started after the upgrade, the ChunkModuleStatsPlugin shall report initial module counts within ±5% of pre-upgrade baseline (approximately 895 initial modules).

### Requirement 3: Build Script Updates

**Objective:** As a developer, I want the build scripts to be updated for v16 compatibility, so that the build pipeline works correctly with the new default Turbopack behavior.

#### Acceptance Criteria
1. The build system shall update the `build:client` script in `apps/app/package.json` to include the `--webpack` flag (e.g., `next build --webpack`).
2. If `next dev` defaults to Turbopack in v16, the build system shall add the `--webpack` flag to the dev script to maintain webpack compatibility.
3. The build system shall update `bin/measure-chunk-stats.sh` to account for the new `.next/dev` output directory if the dev output path changes.
4. The root-level build commands (`pnpm run app:build`, `turbo run build`) shall continue to function correctly after the upgrade.

### Requirement 4: Sass Tilde Import Migration

**Objective:** As a developer, I want Sass tilde (`~`) imports to be removed, so that the codebase is compatible with Turbopack's import resolution (enabling a future Turbopack migration path).

#### Acceptance Criteria
1. When Sass files are processed, the build system shall resolve node_modules imports without the tilde (`~`) prefix.
2. The build system shall replace `@import '~react-toastify/scss/main'` with `@import 'react-toastify/scss/main'` in `src/styles/molecules/toastr.scss`.
3. The build system shall verify no other Sass files contain tilde-prefixed imports.
4. When the styles are compiled, the application shall render identically to the pre-upgrade state.

### Requirement 5: Next.js Configuration Compatibility

**Objective:** As a developer, I want the `next.config.ts` to be compatible with v16 configuration changes, so that all settings are recognized and properly applied.

#### Acceptance Criteria
1. The build system shall verify that `bundlePagesRouterDependencies` and `serverExternalPackages` continue to function correctly in v16.
2. The build system shall verify that `optimizePackageImports` settings remain effective in v16.
3. The build system shall verify that `transpilePackages` configuration (ESM packages: remark-*, rehype-*, unified, etc.) works correctly in v16.
4. If v16 introduces new configuration options relevant to Pages Router optimization, the build system shall evaluate and document them.
5. If any existing `next.config.ts` options are deprecated or renamed in v16, the build system shall update them to v16 equivalents.

### Requirement 6: ts-node Hook Preservation

**Objective:** As a developer, I want the ts-node require hook workaround to remain functional, so that the Express server's TypeScript module loading is not disrupted by Next.js initialization.

#### Acceptance Criteria
1. While the GROWI server initializes Next.js, the server startup process shall preserve the ts-node `.ts` extension hook as implemented in `src/server/crowi/index.ts`.
2. If Next.js v16 changes its config transpiler behavior for `.ts` hooks, the build system shall update the preservation logic accordingly.
3. When the server starts in development mode, TypeScript files shall be loaded via ts-node without errors after Next.js initialization.

### Requirement 7: Regression Testing and Validation

**Objective:** As a developer, I want comprehensive regression testing after the upgrade, so that no existing functionality is broken.

#### Acceptance Criteria
1. When the upgrade is complete, all existing unit tests shall pass (currently 1,375+ tests across 127+ test files).
2. When the upgrade is complete, TypeScript type checking shall produce zero errors.
3. When the upgrade is complete, Biome linting shall produce zero errors.
4. When the upgrade is complete, the production build shall succeed.
5. The build system shall verify that the superjson serialization round-trip works correctly for all page types (Date, Map, Set objects).
6. When `next dev` is started, the `[[...path]]` catch-all page shall compile and serve correctly.
7. The build system shall document before/after metrics: module counts (initial, async-only, total) and compilation time.
