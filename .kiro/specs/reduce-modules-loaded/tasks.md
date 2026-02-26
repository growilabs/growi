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

## Phase 2: Iterative Module Reduction (Dynamic Import & Import Optimization)

### KPI

- **Primary**: `[ChunkModuleStats] initial` — modules in eager (initial) chunks
- **Baseline**: initial: 2,704 (before Phase 2 changes)
- Measured via `bin/measure-chunk-stats.sh` (cleans `.next`, starts `next dev`, triggers compilation, outputs ChunkModuleStats)

### Reduction Loop

The following loop repeats until the user declares completion:

1. **Measure** — Run `bin/measure-chunk-stats.sh`, record `initial` / `async-only` / `total` in `analysis-ledger.md`
2. **Analyze & Propose** — Analyze the initial chunk module graph, identify the top contributors, and propose one or more reduction approaches (e.g., `next/dynamic`, import refactoring, dependency replacement). Alternatively, if further reduction is impractical, propose ending the loop.
3. **User Decision** — The user approves the proposed approach, adjusts it, or declares the loop complete.
4. **Implement & Verify** — Apply the approved changes, then run `turbo run lint:typecheck --filter @growi/app && turbo run lint:biome --filter @growi/app`. Fix any errors before returning to step 1.

### Task Log

- [x] 8.1 Phase 1 sufficiency assessment
  - **Assessment: Phase 1 is insufficient for compilation time reduction.** Changes are code quality improvements only.
  - Full assessment documented in `analysis-ledger.md`
  - _Requirements: 5.1_

- [x] 8.2 Establish ChunkModuleStats KPI and measurement tooling
  - Created `ChunkModuleStatsPlugin` in `src/utils/next.config.utils.js`
  - Created `bin/measure-chunk-stats.sh` for one-command measurement
  - Baseline recorded: initial: 2,704 / async-only: 4,146 / total: 6,850
  - _Requirements: 2.1, 6.1_

- [x] 8.3 Loop iteration 1: MermaidViewer dynamic import + date-fns subpath imports
  - MermaidViewer → `next/dynamic({ ssr: false })` in client renderer
  - date-fns barrel → subpath imports (12 files)
  - Result: initial: 2,128 (-576, -21.3%) / async-only: 4,717 / total: 6,845
  - _Requirements: 7.2, 4.1, 6.1_

- [x] 8.4 Loop iteration 2: date-fns locale barrel → individual subpath imports
  - Converted `locale-utils.ts` import from `date-fns/locale` barrel (96 locales × 6 modules = ~576 modules) to individual subpath imports (`date-fns/locale/en-US`, `/fr`, `/ja`, `/ko`, `/zh-CN`)
  - Updated `locale-utils.spec.ts` import paths to match
  - Enhanced `ChunkModuleStatsPlugin` with `DUMP_INITIAL_MODULES=1` diagnostic mode for per-package breakdown
  - Result: initial: 1,630 (-498, -23.4%) / async-only: 4,717 / total: 6,347 / compiled: 9,062
  - date-fns: 560 → 62 modules in initial chunks
  - _Requirements: 4.1, 6.1_

- [x] 8.5 Loop iteration 3: null-loader expansion for server-only package leaks
  - Added null-loader rules for `i18next-fs-backend` (server-only filesystem translation backend leaking via next-i18next), `bunyan` (server-only logging; client uses browser-bunyan via universal-bunyan), and `bunyan-format` (server-only log formatter)
  - Null-loading bunyan eliminated its entire transitive dependency tree: mv, ncp, mkdirp, rimraf, glob, source-map, source-map-support, and other Node.js utilities
  - Result: initial: 1,572 (-58, -3.6%) / async-only: 4,720 / total: 6,292 / compiled: 9,007
  - _Requirements: 3.1, 3.2, 6.1_

- [x] 8.6 Loop iteration 4: validator → isMongoId regex replacement in LinkEditModal
  - Replaced `import validator from 'validator'` with lightweight `isMongoId()` regex utility (`/^[0-9a-f]{24}$/i`)
  - Created `src/client/util/mongo-id.ts` with `isMongoId()` and `mongo-id.spec.ts` with 8 unit tests (TDD)
  - Eliminated all 113 `validator` modules from async-only chunks (single usage: `validator.isMongoId()` in LinkEditModal.tsx)
  - Result: initial: 1,572 (unchanged) / async-only: 4,608 (-112, -2.4%) / total: 6,180 (-112) / compiled: 8,895 (-112)
  - _Requirements: 4.1, 6.1_

- [x] 8.7 Loop iteration 5: react-hotkeys → tinykeys migration
  - Replaced `react-hotkeys` (91 async modules) with `tinykeys` (~400 byte, 1 module)
  - Rewrote `HotkeysManager.tsx` to use tinykeys directly with inline key bindings
  - Deleted `HotkeysDetector.jsx` (unused), `HotkeyStroke.js` (unused model)
  - Removed `getHotkeyStrokes()` static methods from all 6 subscriber components
  - Removed `react-hotkeys` dependency, added `tinykeys` dependency
  - Added `HotkeysManager.spec.tsx` with 6 tests (single keys, modifier keys, editable target suppression)
  - Refactored all 6 subscriber components to align with ideal patterns:
    - Converted 4 JSX files to TypeScript (CreatePage, FocusToGlobalSearch, ShowStaffCredit, SwitchToMirrorMode)
    - Fixed `onDeleteRender(this)` bug in 3 files (`this` is undefined in functional components)
    - Replaced PropTypes with TypeScript `Props` type in all subscribers
    - Removed unnecessary `React.memo` wrapper from CreatePage
    - Unified return values: `return null` for logic-only components
    - Converted all 6 subscribers from default exports to named exports
  - Result: initial: 1,573 (+1) / async-only: 4,516 (-92) / total: 6,089 (-91) / compiled: 8,802 (-93)
  - _Requirements: 4.1, 6.1_

- [x] 8.8 Loop iteration 6: markdown rendering pipeline → next/dynamic({ ssr: true })
  - Created `PageContentRenderer` wrapper component encapsulating `RevisionRenderer` + `generateSSRViewOptions`
  - Converted `PageContentRenderer` to `next/dynamic({ ssr: true })` in both `PageView.tsx` and `ShareLinkPageView.tsx`
  - Moves entire markdown pipeline (react-markdown, katex, remark-gfm, rehype-katex, mdast-util-to-markdown, etc.) to async chunks while preserving SSR rendering
  - Added `PageContentRenderer.spec.tsx` with 3 tests (null markdown, generated options, explicit options)
  - Result: initial: 1,073 (-500, -31.8%) / async-only: 5,016 (+500) / total: 6,089 (unchanged) / compiled: 8,803 (+1)
  - _Requirements: 7.2, 6.1_

- [x] 8.9 Loop iteration 7: core-js null-load + ChunkModuleStatsPlugin analysis fix
  - Added null-loader rule for `core-js` on client side — polyfills baked into next-i18next/react-stickynode dist files; all APIs natively supported by target browsers (Chrome 64+, Safari 12+)
  - Null-loading eliminates 179 core-js transitive dependency modules; 37 entry-point modules remain as empty stubs
  - Fixed `ChunkModuleStatsPlugin` to strip webpack loader prefixes (e.g., `source-map-loader!/path`) before package attribution — corrects 82 previously misattributed modules
  - Result: initial: 894 (-179, -16.7%) / async-only: 5,011 (-5) / total: 5,905 (-184) / compiled: 8,619 (-184)
  - _Requirements: 3.1, 3.2, 6.1_

- [x] 8.10 Loop iteration 8: react-syntax-highlighter deep ESM import + v16 upgrade
  - Changed barrel import `import { PrismAsyncLight } from 'react-syntax-highlighter'` to deep ESM import `import PrismAsyncLight from 'react-syntax-highlighter/dist/esm/prism-async-light'` in all 4 usage files
  - Changed style import from `dist/cjs/styles/prism` barrel to `dist/esm/styles/prism/one-dark` direct import
  - Upgraded react-syntax-highlighter from 15.5.0 to 16.1.0 (refractor v3→v5 security fix, webpack 5 improvements, API unchanged)
  - Deep import bypasses barrel that re-exports all engines (highlight.js, Prism, etc.); only Prism/refractor engine is bundled
  - Remaining highlight.js modules (~149) still present via other paths (diff2html, lowlight)
  - Result: initial: 895 (+1) / async-only: 4,775 (-236, -4.7%) / total: 5,670 (-235)
  - _Requirements: 4.1, 6.1_

- [ ] 8.N Loop iteration N: (next iteration — measure, analyze, propose, implement)

## Phase 3: Next.js Version Upgrade Evaluation (Deferred)

- [x] 9.1 Document Next.js 15+ feature evaluation
  - Documented all Next.js 15+ features relevant to module reduction: `bundlePagesRouterDependencies`, `serverExternalPackages`, Turbopack (stable dev), improved tree-shaking
  - Assessed `next-superjson` blocker: 4 options evaluated (A: v1.0.8 upgrade, B: superjson-next fork, C: manual per-page wrapping, D: custom webpack loader)
  - **Option A (`next-superjson` v1.0.8) rejected** — achieves "v15 support" via fragile `@swc/core@1.4.17` pinning with double SWC compilation; depends on unmaintained WASM binary
  - **Option D (custom webpack loader) selected** — zero-dependency regex-based source transform; same transparent DX as original plugin with no per-page changes
  - Breaking changes for Pages Router are minimal (no async API changes, React 18 backward compat confirmed)
  - **Decision: Proceed with Next.js 15 upgrade** — benefits outweigh minimal risk
  - Full evaluation documented in `research.md` under "Phase 3: Next.js 15+ Feature Evaluation"
  - _Requirements: 1.1, 1.2, 1.3, 5.1, 5.4_

- [ ] 9.2 Execute Next.js 15 upgrade
  - Migrated from `next-superjson` SWC plugin to custom webpack loader approach:
    - Created `withSuperJSONProps()` and `deserializeSuperJSONProps()` in `src/pages/utils/superjson-ssr.ts` (10 tests)
    - Created `src/utils/superjson-ssr-loader.js` — regex-based webpack loader that auto-wraps `getServerSideProps` exports
    - Added loader rule in `next.config.js` targeting `.page.{ts,tsx}` files
    - Added centralized deserialization in `_app.page.tsx`
    - Removed `next-superjson` dependency and `withSuperjson()` from `next.config.js`
    - **Zero per-page file changes** — loader transparently handles all 38 pages
  - Upgraded Next.js 14.2.35 → 15.5.12, `@next/bundle-analyzer` 14.1.3 → 15.5.12
  - Updated peer deps in `@growi/presentation`, `@growi/remark-lsx`, `@growi/ui` to `^14 || ^15`
  - _Requirements: 5.2, 5.3_

- [x] 9.3 Enable v15-specific module optimization features
  - Added `bundlePagesRouterDependencies: true` to `next.config.js` — bundles server-side dependencies for Pages Router, matching App Router behavior
  - Added `serverExternalPackages: ['handsontable']` — legacy `handsontable@6.2.2` requires unavailable `@babel/polyfill`; client-only via dynamic import, kept external on server
  - Auto-excluded packages (mongoose, mongodb, express, sharp, and 68 others) handled by Next.js built-in list
  - `serverExternalPackages` replaces `experimental.serverComponentsExternalPackages` (now stable in v15)
  - Production build passes with new configuration
  - _Requirements: 3.4, 5.2_

- [x] 9.4 Run full regression test suite after upgrade
  - Type checking: Zero errors (tsgo --noEmit)
  - Biome lint: 1,791 files checked, no errors
  - Tests: 127 test files, 1,375 tests — all passed
  - Production build: Passes with `bundlePagesRouterDependencies: true` + `serverExternalPackages`
  - _Requirements: 5.3, 6.2, 6.3_
