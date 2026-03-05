# Implementation Plan

## Phase 1: Dev Server Turbopack Migration

- [x] 1. Create empty module and Turbopack configuration foundation
- [x] 1.1 (P) Create the empty module file used as the alias target for excluded server-only packages
  - Create a minimal TypeScript module at the designated location that exports an empty default and named export
  - The module satisfies any import style (default, named, namespace) so that aliased packages resolve without errors
  - _Requirements: 2.1, 2.2_

- [x] 1.2 (P) Add the Turbopack configuration block to the Next.js config with resolve aliases for server-only package exclusion
  - Add a `turbopack` key to the Next.js config object containing `resolveAlias` entries
  - Alias `fs` to the empty module in browser context to prevent "Module not found" errors on the client
  - Alias all 7 server-only packages (`dtrace-provider`, `mongoose`, `mathjax-full`, `i18next-fs-backend`, `bunyan`, `bunyan-format`, `core-js`) to the empty module in browser context
  - Use the conditional `{ browser: '...' }` syntax for each alias so that server-side resolution remains unaffected
  - Verify that the `bunyan` alias does not interfere with `browser-bunyan` (different package name, no collision expected)
  - Keep the existing `webpack()` hook untouched — both configs coexist
  - _Requirements: 1.2, 2.1, 2.2, 2.3, 8.3_

- [x] 1.3 Add the superjson-ssr-loader as a Turbopack custom loader rule for server-side page files
  - Register the existing `superjson-ssr-loader` under `turbopack.rules` for `*.page.ts` and `*.page.tsx` file patterns
  - Apply the `condition: { not: 'browser' }` condition so the loader runs only on the server side
  - Set the `as` output type to `*.ts` / `*.tsx` respectively so Turbopack continues processing the transformed output
  - The loader performs a simple regex-based source transform and returns JavaScript — no unsupported loader-runner APIs are used
  - _Requirements: 1.2, 3.1, 3.2, 3.3, 3.4_

- [x] 2. Update server initialization to toggle between Turbopack and webpack
- [x] 2.1 Replace the hardcoded `webpack: true` in the custom server with environment-variable-based bundler selection
  - Read the `USE_WEBPACK` environment variable at server startup
  - When `USE_WEBPACK` is set (truthy), pass `{ dev, webpack: true }` to preserve the existing webpack pipeline
  - When `USE_WEBPACK` is not set (default), omit the `webpack` option so Turbopack activates as the Next.js 16 default
  - Preserve the existing ts-node hook save/restore logic surrounding `app.prepare()`
  - _Requirements: 1.1, 1.3, 1.4, 8.1_

- [x] 3. Guard i18n HMR plugin loading for Turbopack compatibility
- [x] 3.1 Conditionally skip the i18next-hmr plugin in the i18n configuration when Turbopack is active
  - In the next-i18next configuration file, check the `USE_WEBPACK` environment variable before loading the `HMRPlugin`
  - When `USE_WEBPACK` is not set (Turbopack mode), exclude `HMRPlugin` from the `use` array to prevent webpack-internal references from crashing
  - When `USE_WEBPACK` is set (webpack mode), preserve the existing `HMRPlugin` behavior for both server and client
  - The `I18NextHMRPlugin` in the webpack hook of next.config.ts requires no change — it only executes when webpack is active
  - Translation file changes under Turbopack require a manual browser refresh (documented tradeoff)
  - _Requirements: 5.1, 5.2, 5.3_

- [x] 4. Precompile vendor CSS via Vite for Turbopack compatibility
- [x] 4.1 Create Vite config and Turborepo tasks for vendor CSS precompilation
  - Created `vite.vendor-styles-components.ts` — collects all `src/**/*.vendor-styles.ts` as entry points, precompiles via Vite `?inline` suffix
  - Includes `moveAssetsToPublic` plugin: moves Vite-emitted font files from `src/assets/` to `public/static/fonts/` and rewrites URL references in prebuilt JS (`/assets/` → `/static/fonts/`)
  - Fonts served at `/static/fonts/*` via existing `express.static(crowi.publicDir)` — no additional Express route needed
  - Added `pre:styles-components` / `dev:pre:styles-components` tasks to `turbo.json` as dependencies of `build` and `dev`
  - Added corresponding npm scripts to `package.json`
  - Added `/src/**/*.vendor-styles.prebuilt.js` and `/public/static/fonts` to `.gitignore`
  - _Requirements: 8.3, 8.4, 8.5_

- [x] 4.2 Create vendor-styles entry points and migrate CSS imports from components
  - Created 8 `*.vendor-styles.ts` entry point files covering 13 vendor CSS imports from 12 component files
  - Each entry point uses `?inline` CSS import and injects into `document.head` via `<style>` tag
  - Replaced direct CSS imports in components with `.vendor-styles.prebuilt` JS imports
  - Switched `handsontable/dist/handsontable.full.min.css` to `handsontable/dist/handsontable.css` (non-full, non-minified) to avoid IE CSS hack parse errors in Turbopack
  - `simplebar-react` CSS handled by commons track (`vendor.scss`) — direct import simply removed from `Sidebar.tsx`
  - `katex` CSS added to `Renderer.vendor-styles.ts` (used by `rehype-katex` in the renderer)
  - _Requirements: 8.1, 8.2, 8.3_

- [x] 5. Convert `:global` block form to function form in CSS Modules
- [x] 5.1 (P) Convert all `:global` block form syntax to function form across all `.module.scss` files
  - Scan all `.module.scss` files for `:global {` block form usage (128 files, 255 occurrences)
  - Convert each occurrence to the function form `:global(...)` following the 6 conversion patterns documented in design.md
  - Preserve nested selector structure and any `&` parent selectors
  - Exclude `vendor-*.module.scss` files (these use `:global { @import }` which is a different pattern)
  - _Requirements: 9.1, 9.2, 9.3_

- [x] 5.2 Verify CSS output equivalence after conversion
  - Run stylelint across all converted files
  - Run the existing vitest test suite to confirm no regressions
  - Start dev server with Turbopack and verify no "Ambiguous CSS module class" errors
  - Start dev server with `USE_WEBPACK=1` and verify identical behavior
  - _Requirements: 9.4, 9.5_

- [x] 6. Smoke test the Turbopack dev server and webpack fallback
- [x] 6.1 Verify the dev server starts and pages load correctly under Turbopack
  - Dev server starts and root page compiles + renders (HTTP 200) with no CSS errors
  - Turbopack production build (`next build`) compiles all routes successfully with 0 errors
  - Fixed `MessageCard.module.scss` — removed standalone `&:local` (Turbopack doesn't support it)
  - Fixed `DefaultContentSkelton.module.scss` — replaced `@extend .grw-skeleton-text` with shared selector group
  - Fixed `handsontable` CSS — switched to non-full, non-minified variant to avoid IE CSS hack parse errors
  - _Requirements: 1.1, 1.3, 1.4, 2.3, 3.2, 3.3, 4.1, 4.2, 5.3, 9.4_

- [ ] 6.2 Verify the webpack fallback mode works identically to the pre-migration state
  - Start the dev server with `USE_WEBPACK=1` and confirm webpack initializes
  - Repeat the same page navigation checks to ensure no regression
  - Confirm the `I18NextHMRPlugin` and `HMRPlugin` are active in webpack mode
  - Confirm the `ChunkModuleStatsPlugin` logs module stats in webpack mode
  - _Requirements: 9.5, 10.1, 10.2, 10.3_

- [x] 6.3 Run existing automated tests and lint checks
  - Run the vitest test suite to confirm no test regressions
  - Run lint checks (typecheck, biome, stylelint) to confirm no new errors
  - Run the production build with `--webpack` to confirm it still works
  - _Requirements: 6.1, 6.2, 6.3_

## Phase 2: Production Build Migration (Deferred)

- [x] 7. Migrate production build from webpack to Turbopack
- [x] 7.1 Remove the `--webpack` flag from the production client build script
  - Updated `build:client` script from `next build --webpack` to `next build` (Turbopack default)
  - Production build completes successfully with all routes compiled
  - _Requirements: 6.1, 6.2, 6.3_

## Phase 3: Cleanup (Deferred)

- [ ] 8. Remove webpack fallback configuration and deprecated plugins
- [ ] 8.1 Remove the `webpack()` hook, `USE_WEBPACK` env var check, and deprecated plugin code
  - Remove the entire `webpack()` hook function from the Next.js config
  - Remove the `USE_WEBPACK` conditional in the custom server and use the Turbopack default unconditionally
  - Remove `I18NextHMRPlugin` import and usage from the Next.js config
  - Remove `HMRPlugin` import and conditional loading from the next-i18next config
  - Remove `ChunkModuleStatsPlugin` and its helper code from the config utilities module
  - Evaluate whether any `transpilePackages` entries can be removed under Turbopack
  - _Requirements: 10.1, 10.2, 10.3, 10.4_

## Deferred Requirements

- **Requirement 7 (Dev Module Analysis Tooling)**: Requirements 7.1, 7.2 are intentionally deferred. Turbopack has no plugin API for compilation hooks, and no equivalent analysis tooling exists. When detailed module analysis is needed, developers can temporarily use `USE_WEBPACK=1` during the transition period. A Turbopack-native solution may emerge as the ecosystem matures.

## Implementation Notes (Discovered During Phase 1)

- **resolveAlias paths**: Turbopack `resolveAlias` requires **relative paths** (e.g., `./src/lib/empty-module.ts`), not absolute paths from `path.resolve()`. Absolute paths cause "server relative imports are not implemented yet" errors.
- **Vendor CSS precompiled via Vite**: The `vendor-*.module.scss` wrapper approach (`:global { @import }`) failed because Turbopack rejects `:global` block form entirely. The `_app.page.tsx` centralization approach was also rejected due to FCP degradation. Final solution: Vite precompilation with `?inline` suffix — 8 `*.vendor-styles.ts` entry points covering 13 vendor CSS imports, precompiled into `.vendor-styles.prebuilt.js` files by Turborepo `pre:styles-components` task.
- **`:global` block form**: Turbopack's CSS Modules implementation only supports the function form `:global(...)`. The block form `:global { }` (supported by webpack) causes "Ambiguous CSS module class not supported" errors. Conversion is mechanical — 128 files, 255 occurrences.
- **Standalone `:local`**: Turbopack doesn't support standalone `:local` or `&:local` in CSS Modules. Inside `:global(...)` function form, properties are already locally scoped by default, so `&:local` wrappers can simply be removed.
- **Sass `@extend` in CSS Modules**: `@extend .class` fails when the target is wrapped in `:global(.class)` — Sass doesn't match them as the same selector. Replace with shared selector groups (comma-separated selectors).
- **handsontable CSS**: `handsontable.full.min.css` contains IE CSS star hacks (`*zoom:1`, `*display:inline`) and `filter:alpha()` that Turbopack's CSS parser (lightningcss) cannot parse. Use `handsontable/dist/handsontable.css` (non-full, non-minified) instead — the "full" variant includes Pikaday which is unused.
- **Vendor CSS font handling**: When Vite precompiles CSS that references external assets (e.g., KaTeX `@font-face` with `url(fonts/KaTeX_*.woff2)`), it emits asset files to `src/assets/` and rewrites URLs to `/assets/...`. Since `src/assets/` is not served by Express, a `moveAssetsToPublic` Vite plugin was added to relocate fonts to `public/static/fonts/` and rewrite URL references to `/static/fonts/...` in prebuilt JS. This aligns with the existing `public/static/` convention (`/public/static/js`, `/public/static/styles`).
