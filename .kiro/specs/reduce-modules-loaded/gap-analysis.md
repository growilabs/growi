# Gap Analysis: reduce-modules-loaded

## 1. Current State Investigation

### Key Files & Architecture

| Asset | Path | Role |
|-------|------|------|
| Next.js config | `apps/app/next.config.js` | Build config with webpack rules, transpilePackages, optimizePackageImports |
| Catch-all page | `apps/app/src/pages/[[...path]]/index.page.tsx` | Main page route — 10,066 modules on compilation |
| Server-side props | `apps/app/src/pages/[[...path]]/server-side-props.ts` | getServerSideProps logic |
| Common props | `apps/app/src/pages/common-props.ts` | Shared server-side props |
| Transpile utils | `apps/app/src/utils/next.config.utils.js` | Dynamic ESM package discovery for transpilePackages |
| Package.json | `apps/app/package.json` | 193 dependencies (32+ server-only) |

### Existing Optimization Mechanisms

1. **`optimizePackageImports`** — configured for 11 `@growi/*` packages
2. **null-loader** — excludes `dtrace-provider`, `mongoose`, `mathjax-full` from client bundle
3. **`next/dynamic`** — used for 6+ components with `{ ssr: false }`
4. **LazyLoaded pattern** — `*LazyLoaded` wrapper components use `useLazyLoader` hook with dynamic `import()` — correctly defers actual component loading
5. **`@next/bundle-analyzer`** — already installed but not routinely used

### Conventions Observed

- **Pages Router** with `getServerSideProps` (not App Router)
- **next-superjson** for serialization in SSR
- `pageExtensions: ['page.tsx', 'page.ts', 'page.jsx', 'page.js']`
- Feature-based organization in `src/features/`
- State management: Jotai atoms in `src/states/`, SWR hooks in `src/stores/`

---

## 2. Requirement-to-Asset Map

### Requirement 1: Next.js Official Configuration Research

| Need | Status | Notes |
|------|--------|-------|
| `optimizePackageImports` evaluation | **Partially Exists** | Configured for 11 @growi/* packages; not expanded to cover barrel-heavy third-party deps |
| `bundlePagesRouterDependencies` evaluation | **Missing** | Not configured; requires Next.js 15+ |
| `serverExternalPackages` evaluation | **Missing** | Not configured; requires Next.js 15+ |
| Turbopack evaluation | **Missing** | Currently using Webpack; Turbopack stable in Next.js 15+ |
| Bundle analysis tooling | **Exists** | `@next/bundle-analyzer` installed; `next experimental-analyze` available in v16.1+ |

### Requirement 2: Module Count Root Cause Analysis

| Need | Status | Notes |
|------|--------|-------|
| Bundle analysis tooling | **Exists** | `@next/bundle-analyzer` already in `next.config.js` (ANALYZE env var) |
| Server-side module identification | **Gap** | No automated mechanism to detect server module leakage |
| Barrel export impact quantification | **Gap** | No tooling to measure per-barrel module overhead |

### Requirement 3: Server-Side Module Leakage Prevention

| Need | Status | Notes |
|------|--------|-------|
| null-loader for mongoose | **Exists** | Already configured |
| null-loader for other server packages | **Gap — CRITICAL** | 30+ server-only packages NOT excluded (see below) |
| Client → server import detection | **Gap** | No ESLint rule or build-time check |
| `serverExternalPackages` | **Gap** | Requires Next.js 15+ |

**Confirmed Leakage Paths:**

1. **`src/client/components/RecentActivity/ActivityListItem.tsx`** → `~/server/util/locale-utils` → pulls in `^/config/i18next.config` (lightweight, but breaks server/client boundary)
2. **`src/client/components/InAppNotification/ModelNotification/PageBulkExportJobModelNotification.tsx`** → `~/models/serializers/.../page-bulk-export-job.ts` → **`import mongoose from 'mongoose'`** → pulls in entire mongoose + MongoDB driver (but null-loader should catch this on client)
3. **`src/stores/in-app-notification.ts`** → `~/models/serializers/.../user.ts` (clean — no mongoose import)

**Server-Only Packages Missing from null-loader:**

| Package | Type | Estimated Module Impact |
|---------|------|----------------------|
| `@elastic/elasticsearch*` (v7/v8/v9) | Search | High |
| `passport`, `passport-*` (5 packages) | Auth | Medium |
| `@aws-sdk/*` | Cloud storage | High |
| `@azure/*` (3 packages) | Cloud + AI | High |
| `@google-cloud/storage` | Cloud storage | Medium |
| `openai`, `@azure/openai` | AI | Medium |
| `@opentelemetry/*` (8 packages) | Observability | Medium |
| `ldapjs` | Auth | Low |
| `nodemailer*` | Email | Low |
| `multer*` | File upload | Low |
| `redis`, `connect-redis` | Session | Low |
| `socket.io` | Real-time | Medium |

> **Note:** Whether these packages actually get pulled into the client bundle depends on whether any client-reachable import chain references them. The null-loader for mongoose suggests this category of leakage has been observed before.

### Requirement 4: Barrel Export and Package Import Optimization

| Need | Status | Notes |
|------|--------|-------|
| Expand `optimizePackageImports` | **Gap** | Only 11 @growi/* packages; missing third-party barrel-heavy deps |
| Eliminate `export *` in states/ | **Gap** | 7+ barrel export files in `src/states/` with `export *` patterns |
| Eliminate `export *` in features/ | **Gap** | `features/page-tree/index.ts` cascades to 15+ modules |
| Direct imports instead of barrel | **Gap** | Requires refactoring import paths across codebase |

**High-Impact Barrel Export Files:**

| File | Wildcard Exports | Cascading Depth |
|------|-----------------|----------------|
| `src/states/ui/editor/index.ts` | 7 `export *` | 1 level |
| `src/features/page-tree/index.ts` | 3 `export *` | 3 levels → 15+ modules |
| `src/features/page-tree/hooks/_inner/index.ts` | 8 `export *` | 1 level |
| `src/states/page/index.ts` | 2 `export *` + named | 1 level |
| `src/utils/axios/index.ts` | `export * from 'axios'` | Re-exports entire library |

### Requirement 5: Next.js Version Evaluation and Upgrade

| Need | Status | Notes |
|------|--------|-------|
| Current version: Next.js `^14.2.35` | **Exists** | Pages Router architecture |
| Upgrade to v15 evaluation | **Research Needed** | Breaking changes, React 19 dependency, `bundlePagesRouterDependencies` |
| Upgrade to v16 evaluation | **Research Needed** | Turbopack default, experimental-analyze tool |
| Migration effort assessment | **Research Needed** | 30+ page files, custom webpack config, superjson plugin |

### Requirement 6: Compilation Time and Module Count Reduction

| Need | Status | Notes |
|------|--------|-------|
| Baseline measurement | **Exists** | 10,066 modules / 51.5s for `[[...path]]` |
| Before/after metrics framework | **Gap** | No automated benchmarking in CI |
| Functional regression testing | **Exists** | Vitest test suite, Turbo test pipeline |

### Requirement 7: Lazy Loading and Dynamic Import Verification

| Need | Status | Notes |
|------|--------|-------|
| LazyLoaded wrapper pattern | **Exists — Well Designed** | `dynamic.tsx` files use `useLazyLoader` with dynamic `import()` |
| Index re-export pattern | **Exists — Clean** | `index.ts` files only re-export from `dynamic.tsx`, not the actual component |
| Verification tooling | **Gap** | No automated check that lazy-loaded components stay out of initial bundle |

**Good News:** The `*LazyLoaded` pattern is already well-implemented:
```
index.ts → exports from dynamic.tsx → useLazyLoader(() => import('./ActualComponent'))
```
The actual component is only loaded when the trigger condition is met. This is NOT a major contributor to the 10,066 module count.

---

## 3. Implementation Approach Options

### Option A: Configuration-First (No Version Upgrade)

**Approach:** Maximize optimizations within Next.js 14 + Webpack

1. Expand `optimizePackageImports` to cover more barrel-heavy packages
2. Add null-loader rules for additional server-only packages
3. Fix confirmed client → server import violations
4. Refactor critical barrel exports (`states/ui/editor`, `features/page-tree`, `utils/axios`)

**Trade-offs:**
- ✅ No breaking changes, lowest risk
- ✅ Immediately measurable impact
- ✅ Each change is independently verifiable
- ❌ Limited by Webpack's tree-shaking capabilities
- ❌ `bundlePagesRouterDependencies` and `serverExternalPackages` unavailable
- ❌ No Turbopack benefits (automatic import optimization, faster HMR)

### Option B: Next.js 15 Upgrade + Configuration

**Approach:** Upgrade to Next.js 15, then apply v15-specific optimizations

1. Upgrade Next.js 14 → 15 (address breaking changes)
2. Enable `bundlePagesRouterDependencies` + `serverExternalPackages`
3. Expand `optimizePackageImports`
4. Fix client → server import violations
5. Optionally enable Turbopack for dev

**Trade-offs:**
- ✅ Unlocks `bundlePagesRouterDependencies` and `serverExternalPackages`
- ✅ Turbopack available (auto-optimizes imports, 14x faster cold start)
- ✅ Better tree-shaking in Webpack 5 improvements
- ❌ React 19 dependency — breaking change risk across all components
- ❌ `next-superjson` compatibility unknown
- ❌ Medium-to-high migration effort (30+ page files, custom webpack config)
- ❌ Risk of regressions across authentication, i18n, etc.

### Option C: Hybrid — Configuration-First, Then Upgrade (Recommended)

**Approach:** Phase 1 optimizes within v14; Phase 2 evaluates and executes upgrade

**Phase 1 (Low Risk, Immediate Impact):**
1. Run `@next/bundle-analyzer` to establish baseline and identify top contributors
2. Expand `optimizePackageImports` list
3. Add null-loader rules for confirmed server-only packages in client bundle
4. Fix client → server import violations (1 confirmed: `ActivityListItem.tsx`)
5. Refactor high-impact barrel exports
6. Measure before/after module count

**Phase 2 (Higher Risk, Longer Term):**
1. Evaluate Next.js 15/16 upgrade feasibility based on Phase 1 findings
2. If module count reduction from Phase 1 is insufficient, proceed with upgrade
3. Enable `bundlePagesRouterDependencies` + `serverExternalPackages`
4. Evaluate Turbopack adoption for dev mode

**Trade-offs:**
- ✅ Quick wins first — validates approach before committing to upgrade
- ✅ Phase 1 findings inform Phase 2 decisions
- ✅ Incremental risk management
- ❌ More total effort if upgrade is ultimately needed
- ❌ Two phases of testing/validation

---

## 4. Effort & Risk Assessment

| Requirement | Effort | Risk | Justification |
|-------------|--------|------|---------------|
| Req 1: Config Research | S (1-2 days) | Low | Docs research + local testing |
| Req 2: Root Cause Analysis | S (1-2 days) | Low | Run bundle analyzer, document findings |
| Req 3: Server-Side Leakage Fix | M (3-5 days) | Medium | Import chain fixes, null-loader expansion, testing |
| Req 4: Barrel Export Optimization | M (3-5 days) | Medium | Widespread refactoring of import paths |
| Req 5: Next.js Upgrade | L-XL (1-3 weeks) | High | React 19, breaking changes, 30+ pages, plugin compat |
| Req 6: Module Count Reduction | — | — | Outcome of Reqs 1-5 |
| Req 7: Lazy Loading Verification | S (1 day) | Low | Already well-implemented, needs verification only |

**Overall Effort:** M-L (depending on whether upgrade is pursued)
**Overall Risk:** Medium (Phase 1) / High (if Next.js upgrade)

---

## 5. Research Items for Design Phase

1. **Next.js 15 breaking changes inventory** — Full compatibility assessment with GROWI's Pages Router, `next-superjson`, custom webpack config
2. **Turbopack Pages Router support** — Confirm Turbopack works with `getServerSideProps`, `pageExtensions`, custom webpack rules
3. **null-loader effectiveness validation** — Confirm which server packages actually appear in client bundle (some may already be tree-shaken)
4. **`bundlePagesRouterDependencies` impact measurement** — Test with GROWI-like setup to measure actual module reduction
5. **ESLint boundary rule** — Evaluate `eslint-plugin-import` or `@nx/enforce-module-boundaries` for preventing client → server imports

---

## 6. Recommendations for Design Phase

1. **Preferred approach:** Option C (Hybrid) — start with configuration-first optimizations, evaluate upgrade based on results
2. **First action:** Run `ANALYZE=true pnpm run build` to generate bundle analysis report — this will immediately reveal the top module contributors
3. **Quick wins to prioritize:**
   - Expand `optimizePackageImports` (zero-risk config change)
   - Fix `ActivityListItem.tsx` server import (1 file change)
   - Verify null-loader coverage for mongoose is effective
4. **Defer:** Next.js upgrade decision until after Phase 1 metrics are collected
