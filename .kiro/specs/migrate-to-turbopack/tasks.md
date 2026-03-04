# Implementation Plan

## Phase 1: Dev Server Turbopack Migration

- [ ] 1. Create empty module and Turbopack configuration foundation
- [ ] 1.1 (P) Create the empty module file used as the alias target for excluded server-only packages
  - Create a minimal TypeScript module at the designated location that exports an empty default and named export
  - The module satisfies any import style (default, named, namespace) so that aliased packages resolve without errors
  - _Requirements: 2.1, 2.2_

- [ ] 1.2 (P) Add the Turbopack configuration block to the Next.js config with resolve aliases for server-only package exclusion
  - Add a `turbopack` key to the Next.js config object containing `resolveAlias` entries
  - Alias `fs` to the empty module in browser context to prevent "Module not found" errors on the client
  - Alias all 7 server-only packages (`dtrace-provider`, `mongoose`, `mathjax-full`, `i18next-fs-backend`, `bunyan`, `bunyan-format`, `core-js`) to the empty module in browser context
  - Use the conditional `{ browser: '...' }` syntax for each alias so that server-side resolution remains unaffected
  - Verify that the `bunyan` alias does not interfere with `browser-bunyan` (different package name, no collision expected)
  - Keep the existing `webpack()` hook untouched — both configs coexist
  - _Requirements: 1.2, 2.1, 2.2, 2.3, 8.3_

- [ ] 1.3 Add the superjson-ssr-loader as a Turbopack custom loader rule for server-side page files
  - Register the existing `superjson-ssr-loader` under `turbopack.rules` for `*.page.ts` and `*.page.tsx` file patterns
  - Apply the `condition: { not: 'browser' }` condition so the loader runs only on the server side
  - Set the `as` output type to `*.ts` / `*.tsx` respectively so Turbopack continues processing the transformed output
  - The loader performs a simple regex-based source transform and returns JavaScript — no unsupported loader-runner APIs are used
  - _Requirements: 1.2, 3.1, 3.2, 3.3, 3.4_

- [ ] 2. Update server initialization to toggle between Turbopack and webpack
- [ ] 2.1 Replace the hardcoded `webpack: true` in the custom server with environment-variable-based bundler selection
  - Read the `USE_WEBPACK` environment variable at server startup
  - When `USE_WEBPACK` is set (truthy), pass `{ dev, webpack: true }` to preserve the existing webpack pipeline
  - When `USE_WEBPACK` is not set (default), omit the `webpack` option so Turbopack activates as the Next.js 16 default
  - Preserve the existing ts-node hook save/restore logic surrounding `app.prepare()`
  - _Requirements: 1.1, 1.3, 1.4, 8.1_

- [ ] 3. Guard i18n HMR plugin loading for Turbopack compatibility
- [ ] 3.1 Conditionally skip the i18next-hmr plugin in the i18n configuration when Turbopack is active
  - In the next-i18next configuration file, check the `USE_WEBPACK` environment variable before loading the `HMRPlugin`
  - When `USE_WEBPACK` is not set (Turbopack mode), exclude `HMRPlugin` from the `use` array to prevent webpack-internal references from crashing
  - When `USE_WEBPACK` is set (webpack mode), preserve the existing `HMRPlugin` behavior for both server and client
  - The `I18NextHMRPlugin` in the webpack hook of next.config.ts requires no change — it only executes when webpack is active
  - Translation file changes under Turbopack require a manual browser refresh (documented tradeoff)
  - _Requirements: 5.1, 5.2, 5.3_

- [ ] 4. Smoke test the Turbopack dev server and webpack fallback
- [ ] 4.1 Verify the dev server starts and pages load correctly under Turbopack
  - Start the dev server without `USE_WEBPACK` and confirm it initializes with Turbopack
  - Navigate to representative pages and verify they render without errors
  - Confirm no "Module not found" or "Cannot resolve" errors appear in the terminal or browser console
  - Visit a page that uses `getServerSideProps` and verify SuperJSON-serialized data renders correctly
  - Visit a page that imports remark/rehype/micromark ecosystem packages and verify Markdown rendering works
  - Switch the browser locale and verify i18n translations load correctly
  - Edit a `.page.tsx` file and verify Fast Refresh applies the change
  - _Requirements: 1.1, 1.3, 1.4, 2.3, 3.2, 3.3, 4.1, 4.2, 5.3_

- [ ] 4.2 Verify the webpack fallback mode works identically to the pre-migration state
  - Start the dev server with `USE_WEBPACK=1` and confirm webpack initializes
  - Repeat the same page navigation checks to ensure no regression
  - Confirm the `I18NextHMRPlugin` and `HMRPlugin` are active in webpack mode
  - Confirm the `ChunkModuleStatsPlugin` logs module stats in webpack mode
  - _Requirements: 8.1, 8.2, 8.3_

- [ ] 4.3 Run existing automated tests and lint checks
  - Run the vitest test suite to confirm no test regressions
  - Run lint checks (typecheck, biome, stylelint) to confirm no new errors
  - Run the production build with `--webpack` to confirm it still works
  - _Requirements: 6.1, 6.2, 6.3_

## Phase 2: Production Build Migration (Deferred)

- [ ] 5. Migrate production build from webpack to Turbopack
- [ ] 5.1 Remove the `--webpack` flag from the production client build script
  - Update the `build:client` script to use `next build` without the `--webpack` flag
  - Run the full production build and verify it completes without errors
  - Run the vitest test suite against the Turbopack-built output
  - _Requirements: 6.1, 6.2, 6.3_

## Phase 3: Cleanup (Deferred)

- [ ] 6. Remove webpack fallback configuration and deprecated plugins
- [ ] 6.1 Remove the `webpack()` hook, `USE_WEBPACK` env var check, and deprecated plugin code
  - Remove the entire `webpack()` hook function from the Next.js config
  - Remove the `USE_WEBPACK` conditional in the custom server and use the Turbopack default unconditionally
  - Remove `I18NextHMRPlugin` import and usage from the Next.js config
  - Remove `HMRPlugin` import and conditional loading from the next-i18next config
  - Remove `ChunkModuleStatsPlugin` and its helper code from the config utilities module
  - Evaluate whether any `transpilePackages` entries can be removed under Turbopack
  - _Requirements: 8.4_

## Deferred Requirements

- **Requirement 7 (Dev Module Analysis Tooling)**: Requirements 7.1, 7.2 are intentionally deferred. Turbopack has no plugin API for compilation hooks, and no equivalent analysis tooling exists. When detailed module analysis is needed, developers can temporarily use `USE_WEBPACK=1` during the transition period. A Turbopack-native solution may emerge as the ecosystem matures.
