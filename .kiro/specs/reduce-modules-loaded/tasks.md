# Implementation Plan

## Progress Tracking Convention

Analysis tasks (1.2, 3.1, 3.2, 4.1, 5.1, 5.2) may discover a large number of target files. To enable **resumability** and **progress tracking** across interrupted sessions, use the following approach:

### Analysis Ledger File

Create `.kiro/specs/reduce-modules-loaded/analysis-ledger.md` during task 1.2 and maintain it throughout Phase 1. This file serves as the single source of truth for discovered targets and their fix status.

**Structure**:
```markdown
# Analysis Ledger

## Measurements
| Step | Task | Modules | Time | Date |
|------|------|---------|------|------|
| Baseline | 1.1 | 10,066 | 51.5s | YYYY-MM-DD |
| After optimizePackageImports | 2.2 | N | Xs | YYYY-MM-DD |
| ... | ... | ... | ... | ... |

## Import Violations (Task 3)
| # | File | Violation | Fix Strategy | Status |
|---|------|-----------|--------------|--------|
| 1 | src/client/.../ActivityListItem.tsx | imports ~/server/util/locale-utils | Extract getLocale to client util | pending |
| 2 | src/client/.../PageBulkExportJobModelNotification.tsx | imports serializer with mongoose | Split parseSnapshot to client module | pending |
| ... | | | | |

## Server Packages in Client Bundle (Task 4)
| # | Package | Confirmed in Client Bundle | null-loader Added | Status |
|---|---------|---------------------------|-------------------|--------|
| 1 | mongoose | Yes (existing rule) | Yes | done |
| 2 | @elastic/elasticsearch | TBD | No | pending |
| ... | | | | |

## Barrel Exports to Refactor (Task 5)
| # | File | Issue | Still Impactful After optimizePackageImports? | Status |
|---|------|-------|-----------------------------------------------|--------|
| 1 | src/utils/axios/index.ts | export * from 'axios' | N/A (always fix) | pending |
| 2 | src/states/ui/editor/index.ts | 7 wildcard exports | TBD | pending |
| ... | | | | |
```

**Rules**:
- **Create** the ledger during task 1.2 with initial findings
- **Append** new discoveries as each analysis task runs (tasks 3, 4, 5)
- **Update Status** to `done` as each individual fix is applied
- **Read** the ledger at the start of every task to understand current state
- When resuming after an interruption, the ledger tells you exactly where to pick up

## Phase 1: v14 Optimizations

- [ ] 1. Establish baseline dev compilation measurement
- [ ] 1.1 Record baseline module count and compilation time
  - Clean the `.next` directory and start the dev server for `apps/app`
  - Access the `[[...path]]` page route in the browser and capture the compilation log output showing module count and time
  - Repeat the measurement 3 times (cleaning `.next` each time) and record the median values as the official baseline
  - _Requirements: 2.1, 6.1_

- [ ] 1.2 (P) Run supplementary bundle analysis and create analysis ledger
  - Execute a production build with the bundle analyzer enabled to generate a visual treemap of the client and server bundles
  - Identify the top module contributors by count in the `[[...path]]` page's client bundle
  - Check whether server-only packages (mongoose, elasticsearch, passport, AWS SDK, etc.) appear in the client bundle treemap
  - **Create `.kiro/specs/reduce-modules-loaded/analysis-ledger.md`** with the initial findings:
    - Populate the Measurements table with the baseline from task 1.1
    - Populate Import Violations with all discovered client→server import paths (use grep for `from '~/server/'` in `src/client/`, `src/components/`, `src/stores/`, `src/states/`)
    - Populate Server Packages with confirmed/unconfirmed status for each candidate
    - Populate Barrel Exports with all `export *` patterns found in high-traffic directories
  - _Requirements: 1.4, 2.1, 2.2, 2.3_

- [ ] 2. Expand `optimizePackageImports` configuration
- [ ] 2.1 Identify barrel-heavy packages to add
  - Review the bundle analysis findings and the transpilePackages list to identify third-party packages with barrel exports not already in the Next.js auto-optimized list
  - Cross-reference with the list of auto-optimized packages documented in the design to avoid redundant entries
  - Verify that candidate packages use barrel file patterns (re-export from index) that `optimizePackageImports` can optimize
  - _Requirements: 1.1, 1.2, 1.3_

- [ ] 2.2 Add candidate packages to the config and measure impact
  - Add the identified packages to the `optimizePackageImports` array in `next.config.js`, preserving existing `@growi/*` entries
  - Measure the dev compilation module count and time after the change, following the baseline measurement protocol
  - **Update the Measurements table** in the analysis ledger with the post-optimization module count
  - _Requirements: 4.3, 4.4, 6.1_

- [ ] 3. Fix client-to-server import violations
- [ ] 3.1 Scan for all import violations and update the ledger
  - Search the entire `src/client/`, `src/components/`, `src/stores/`, and `src/states/` directories for imports from `~/server/`, `~/models/serializers/` (with server deps), or other server-only paths
  - **Append** any newly discovered violations to the Import Violations table in the analysis ledger (the initial scan in 1.2 may not catch everything)
  - For each violation, document the file path, the imported server module, and the proposed fix strategy
  - _Requirements: 3.1, 3.3_

- [ ] 3.2 (P) Fix all identified import violations
  - Work through the Import Violations table in the analysis ledger, fixing each entry:
    - Extract client-safe functions to client-accessible utility modules (e.g., `getLocale`)
    - Split serializer files that mix server-only and client-safe functions (e.g., `parseSnapshot` vs `stringifySnapshot`)
    - Update consumer import paths to use the new locations
  - **Mark each entry as `done`** in the ledger as it is fixed
  - Run type checking after each batch of fixes to catch broken imports early
  - If interrupted, the ledger shows exactly which violations remain `pending`
  - _Requirements: 3.1, 3.2, 3.3_

- [ ] 3.3 Measure impact of import violation fixes
  - Measure the dev compilation module count after fixing the import violations
  - **Update the Measurements table** in the analysis ledger
  - _Requirements: 6.1_

- [ ] 4. Expand null-loader rules for server-only packages in client bundle
- [ ] 4.1 Confirm which server packages appear in the client bundle
  - Using the bundle analysis findings from task 1.2 and the Server Packages table in the analysis ledger, confirm each candidate package's presence in the client bundle
  - **Update the `Confirmed in Client Bundle` column** for each entry (Yes/No)
  - Only packages confirmed as `Yes` will receive null-loader rules
  - _Requirements: 3.1, 3.2_

- [ ] 4.2 Add null-loader rules and measure impact
  - Add null-loader rules for all confirmed server-only packages to the webpack configuration in `next.config.js`, preserving existing rules
  - **Mark each entry as `done`** in the ledger's `null-loader Added` column
  - Measure the dev compilation module count after the change
  - Manually verify no client-side runtime errors are introduced by the new exclusions
  - **Update the Measurements table** in the analysis ledger
  - _Requirements: 3.1, 3.2, 6.1_

- [ ] 5. Refactor high-impact barrel exports
- [ ] 5.1 Fix the axios barrel re-export
  - Replace the `export * from 'axios'` pattern in the axios utility barrel with specific named exports that consumers actually use
  - Update all consumer import paths if necessary
  - This should be fixed regardless of `optimizePackageImports` results, as `export * from` a third-party library is universally problematic
  - Run type checking to confirm no broken imports
  - **Mark the axios entry as `done`** in the ledger
  - _Requirements: 4.1, 4.2_

- [ ] 5.2 Evaluate and refactor remaining barrel exports
  - After applying `optimizePackageImports` expansion (task 2), check whether the state and feature barrel exports listed in the ledger are still contributing excessive modules
  - **Update the `Still Impactful?` column** in the Barrel Exports table for each entry
  - For entries still marked as impactful: convert wildcard `export *` patterns to explicit named re-exports or have consumers import directly from submodules
  - **Mark each entry as `done`** in the ledger as it is refactored
  - Update import paths across the codebase as needed, using IDE refactoring tools
  - Run type checking and lint to verify correctness
  - If interrupted, the ledger shows which barrel exports remain `pending`
  - _Requirements: 4.1, 4.2_

- [ ] 5.3 Measure impact of barrel export refactoring
  - Measure the dev compilation module count after barrel refactoring
  - **Update the Measurements table** in the analysis ledger
  - _Requirements: 6.1_

- [ ] 6. Verify lazy-loaded components are excluded from initial compilation
  - Inspect the `*LazyLoaded` component patterns (`dynamic.tsx` + `useLazyLoader`) to confirm they do not contribute modules to the initial page compilation
  - Verify that each lazy-loaded component's `index.ts` only re-exports from `dynamic.tsx` and never from the actual component module
  - If any lazy-loaded components are found in the initial bundle, restructure their exports to follow the existing correct `dynamic.tsx` pattern
  - _Requirements: 7.1, 7.2, 7.3_

- [ ] 7. Phase 1 final measurement and regression verification
- [ ] 7.1 Record final dev compilation metrics
  - Clean the `.next` directory and measure the dev compilation module count and time using the standard protocol (3 runs, median)
  - **Update the Measurements table** in the analysis ledger with the final row
  - Compile a comparison table showing baseline vs. final values, with intermediate measurements from each optimization step
  - _Requirements: 6.1, 6.2, 6.3_

- [ ] 7.2 Run full regression test suite
  - Execute type checking, linting, unit tests, and production build for `@growi/app`
  - Perform a manual smoke test: access the `[[...path]]` page and verify page rendering, editing, navigation, and modal functionality all work correctly
  - Confirm no new runtime errors or warnings in development mode
  - _Requirements: 6.2, 6.3_

## Phase 2: Next.js Version Upgrade Evaluation

- [ ] 8. Evaluate Phase 1 results and Next.js upgrade decision
- [ ] 8.1 Assess whether Phase 1 reduction is sufficient
  - Review the final Measurements table in the analysis ledger
  - Determine whether the reduction meets project goals or whether additional optimization via Next.js upgrade is warranted
  - _Requirements: 5.1_

- [ ] 8.2 Document Next.js 15+ feature evaluation
  - Document which Next.js 15+ features (`bundlePagesRouterDependencies`, `serverExternalPackages`, Turbopack, improved tree-shaking) are relevant to further module reduction
  - Document which features are applicable to the current GROWI Pages Router architecture vs. those that require additional migration
  - Assess the `next-superjson` compatibility blocker and identify mitigation options (manual superjson, direct usage without SWC plugin, or alternative serialization)
  - If the upgrade is not beneficial or too risky, document the reasoning and confirm that Phase 1 optimizations are the final solution
  - _Requirements: 1.1, 1.2, 1.3, 5.1, 5.4_

- [ ] 9. Execute Next.js 15 upgrade (conditional on task 8 decision)
- [ ] 9.1 Run upgrade codemod and address breaking changes
  - Run the official `@next/codemod` upgrade tool to apply automated migrations
  - Address any breaking changes specific to the Pages Router (e.g., `@next/font` → `next/font`, renamed config options)
  - Resolve the `next-superjson` compatibility issue using the mitigation strategy selected in task 8.2
  - _Requirements: 5.2, 5.3_

- [ ] 9.2 Enable v15-specific module optimization features
  - Enable `bundlePagesRouterDependencies: true` in `next.config.js` for automatic server-side dependency bundling
  - Configure `serverExternalPackages` to exclude heavy server-only packages from bundling
  - Measure the dev compilation module count after enabling these features
  - _Requirements: 3.4, 5.2_

- [ ] 9.3 Run full regression test suite after upgrade
  - Execute type checking, linting, unit tests, and production build
  - Verify `getServerSideProps` superjson serialization works correctly across all page routes
  - Verify i18n HMR still functions in development mode (may degrade if I18NextHMRPlugin is affected)
  - Perform a manual smoke test for full functionality
  - _Requirements: 5.3, 6.2, 6.3_
