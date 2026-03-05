# Requirements Document

## Introduction

Migrate the GROWI main application (`apps/app`) from webpack to Turbopack for Next.js dev and build pipelines. The primary goal is to dramatically improve dev server compilation speed (HMR / Fast Refresh) while preserving all existing custom functionality.

### Background

GROWI uses a custom Express server with `next({ dev, webpack: true })` to initialize Next.js. As of Next.js 16, the `next()` programmatic API officially supports a `turbopack: true` option (enabled by default), making Turbopack compatible with custom servers. The current webpack opt-out exists solely because custom webpack loaders/plugins in `next.config.ts` require migration to Turbopack equivalents.

### Key Research Findings

1. **Custom server support confirmed**: Next.js 16 `next()` API accepts `turbopack` and `webpack` boolean options. Turbopack is enabled by default — GROWI's `webpack: true` is an explicit opt-out.
2. **Turbopack loader compatibility**: Turbopack supports a subset of webpack loaders via `loader-runner`. Only loaders returning JavaScript are supported. Conditions (`browser`, `{not: 'browser'}`, `development`, etc.) are available for fine-grained rule targeting.
3. **resolveAlias**: Replaces webpack `resolve.fallback` and `null-loader` patterns. Supports conditional aliasing (e.g., `{ browser: './empty.js' }`).
4. **No webpack plugin API**: Turbopack does not support arbitrary webpack plugins. `I18NextHMRPlugin` and `ChunkModuleStatsPlugin` cannot be ported directly.

### Current Webpack Customizations (Migration Scope)

| # | Customization | Type | Turbopack Path |
|---|---|---|---|
| 1 | `superjson-ssr-loader` (server-side, `.page.{ts,tsx}`) | Loader | `turbopack.rules` with `{not: 'browser'}` condition |
| 2 | `resolve.fallback: { fs: false }` (client-side) | Resolve | `turbopack.resolveAlias: { fs: { browser: false } }` |
| 3 | `null-loader` for 7 packages (client-side) | Loader | `turbopack.resolveAlias` with `{ browser: '' }` or empty module |
| 4 | `source-map-loader` (dev, non-node_modules) | Loader | Built-in Turbopack source map support |
| 5 | `I18NextHMRPlugin` (dev, client-side) | Plugin | Drop or replace — Next.js Fast Refresh may cover HMR needs |
| 6 | `ChunkModuleStatsPlugin` (dev, client-side) | Plugin | Drop or build alternative analysis tooling |
| 7 | `transpilePackages` (70+ ESM packages) | Config | Supported natively by Turbopack |
| 8 | `optimizePackageImports` (11 @growi/* packages) | Config | Supported natively by Turbopack |

## Requirements

### Requirement 1: Turbopack Activation for Dev Server

**Objective:** As a developer, I want the Next.js dev server to use Turbopack instead of webpack, so that HMR and page compilation are significantly faster.

#### Acceptance Criteria

1. When the dev server starts, the Next.js build system shall use Turbopack as the bundler (remove `webpack: true` from `next()` call).
2. The Next.js build system shall accept Turbopack configuration via `turbopack` key in `next.config.ts`.
3. While the dev server is running with Turbopack, the Next.js build system shall provide Fast Refresh functionality equivalent to the current webpack-based HMR.
4. When a `.page.tsx` file is modified, the Next.js build system shall apply the change via Fast Refresh within noticeably faster time compared to the current webpack compilation.

### Requirement 2: Server-Only Package Exclusion from Client Bundle

**Objective:** As a developer, I want server-only packages (mongoose, dtrace-provider, bunyan, etc.) excluded from the client bundle, so that the client bundle remains lean and free of Node.js-specific dependencies.

#### Acceptance Criteria

1. The Turbopack configuration shall alias the following packages to empty modules in browser context: `dtrace-provider`, `mongoose`, `mathjax-full`, `i18next-fs-backend`, `bunyan`, `bunyan-format`, `core-js`.
2. The Turbopack configuration shall resolve `fs` to `false` in browser context to prevent "Module not found: Can't resolve 'fs'" errors.
3. When a client-side page is rendered, the Next.js build system shall not include any of the excluded server-only packages in the client JavaScript output.
4. If a new server-only package is accidentally imported from client code, the Next.js build system shall either fail the build or exclude it via the configured aliases.

### Requirement 3: SuperJSON SSR Loader Migration

**Objective:** As a developer, I want the SuperJSON auto-wrapping of `getServerSideProps` to work under Turbopack, so that SSR data serialization continues to function transparently.

#### Acceptance Criteria

1. The Turbopack configuration shall register `superjson-ssr-loader` as a custom loader for `*.page.ts` and `*.page.tsx` files on the server side.
2. When a `.page.tsx` file exports `getServerSideProps`, the build system shall auto-wrap it with `withSuperJSONProps` during compilation.
3. The SuperJSON serialization/deserialization shall produce identical output for all existing pages compared to the current webpack-based build.
4. If the `superjson-ssr-loader` is incompatible with Turbopack's loader-runner subset, the build system shall provide an alternative mechanism (e.g., Babel plugin, SWC plugin, or code generation) that achieves the same transformation.

### Requirement 4: ESM Package Transpilation Compatibility

**Objective:** As a developer, I want all 70+ ESM packages currently listed in `transpilePackages` to work correctly under Turbopack, so that no `ERR_REQUIRE_ESM` errors occur.

#### Acceptance Criteria

1. The Next.js build system shall handle all packages listed in `transpilePackages` without `ERR_REQUIRE_ESM` errors under Turbopack.
2. When a page importing remark/rehype/micromark ecosystem packages is compiled, the Next.js build system shall bundle them correctly.
3. If Turbopack natively resolves ESM packages without explicit `transpilePackages` configuration, the build system shall still produce correct output for all affected packages.

### Requirement 5: i18n HMR Behavior

**Objective:** As a developer, I want translation file changes to be reflected in the dev browser without a full page reload, so that i18n development workflow remains productive.

#### Acceptance Criteria

1. While the dev server is running, when a translation JSON file under `public/static/locales/` is modified, the Next.js build system shall reflect the change in the browser.
2. If the current `I18NextHMRPlugin` is incompatible with Turbopack, the build system shall provide an alternative mechanism for i18n hot reloading or document a manual-reload workflow as an acceptable tradeoff.
3. The i18n integration (`next-i18next` configuration) shall function correctly under Turbopack without runtime errors.

### Requirement 6: Production Build Compatibility

**Objective:** As a developer, I want the production build (`next build`) to continue working correctly, so that deployment is not disrupted by the Turbopack migration.

#### Acceptance Criteria

1. When `pnpm run build:client` is executed, the Next.js build system shall produce a working production bundle.
2. The production build shall either use Turbopack (if stable for production) or fall back to webpack (`next build --webpack`) without configuration conflicts.
3. The production build output shall pass all existing integration and E2E tests.
4. If Turbopack production builds are not yet stable, the build system shall maintain `--webpack` flag for production while using Turbopack for development only.

### Requirement 7: Dev Module Analysis Tooling

**Objective:** As a developer, I want visibility into module counts and chunk composition during dev builds, so that I can continue optimizing bundle size.

#### Acceptance Criteria

1. If `ChunkModuleStatsPlugin` is incompatible with Turbopack, the build system shall provide an alternative mechanism for analyzing initial vs async module counts during dev compilation.
2. When `DUMP_INITIAL_MODULES=1` is set, the analysis tooling shall output module breakdown reports comparable to the current `initial-modules-analysis.md` format.
3. If no Turbopack-compatible analysis tooling is feasible, this requirement may be deferred and documented as a known limitation.

### Requirement 8: Global CSS Import Restriction Compliance

**Objective:** As a developer, I want third-party CSS files to be properly handled for Turbopack, so that no "Global CSS cannot be imported from files other than your Custom `<App>`" errors occur.

#### Background

Turbopack strictly enforces the Pages Router rule that global CSS can only be imported from `_app.page.tsx`. Under webpack, this rule was not enforced — components could freely `import 'package/style.css'`. Turbopack rejects these imports at compile time.

The solution uses a **two-track vendor CSS system**:
- **Commons track** (`vendor.scss` → `src/styles/prebuilt/`): Globally shared vendor CSS (e.g., `simplebar-react`) compiled via `vite.vendor-styles-commons.ts`
- **Components track** (`*.vendor-styles.ts` → `*.vendor-styles.prebuilt.js`): Component-specific vendor CSS precompiled via `vite.vendor-styles-components.ts` using Vite's `?inline` CSS import suffix

#### Acceptance Criteria

1. When a component requires third-party CSS (e.g., `handsontable`, `katex`, `diff2html`), the CSS shall be precompiled into a `.vendor-styles.prebuilt.js` file via Vite and imported as a regular JS module.
2. All existing direct global CSS imports from non-`_app` files shall be migrated to either the commons track (if globally needed) or the components track (if component-specific).
3. The vendor-styles entry point files shall follow the naming convention `{ComponentName}.vendor-styles.ts`, producing `{ComponentName}.vendor-styles.prebuilt.js` output.
4. The prebuilt output files shall be git-ignored and regenerated by Turborepo `pre:styles-components` / `dev:pre:styles-components` tasks before build/dev.
5. Vendor CSS precompilation shall use Vite's `?inline` suffix to inline CSS as a string, injecting it at runtime via `<style>` tag insertion into `document.head`.

### Requirement 9: CSS Modules `:global` Syntax Compatibility

**Objective:** As a developer, I want all CSS Module files to use Turbopack-compatible `:global` syntax, so that no "Ambiguous CSS module class not supported" errors occur.

#### Background

Turbopack's CSS Modules implementation does not support the block form of `:global { ... }` — it only supports the function form `:global(...)`. The GROWI codebase uses the block form extensively (128 files, 255 occurrences). This is a mechanical syntax difference:

| Pattern (webpack) | Equivalent (Turbopack) |
|---|---|
| `.parent :global { .child { } }` | `.parent { :global(.child) { } }` |
| `&:global { &.modifier { } }` | `&:global(.modifier) { }` |
| `:global { .class { } }` (standalone) | `:global(.class) { }` |

#### Acceptance Criteria

1. All `.module.scss` and `.module.css` files shall use the function form `:global(...)` instead of the block form `:global { ... }`.
2. The conversion shall be mechanical and preserve the exact same CSS output (class name scoping behavior unchanged).
3. Nested `:global` blocks (e.g., `.parent :global { .child { .grandchild { } } }`) shall be converted to nested `:global(...)` selectors.
4. When the dev server starts with Turbopack, no "Ambiguous CSS module class" errors shall appear.
5. When the dev server starts with webpack (`USE_WEBPACK=1`), the converted syntax shall produce identical behavior (webpack supports both block and function forms).

### Requirement 10: Incremental Migration Path

**Objective:** As a developer, I want the ability to switch between Turbopack and webpack during the migration period, so that I can fall back to webpack if Turbopack issues are discovered.

#### Acceptance Criteria

1. The Next.js build system shall support switching between Turbopack and webpack via an environment variable or CLI flag (e.g., `--webpack`).
2. When webpack mode is selected, all existing webpack customizations shall remain functional without modification.
3. The `next.config.ts` shall maintain both `webpack()` hook and `turbopack` configuration simultaneously during the migration period.
4. When the migration is complete and verified, the build system shall remove the webpack fallback configuration in a follow-up cleanup (Phase 3).
5. The converted CSS Modules syntax (function form `:global(...)`) shall work identically under both Turbopack and webpack modes.

