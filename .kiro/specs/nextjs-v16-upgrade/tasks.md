# Implementation Plan

## Tasks

- [ ] 1. Record pre-upgrade baseline metrics
- [ ] 1.1 Capture current module counts and compilation time using the measurement shell script
  - Run the existing measurement tool against the current Next.js 15 build
  - Record initial, async-only, and total module counts as the pre-upgrade baseline
  - Save the `Compiled /[[...path]]` compilation time
  - Document baseline values in the analysis ledger or commit message for later comparison
  - _Requirements: 2.6, 7.7_

- [ ] 2. Upgrade Next.js and related dependencies to v16
- [ ] 2.1 Bump the `next` package from v15 to v16 in the main application
  - Update the `next` dependency version specifier in `apps/app/package.json`
  - Update the `@next/bundle-analyzer` dependency to match the new Next.js major version
  - Verify that `@types/react` and `@types/react-dom` remain compatible with React 18 under v16 peer dependencies
  - Run `pnpm install` to resolve the dependency tree and update the lockfile
  - _Requirements: 1.1, 1.4_

- [ ] 2.2 Add the `--webpack` flag to the client build script
  - Update the `build:client` script to pass `--webpack` so the production build continues using webpack instead of the v16 Turbopack default
  - Verify the build completes successfully with the flag by running the build command
  - _Requirements: 1.2, 3.1_

- [ ] 2.3 Ensure the development server continues using webpack
  - Investigate whether the programmatic `next({ dev })` API defaults to Turbopack in v16 or respects the presence of a `webpack()` function in the config
  - If Turbopack is used by default even programmatically, add a configuration option or environment variable to force webpack mode
  - Verify the dev server starts correctly and all custom webpack loaders and plugins are active
  - _Requirements: 1.3, 3.2_

- [ ] 3. (P) Fix Sass tilde import for node_modules
  - Remove the tilde (`~`) prefix from the react-toastify import in `src/styles/molecules/toastr.scss`
  - Confirm that no other Sass files use the tilde prefix for node_modules resolution (the `~/` path alias pattern is unaffected)
  - Verify the styles compile correctly after the change
  - _Requirements: 4.1, 4.2, 4.3, 4.4_

- [ ] 4. Update the measurement shell script for v16 changes
  - Update the cache cleanup command to clear the new `.next/dev` directory used by v16's isolated dev build feature
  - Add the `--webpack` flag to the `next dev` command within the script
  - Verify the script still captures ChunkModuleStats output correctly after the directory change
  - _Requirements: 3.3_

- [ ] 5. Verify Next.js configuration compatibility with v16
- [ ] 5.1 (P) Confirm existing configuration options work in v16
  - Verify `bundlePagesRouterDependencies` and `serverExternalPackages` are recognized and functional
  - Verify `optimizePackageImports` continues to apply to the configured packages
  - Verify `transpilePackages` correctly handles all ESM packages (remark-*, rehype-*, unified, etc.)
  - Check if any existing options have been deprecated or renamed in v16 and update accordingly
  - _Requirements: 5.1, 5.2, 5.3, 5.5_

- [ ] 5.2 (P) Evaluate new v16 configuration options relevant to Pages Router
  - Review the v16 release notes and configuration reference for any new options that benefit Pages Router applications
  - Document findings and apply any beneficial options
  - _Requirements: 5.4_

- [ ] 5.3 Verify the ts-node hook preservation works with v16
  - Start the development server and confirm the ts-node `.ts` extension hook is saved and restored correctly after Next.js initialization
  - If v16 changes the config transpiler behavior, update the hook preservation logic in the server startup code
  - Update the comment referencing "Next.js 15" to reflect v16 if the behavior changes
  - _Requirements: 6.1, 6.2, 6.3_

- [ ] 6. Run full regression testing and validate the upgrade
- [ ] 6.1 Run the quality check suite
  - Execute TypeScript type checking and confirm zero errors
  - Execute Biome linting and confirm zero errors
  - Run the full unit test suite and confirm all tests pass
  - Run the production build and confirm it succeeds
  - Verify root-level build commands (`pnpm run app:build`, `turbo run build`) work correctly
  - _Requirements: 1.5, 3.4, 7.1, 7.2, 7.3, 7.4_

- [ ] 6.2 Verify SuperJSON serialization and page compilation
  - Run the existing SuperJSON round-trip tests to confirm Date, Map, and Set objects serialize correctly
  - Start the dev server and compile the `[[...path]]` catch-all page to verify it works end-to-end
  - Confirm all 7 null-loader rules, superjson-ssr-loader, I18NextHMRPlugin, ChunkModuleStatsPlugin, and source-map-loader are active
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 7.5, 7.6_

- [ ] 6.3 Measure post-upgrade module counts and document results
  - Run the updated measurement shell script to capture post-upgrade module counts
  - Compare initial, async-only, and total module counts with the pre-upgrade baseline
  - Verify initial modules are within ±5% of 895 (target range: 850–940)
  - Document the before/after comparison in the analysis ledger or commit message
  - _Requirements: 2.6, 7.7_
