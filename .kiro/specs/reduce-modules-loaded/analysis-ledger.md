# Analysis Ledger

## Measurements

### Legacy KPI (total modules from `Compiled ... (N modules)`)
| Step | Task | Modules | Time | Date |
|------|------|---------|------|------|
| Baseline (no changes) | 1.1 | 10,066 | ~31s | 2026-02-19 |
| + optimizePackageImports only | 2.2 | 10,279 (+213) | ~31.1s | 2026-02-19 |
| + all Phase 1 changes | 7.1 | 10,281 (+215) | ~31.6s | 2026-02-19 |
| Committed changes (no optimizePkgImports) | 7.1 | 10,068 (+2) | ~30.8s | 2026-02-19 |
| Revert only optimizePkgImports | bisect | 10,068 | ~30.8s | 2026-02-19 |
| Revert only locale-utils fix | bisect | 10,279 | ~31.2s | 2026-02-19 |
| Revert only serializer fix | bisect | 10,281 | ~31.2s | 2026-02-19 |
| Revert only axios fix | bisect | 10,281 | ~31.1s | 2026-02-19 |

> **Note**: Total module count includes both initial (eager) and async (lazy) chunks. Dynamic imports move modules to async chunks without reducing the total, so this metric does NOT reflect lazy-loading improvements. Replaced by ChunkModuleStats KPI below.

### New KPI: ChunkModuleStats (initial / async-only / total)

Measured via `ChunkModuleStatsPlugin` in `next.config.utils.js`. The `initial` count represents modules loaded eagerly on page access — this is the primary reduction target.

| Step | Task | initial | async-only | total | Compiled modules | Date |
|------|------|---------|------------|-------|------------------|------|
| **Baseline (no Phase 2 changes)** | 8.1 | **2,704** | 4,146 | 6,850 | 10,068 | 2026-02-20 |
| + MermaidViewer dynamic + date-fns subpath | 8.3 | **2,128** | 4,717 | 6,845 | 10,058 | 2026-02-20 |
| + date-fns locale subpath imports | 8.N | **1,630** | 4,717 | 6,347 | 9,062 | 2026-02-20 |

> **Note**: Originally reported baseline was 51.5s, but automated measurement on the same machine consistently shows ~31s. The 51.5s figure may reflect cold cache, different system load, or an earlier codebase state.

### Measurement Method

**Automated (Phase 2+)**:

```bash
# One-command measurement — cleans .next, starts next dev, triggers compilation, outputs results
./apps/app/bin/measure-chunk-stats.sh        # default port 3099
./apps/app/bin/measure-chunk-stats.sh 3001   # custom port
```

Output: `[ChunkModuleStats] initial: N, async-only: N, total: N` + `Compiled /[[...path]] in Xs (N modules)`

**Manual (Phase 1, legacy)**:

```bash
rm -rf apps/app/.next
cd apps/app && node_modules/.bin/next dev -p 3000 &
curl -s http://localhost:3000/
# Read log output, then: pkill -f "next dev"
```

**Key details**:
- `next dev` can be started without MongoDB — it compiles pages on-demand via webpack regardless of database connectivity
- Compilation is triggered by HTTP access (curl), not by server startup alone (Next.js uses on-demand compilation)
- `ChunkModuleStatsPlugin` (in `src/utils/next.config.utils.js`) separates modules into initial (eager) vs async-only (lazy) chunks
- The `initial` count is the primary KPI — modules the browser must load on first page access

## Import Violations (Task 3)
| # | File | Violation | Fix Strategy | Status |
|---|------|-----------|--------------|--------|
| 1 | src/client/components/RecentActivity/ActivityListItem.tsx | imports `getLocale` from `~/server/util/locale-utils` | Extracted `getLocale` to `src/utils/locale-utils.ts`; client imports from shared module | done |
| 2 | src/client/components/InAppNotification/ModelNotification/PageBulkExportJobModelNotification.tsx | imports `~/models/serializers/in-app-notification-snapshot/page-bulk-export-job` which has `import mongoose from 'mongoose'` | Created `page-bulk-export-job-client.ts` with `parseSnapshot` + `IPageBulkExportJobSnapshot`; client imports from client module | done |

## Server Packages in Client Bundle (Task 4)
| # | Package | Confirmed in Client Bundle | null-loader Added | Status |
|---|---------|---------------------------|-------------------|--------|
| 1 | mongoose | Yes (existing rule) | Yes | done |
| 2 | dtrace-provider | Yes (existing rule) | Yes | done |
| 3 | mathjax-full | Yes (existing rule) | Yes | done |
| 4 | @elastic/elasticsearch* | No (server-only imports) | N/A | done |
| 5 | passport* | No (server-only imports) | N/A | done |
| 6 | @aws-sdk/* | No (server-only imports) | N/A | done |
| 7 | @azure/* | No (server-only imports) | N/A | done |
| 8 | @google-cloud/storage | No (server-only imports) | N/A | done |
| 9 | openai | No (only `import type` in interfaces — erased at compile) | N/A | done |
| 10 | ldapjs | No (server-only imports) | N/A | done |
| 11 | nodemailer | No (server-only imports) | N/A | done |
| 12 | multer | No (server-only imports) | N/A | done |
| 13 | socket.io | No (server uses socket.io; client uses socket.io-client) | N/A | done |
| 14 | redis / connect-redis | No (server-only imports) | N/A | done |
| 15 | @opentelemetry/* | No (server-only imports) | N/A | done |

> **Conclusion**: All server-only packages are properly isolated. No additional null-loader rules needed beyond existing mongoose, dtrace-provider, mathjax-full.

## Barrel Exports to Refactor (Task 5)
| # | File | Issue | Still Impactful After optimizePackageImports? | Status |
|---|------|-------|-----------------------------------------------|--------|
| 1 | src/utils/axios/index.ts | `export * from 'axios'` — unused by all consumers (all use default import only) | N/A (always fix) | done |
| 2 | src/states/ui/editor/index.ts | 7 wildcard `export *` re-exports | No — internal modules, small files, no heavy deps | done (no change needed) |
| 3 | src/features/page-tree/index.ts | 3-level cascading barrel → hooks, interfaces, states | No — well-scoped domain barrel, types + hooks only | done (no change needed) |
| 4 | src/features/page-tree/hooks/_inner/index.ts | 8 wildcard `export *` re-exports | No — all small hook files within same feature | done (no change needed) |
| 5 | src/states/page/index.ts | 2 wildcard `export *` + named exports | No — focused Jotai hooks, no heavy deps | done (no change needed) |
| 6 | src/states/server-configurations/index.ts | 2 wildcard `export *` | No — small config atoms only | done (no change needed) |

## Phase 1 Sufficiency Assessment (Task 8.1)

### Phase 1 Changes Summary

| # | Change | Category | Description |
|---|--------|----------|-------------|
| 1 | `optimizePackageImports` +3 packages | Config | Added reactstrap, react-hook-form, react-markdown |
| 2 | locale-utils extraction | Import fix | Extracted `getLocale` from `~/server/util/` to `~/utils/` (client-safe) |
| 3 | Serializer split | Import fix | Created `page-bulk-export-job-client.ts` separating `parseSnapshot` from mongoose-dependent `stringifySnapshot` |
| 4 | Axios barrel fix | Barrel refactor | Removed `export * from 'axios'` (unused by all 7 consumers) |
| 5 | null-loader analysis | Investigation | Confirmed all server packages already properly isolated — no additional rules needed |
| 6 | Internal barrel evaluation | Investigation | Internal barrels (states, features) are small and well-scoped — no changes needed |
| 7 | LazyLoaded verification | Verification | All 30 LazyLoaded components follow correct dynamic import pattern |

### Actual Measurement Results (A/B Bisection)

| Change Group | Modules | Time | vs Baseline |
|-------------|---------|------|-------------|
| Baseline (no changes) | 10,066 | ~31s | — |
| **optimizePackageImports +3 pkgs** | **10,279** | **~31.1s** | **+213 modules, no time change** |
| locale-utils fix only | ~10,068 | ~31s | +2 modules, no time change |
| serializer fix only | ~10,066 | ~31s | 0 modules, no time change |
| axios barrel fix only | ~10,066 | ~31s | 0 modules, no time change |
| All committed changes (no optimizePkgImports) | 10,068 | ~30.8s | +2 modules, no time change |

> **Key finding**: Static analysis estimates were completely wrong. `optimizePackageImports` INCREASED modules (+213) instead of reducing them. Other changes had zero measurable impact on compilation time.

### Assessment Conclusion

**Phase 1 does not reduce compilation time.** The committed changes (import violation fixes, axios barrel fix) are code quality improvements but have no measurable effect on the dev compilation metric.

**Why Phase 1 had no impact on compilation time**:
1. **`optimizePackageImports` backfired**: In dev mode, this setting resolves individual sub-module files instead of the barrel, resulting in MORE module entries in webpack's graph. This is the opposite of the expected behavior. **Reverted — not committed.**
2. **Import violation fixes don't reduce modules meaningfully**: The server modules pulled in by the violations were already being null-loaded (mongoose) or were lightweight (date-fns locale files only).
3. **Barrel export removal had no measurable effect**: `export * from 'axios'` was unused, so removing it didn't change the module graph.
4. **Compilation time is dominated by the sheer volume of 10,000+ client-side modules** that are legitimately needed by the `[[...path]]` catch-all page. Incremental import fixes cannot meaningfully reduce this.

### Recommendation: Compilation Time Reduction Requires Architectural Changes

The following approaches can actually reduce compilation time for `[[...path]]`:

1. **Next.js 15 + `bundlePagesRouterDependencies`** — Changes how server dependencies are handled, potentially excluding thousands of modules from client compilation
2. **Turbopack** — Rust-based bundler with 14x faster cold starts; handles the same 10,000 modules much faster
3. **Route splitting** — Break `[[...path]]` into smaller routes so each compiles fewer modules on-demand

**Key blockers for Next.js upgrade (Task 8.2)**:
1. `next-superjson` SWC plugin compatibility — critical blocker
2. React 19 peer dependency — manageable (Pages Router backward compat)
3. `I18NextHMRPlugin` — webpack-specific; may need alternative

**Decision**: Phase 1 committed changes are kept as code quality improvements (server/client boundary enforcement, dead code removal). Phase 2 evaluation is needed for actual compilation time reduction.

## Phase 2: Module Graph Analysis and Dynamic Import Optimization (Task 8.1 continued)

### Module Composition Analysis

Client bundle module paths extracted from `.next/static/chunks/` — 6,822 unique modules total.

**Top 10 module-heavy packages in [[...path]] compilation:**

| Package | Modules | % of Total | Source |
|---------|---------|-----------|--------|
| lodash-es | 640 | 9.4% | Transitive via mermaid → chevrotain |
| date-fns | 627 | 9.2% | Direct (barrel imports) + react-datepicker (v2) |
| highlight.js | 385 | 5.6% | react-syntax-highlighter → CodeBlock |
| refractor | 279 | 4.1% | react-syntax-highlighter → CodeBlock |
| core-js | 227 | 3.3% | Next.js polyfills (not controllable via imports) |
| @codemirror | 127 | 1.9% | Editor components |
| lodash | 127 | 1.9% | Transitive via express-validator |
| d3-array | 120 | 1.8% | Transitive via mermaid |
| react-bootstrap-typeahead | 106 | 1.6% | Search/autocomplete UI |
| **Top 10 total** | **2,752** | **40%** | |

### Changes Applied

1. **MermaidViewer → `next/dynamic({ ssr: false })`**
   - Split `import * as mermaid from '~/features/mermaid'` into:
     - Static: `remarkPlugin` + `sanitizeOption` from `~/features/mermaid/services` (lightweight, no npm mermaid)
     - Dynamic: `MermaidViewer` via `next/dynamic` (loads mermaid npm + lodash-es + chevrotain on demand)
   - SSR impact: None — client renderer only (`assert(isClient())`)

2. **CodeBlock → `next/dynamic({ ssr: false })`**
   - Removed static `import { CodeBlock }` from shared renderer (`src/services/renderer/renderer.tsx`)
   - Added `DynamicCodeBlock` via `next/dynamic` in client renderer only
   - SSR impact: Code blocks render without syntax highlighting during SSR (accepted trade-off)

3. **date-fns barrel → subpath imports (12 files)**
   - Converted all `import { ... } from 'date-fns'` to specific subpath imports
   - e.g., `import { format } from 'date-fns/format'`
   - Files: Comment.tsx, ShareLinkForm.tsx, ActivityListItem.tsx, DateRangePicker.tsx, FormattedDistanceDate.jsx, create-custom-axios.ts, activity.ts, user-activation.ts, forgot-password.js, thread-relation.ts, normalize-thread-relation-expired-at.ts, normalize-thread-relation-expired-at.integ.ts

4. **core-js — no action possible**
   - 227 modules come from Next.js automatic polyfill injection, not application imports
   - Can only be reduced by `.browserslistrc` (targeting modern browsers) or Next.js 15+ upgrade

### Measurement Results

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| Modules | 10,066 | 10,054 | -12 |
| Compile time (run 1) | ~31s | 26.9s | -4.1s |
| Compile time (run 2) | ~31s | 26.7s | -4.3s |
| **Average compile time** | **~31s** | **~26.8s** | **-4.2s (14%)** |

### Analysis

- **Module count decreased only 12**: Dynamic imports still count as modules in the webpack graph, but they're compiled into separate chunks (lazy). The "10,054 modules" includes the lazy chunks' modules in the count.
- **Compile time decreased ~14%**: The significant improvement suggests webpack's per-module overhead is not uniform — mermaid (with chevrotain parser generator) and react-syntax-highlighter (with highlight.js language definitions) are particularly expensive to compile despite their module count.
- **date-fns subpath imports**: Contributed to the module count reduction but likely minimal time impact (consistent with Phase 1 findings).
