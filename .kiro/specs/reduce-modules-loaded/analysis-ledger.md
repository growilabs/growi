# Analysis Ledger

## Measurements
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

> **Note**: Originally reported baseline was 51.5s, but automated measurement on the same machine consistently shows ~31s. The 51.5s figure may reflect cold cache, different system load, or an earlier codebase state.

### Measurement Method

The following method was used for all measurements on 2026-02-19:

```bash
# 1. Clean .next cache
rm -rf apps/app/.next

# 2. Start Next.js dev server directly (bypassing Express/MongoDB)
cd apps/app && node_modules/.bin/next dev -p 3000 &

# 3. Wait for "Ready" in log, then trigger on-demand compilation
curl -s http://localhost:3000/

# 4. Read compilation result from terminal log
#    e.g. "✓ Compiled /[[...path]] in 31s (10066 modules)"

# 5. Kill dev server
pkill -f "next dev"
```

**Key details**:
- `next dev` can be started without MongoDB — it compiles pages on-demand via webpack regardless of database connectivity
- Compilation is triggered by HTTP access (curl), not by server startup alone (Next.js uses on-demand compilation)
- For A/B bisection, files were backed up and swapped between measurements using `cp` to isolate each change group
- Single measurement per configuration (not 3x median) due to consistent results (~0.5s variance between runs)

> **Measurement Protocol**: Clean `.next` → `next dev` → `curl localhost:3000` → read `Compiled /[[...path]] in Xs (N modules)` from log

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
