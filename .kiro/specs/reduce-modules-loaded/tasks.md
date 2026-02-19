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

- [x] 1. Establish baseline dev compilation measurement
- [x] 1.1 Record baseline module count and compilation time
  - Baseline: 10,066 modules / 51.5s (reported)
  - _Requirements: 2.1, 6.1_

- [x] 1.2 (P) Run supplementary bundle analysis and create analysis ledger
  - Created `analysis-ledger.md` with comprehensive findings
  - Scanned all client/server import violations, barrel exports, server package candidates
  - _Requirements: 1.4, 2.1, 2.2, 2.3_

- [x] 2. Expand `optimizePackageImports` configuration — **REJECTED (reverted)**
- [x] 2.1 Identify barrel-heavy packages to add
  - Identified: reactstrap (199-line barrel, 124 import sites), react-hook-form (2,602-line barrel, 31 sites), react-markdown (321-line barrel, 6 sites)
  - _Requirements: 1.1, 1.2, 1.3_

- [x] 2.2 Add candidate packages to the config and measure impact — **REVERTED**
  - Added reactstrap, react-hook-form, react-markdown to `optimizePackageImports` in `next.config.js`
  - **Actual measurement: +213 modules (10,066 → 10,279), no compilation time improvement**
  - `optimizePackageImports` resolves individual module files instead of barrel, resulting in MORE module entries in webpack's dev compilation graph
  - **Decision: Reverted — config change not included in commit**
  - _Requirements: 4.3, 4.4, 6.1_

- [x] 3. Fix client-to-server import violations
- [x] 3.1 Scan for all import violations and update the ledger
  - Found 2 violations: ActivityListItem.tsx → ~/server/util/locale-utils, PageBulkExportJobModelNotification.tsx → serializer with mongoose
  - _Requirements: 3.1, 3.3_

- [x] 3.2 (P) Fix all identified import violations
  - Violation 1: Extracted `getLocale` to `src/utils/locale-utils.ts` (client-safe); updated ActivityListItem.tsx and server module
  - Violation 2: Created `page-bulk-export-job-client.ts` with `parseSnapshot` + `IPageBulkExportJobSnapshot`; updated client component import
  - Tests: 18 new tests (15 for locale-utils, 3 for page-bulk-export-job-client) — all pass
  - _Requirements: 3.1, 3.2, 3.3_

- [x] 3.3 Measure impact of import violation fixes
  - **Actual measurement: 10,068 modules (vs 10,066 baseline) — +2 modules, no compilation time change (~31s)**
  - Import violation fixes are architecturally correct (server/client boundary) but do not reduce compilation time
  - _Requirements: 6.1_

- [x] 4. Expand null-loader rules for server-only packages in client bundle
- [x] 4.1 Confirm which server packages appear in the client bundle
  - Comprehensive analysis of all 16 candidate server packages
  - **Result: No additional server packages are reachable from client code** — all are properly isolated to server-only import paths
  - openai uses `import type` only in client-reachable interfaces (erased at compile time)
  - _Requirements: 3.1, 3.2_

- [x] 4.2 Add null-loader rules and measure impact
  - **No additional null-loader rules needed** — existing rules (mongoose, dtrace-provider, mathjax-full) are sufficient
  - _Requirements: 3.1, 3.2, 6.1_

- [x] 5. Refactor high-impact barrel exports
- [x] 5.1 Fix the axios barrel re-export
  - Removed `export * from 'axios'` — confirmed unused by all 7 consumers (all use default import only)
  - All 15 existing axios tests pass
  - _Requirements: 4.1, 4.2_

- [x] 5.2 Evaluate and refactor remaining barrel exports
  - Evaluated 5 internal barrel files (states/ui/editor, features/page-tree, states/page, etc.)
  - **Result: No refactoring needed** — internal barrels re-export from small focused files within same domain; `optimizePackageImports` only applies to node_modules packages
  - _Requirements: 4.1, 4.2_

- [x] 5.3 Measure impact of barrel export refactoring
  - **Actual measurement: Removing `export * from 'axios'` had no measurable impact on modules or compilation time**
  - _Requirements: 6.1_

- [x] 6. Verify lazy-loaded components are excluded from initial compilation
  - Verified all 30 LazyLoaded components follow correct pattern
  - All index.ts files re-export only from dynamic.tsx
  - All dynamic.tsx files use useLazyLoader with dynamic import()
  - No static imports of actual components found
  - _Requirements: 7.1, 7.2, 7.3_

- [x] 7. Phase 1 final measurement and regression verification
- [x] 7.1 Record final dev compilation metrics
  - **Actual measurement (committed changes only, without optimizePackageImports):**
  - Baseline: 10,066 modules / ~31s
  - After committed Phase 1 changes: 10,068 modules / ~31s
  - **Result: No meaningful compilation time reduction from Phase 1 code changes**
  - Phase 1 changes are valuable as code quality improvements (server/client boundary, unused re-exports) but do not achieve the compilation time reduction goal
  - _Requirements: 6.1, 6.2, 6.3_

- [x] 7.2 Run full regression test suite
  - Type checking: Zero errors (tsgo --noEmit)
  - Biome lint: 1,776 files checked, no errors
  - Tests: 107 test files pass (1,144 tests); 8 integration test timeouts are pre-existing MongoDB environment issue
  - Production build: Succeeds
  - _Requirements: 6.2, 6.3_

## Phase 2: Next.js Version Upgrade Evaluation

- [ ] 8. Evaluate Phase 1 results and Next.js upgrade decision
- [x] 8.1 Assess whether Phase 1 reduction is sufficient
  - **Actual measurement results (A/B bisection):**
    - Baseline (no changes): 10,066 modules / ~31s
    - All Phase 1 changes: 10,281 modules / ~31.6s (optimizePackageImports caused +213 modules)
    - Committed changes only (without optimizePackageImports): 10,068 modules / ~31s
    - Each change group tested independently — none produced measurable compilation time improvement
  - **Assessment: Phase 1 is insufficient for compilation time reduction.** Changes are code quality improvements only.
  - **optimizePackageImports rejected**: Adding reactstrap/react-hook-form/react-markdown increased module count by 213 with no time benefit — reverted
  - Recommendation: Proceed with Next.js upgrade evaluation (Task 8.2) or Turbopack/route splitting
  - Full assessment documented in `analysis-ledger.md`
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
