# Gap Analysis: ESM Migration

## Summary

- **Scope**: Migrate the GROWI monorepo from hybrid CJS/ESM to full ESM. The server layer of `apps/app` is the critical bottleneck — 82 files with `module.exports`, 179 `require()` occurrences across 57 files, 45 factory-pattern require+invoke calls (9 in `routes/index.js`, 36 in `routes/apiv3/index.js`), and 3 `__dirname` files.
- **Easy wins**: All 5 remaining CJS packages (`pdf-converter-client`, `preset-themes`, `preset-templates`, `core-styles`, `custom-icons`) have zero CJS source code — conversion is trivial (`"type": "module"` only).
- **Core challenge**: The Express route registration pattern uses `require('./route')(crowi, app)` — a factory DI pattern across 43+ files that must be refactored to ESM `import` + explicit factory invocation.
- **transpilePackages**: 145 entries (39 hardcoded + ~99 dynamic remark/rehype + @growi packages). Most exist solely to work around CJS/ESM incompatibility; full ESM should eliminate the majority.
- **Production assembly**: `assemble-prod.sh` + `check-next-symlinks.sh` must be verified end-to-end after migration. The flat `node_modules` at workspace root + symlink strategy is ESM-compatible but needs testing.

---

## 1. Requirement-to-Asset Map

### Requirement 1: Remaining Shared Packages ESM Conversion

| Asset | Status | Gap |
|-------|--------|-----|
| `@growi/pdf-converter-client` | tsconfig `module: "CommonJS"`, 1 auto-generated file (ESM syntax) | **Trivial** — change tsconfig + add `"type": "module"` |
| `@growi/preset-themes` | Vite build already outputs ES + UMD, source is ESM | **Trivial** — add `"type": "module"` |
| `@growi/preset-templates` | No JS source (plugin data package) | **Trivial** — add `"type": "module"` |
| `@growi/core-styles` | SCSS-only, no JS | **None** — optionally add `"type": "module"` for consistency |
| `@growi/custom-icons` | SVG + font builder, no JS | **None** — optionally add `"type": "module"` for consistency |

**Effort: S (1 day)** | **Risk: Low**

### Requirement 2: apps/app Server Layer ESM Migration

| Asset | Status | Gap |
|-------|--------|-----|
| `tsconfig.build.server.json` | `"module": "CommonJS"`, `"moduleResolution": "Node"` | Must change to `"module": "ESNext"` / `"NodeNext"` |
| Factory route pattern | 82 files: `module.exports = (crowi, app) => { ... }` | **Major refactor** — convert to named export factories |
| Static/dynamic requires | 179 occurrences across 57 files | Mechanical — convert to `import` statements or `await import()` |
| Factory require+invoke | 45 calls: 9 in `routes/index.js`, 36 in `routes/apiv3/index.js` | Convert to static `import` + factory call |
| Conditional requires | 2 files: ternary require patterns | Convert to conditional `await import()` |
| `__dirname` / `__filename` | 3 files: `crowi/index.ts`, `crowi/dev.js`, `service/i18next.ts` | Replace with `import.meta.dirname` (Node.js 21.2+). Note: `next.config.ts` also uses `__dirname` but is build-time only (Turbopack handles it) |
| Dev server startup | `ts-node/register/transpile-only` + `tsconfig-paths/register` | Must switch to ESM loader (tsx, ts-node/esm, or Node.js `--import`) |
| Config files | 5 CJS config files in `apps/app/config/` | Rename to `.cjs` or convert to ESM |
| `next.config.prod.cjs` | Already `.cjs` | **No change needed** |
| Migrations (`src/migrations/*.js`) | 60+ files using `require('mongoose')` | **Constraint** — migrate-mongo CLI must support ESM or files stay as `.cjs` |

**Key Patterns Found:**

```javascript
// CURRENT: routes/index.js (central router loader)
module.exports = (crowi, app) => {
  const page = require('./page')(crowi, app);        // 25 similar lines
  const apiV3Router = require('./apiv3')(crowi, app);
  app.use('/_api/v3', apiV3Router);
  // ... 300+ route definitions
};

// CURRENT: routes/page.js (typical route module)
module.exports = (crowi, app) => {
  const { Page } = crowi.models;
  const actions = {};
  actions.create = async (req, res) => { ... };
  return actions;
};
```

**Effort: XL (2+ weeks)** | **Risk: High** — `routes/apiv3/index.js` alone has 36 factory require+invoke patterns; circular dependency risks with ESM strict loading

### Requirement 3: Next.js transpilePackages Cleanup

| Asset | Status | Gap |
|-------|--------|-----|
| `getTranspilePackages()` in `next.config.ts` | 145 entries total | Must evaluate each post-ESM migration |
| Hardcoded entries (39) | unified/react-markdown ecosystem | **Research Needed** — which are still needed with Turbopack + ESM? |
| Dynamic entries (~99) | `listPrefixedPackages()` for remark-/rehype-/hast-/mdast-/micromark-/unist- | **Research Needed** — Turbopack may handle ESM natively for all |
| `experimentalOptimizePackageImports` (11) | @growi/* packages | Likely retainable (optimization, not CJS workaround) |

**Effort: L (1–2 weeks)** | **Risk: Medium** — each removal needs build + runtime verification; Turbopack ESM externalization behavior is not fully documented

### Requirement 4: pnpm Overrides and Dependency Constraint Removal

| Asset | Status | Gap |
|-------|--------|-----|
| `@lykmapipo/common>flat` → `5.0.2` | Transitive via `mongoose-gridfs` → `@lykmapipo/mongoose-common` | **Constraint** — `@lykmapipo/common` itself is CJS; even with ESM server, this package's internal `require()` of `flat` won't change |
| `@lykmapipo/common>mime` → `3.0.0` | Same chain | Same constraint |
| `@lykmapipo/common>parse-json` → `5.2.0` | Same chain | Same constraint |

**Important Finding**: These overrides exist because `@lykmapipo/common` (a third-party CJS package) internally `require()`s these dependencies. Making the GROWI server ESM does **not** fix this — the override is needed as long as `@lykmapipo/common` is CJS. However, Node.js 24's `require(esm)` may allow CJS packages to `require()` ESM-only packages, potentially removing the need for overrides.

**Effort: S (1 day)** | **Risk: Medium** — depends on Node.js 24 `require(esm)` behavior for transitive CJS→ESM chains

### Requirement 5: package.json Type Declaration

| Asset | Status | Gap |
|-------|--------|-----|
| Root `package.json` | No `"type": "module"` (has unrelated `"type": "git"`) | Must add `"type": "module"` |
| `apps/app/package.json` | No `"type"` field (defaults CJS) | Must add `"type": "module"` |
| `apps/slackbot-proxy/package.json` | No `"type"` field | **Out of scope** (deprecation planned) |
| CJS config files at root | Turbo config, pnpm workspace — all YAML/JSON | No `.js` configs found at root needing `.cjs` rename |
| CJS config files in apps/app | `config/migrate-mongo-config.js`, `config/logger/*.js`, `config/next-i18next.config.js`, `config/i18next.config.js` | Must rename to `.cjs` or convert |

**Effort: M (3–5 days)** | **Risk: Medium** — config file renames may break CLI tools (migrate-mongo, nodemon, etc.)

### Requirement 6: Build and Runtime Verification

| Asset | Status | Gap |
|-------|--------|-----|
| `turbo run build` | Currently passes with CJS server output | Must pass with ESM server output |
| `turbo run lint` | Biome + TypeScript checks | May surface new ESM-related type issues |
| `turbo run test` | Vitest-based | Vitest natively supports ESM; low risk |
| `assemble-prod.sh` | Workspace-root staging with `pnpm deploy --prod` | Must verify ESM modules resolve correctly in flat structure |
| `check-next-symlinks.sh` | Validates `.next/node_modules/` symlinks | Must verify post-transpilePackages cleanup |
| Production startup | `node -r dotenv-flow/config dist/server/app.js` | ESM entry needs `--import` instead of `-r` for loader hooks |

**Effort: M (3–5 days)** | **Risk: Medium**

### Requirement 7: Migration Documentation

| Asset | Status | Gap |
|-------|--------|-----|
| `// comments for dependencies` in package.json | Contains CJS/ESM pinning notes | Must update after migration |
| Steering docs (`.kiro/steering/tech.md`) | Documents transpilePackages, production assembly | Must update |

**Effort: S (1 day)** | **Risk: Low**

---

## 2. Implementation Approach Options

### Option A: Big-Bang Server Migration

Convert all server code to ESM in one pass: change tsconfig, convert all `module.exports` → `export`, all `require()` → `import`, update entry point.

**Trade-offs:**
- ✅ Single consistent state — no hybrid CJS/ESM period
- ✅ Can leverage codemods (e.g., `cjs-to-esm`, `jscodeshift`) for mechanical conversion
- ❌ Very large PR (200+ files changed simultaneously)
- ❌ Difficult to review and debug regressions
- ❌ Circular dependency issues surface all at once
- ❌ Blocks other development during migration

### Option B: Incremental Migration with `require(esm)` Bridge

Leverage Node.js 24's `require(esm)` to allow CJS code to `require()` ESM modules. Migrate file-by-file or directory-by-directory, converting each to ESM while the overall build remains CJS.

**Trade-offs:**
- ✅ Incremental — each step is independently verifiable
- ✅ `require(esm)` means CJS files can import already-converted ESM files
- ✅ Smaller PRs, easier review
- ❌ Extended hybrid period — some files ESM, others CJS
- ❌ `require(esm)` has limitations (top-level await not supported in required ESM)
- ❌ Must eventually flip tsconfig to ESM output anyway

### Option C: Hybrid — Phased Migration (Recommended Direction)

Phase the work by layer, with each phase independently deployable:

1. **Phase 1**: Convert remaining packages (trivial, S effort)
2. **Phase 2**: Add `"type": "module"` to root + apps/app, rename config files to `.cjs`
3. **Phase 3**: Change `tsconfig.build.server.json` to ESM output. Convert server code using codemods + manual review. This is the big phase.
4. **Phase 4**: Clean up transpilePackages (incremental removal + verification)
5. **Phase 5**: Remove pnpm overrides, verify production assembly, update docs

**Trade-offs:**
- ✅ Each phase is independently testable and deployable
- ✅ Phase 1-2 are low risk and can land immediately
- ✅ Phase 3 can be done as one large PR or split by directory
- ✅ Phase 4-5 are cleanup that can happen gradually
- ❌ More total PRs to manage
- ❌ Phase 3 is still large regardless of approach

---

## 3. Key Technical Concerns

### 3.1 Route Factory DI Pattern (Critical)

The `require('./route')(crowi, app)` pattern is the single largest migration challenge. ESM equivalent:

```javascript
// Option A: Top-level await (requires ESM entry point)
const { default: createPageRoutes } = await import('./page.js');
const page = createPageRoutes(crowi, app);

// Option B: Async initialization function
async function setupRoutes(crowi, app) {
  const { default: createPageRoutes } = await import('./page.js');
  const page = createPageRoutes(crowi, app);
  // ...
}

// Option C: Static imports (if circular deps allow)
import { createPageRoutes } from './page.js';
const page = createPageRoutes(crowi, app);
```

**Research Needed**: Whether static imports cause circular dependency issues in the Crowi DI graph.

### 3.2 Dev Server Startup

Current: `node -r ts-node/register/transpile-only -r tsconfig-paths/register`

ESM requires:
- **tsx**: `node --import tsx src/server/app.ts` (simplest, tsx supports ESM natively)
- **ts-node/esm**: `node --loader ts-node/esm` (deprecated loader API)
- **Node.js native**: `--experimental-strip-types` (Node.js 22+, but limited)
- **tsconfig-paths**: Needs replacement — `tsconfig-paths/register` is CJS-only. Alternatives: `tsx` handles paths natively, or use Node.js `--conditions` + `imports` field.

**Research Needed**: Best ESM-compatible TypeScript runner for dev mode.

### 3.3 Production Entry Point

Current: `node -r dotenv-flow/config dist/server/app.js`

ESM equivalent: `node --import dotenv-flow/config dist/server/app.js`

**Constraint**: `dotenv-flow/config` must support ESM `--import` hook. If not, use `dotenv-flow` programmatically in `app.ts`.

### 3.4 Migration Files

60+ migration files in `src/migrations/` use `require('mongoose')`. Options:
- Rename all to `.cjs` (safest — migrate-mongo CLI loads them directly)
- Convert to ESM if migrate-mongo supports it
- Keep as-is if they're excluded from `tsconfig.build.server.json`

**Research Needed**: Whether migrate-mongo supports ESM migration files.

### 3.5 Circular Dependencies

ESM has stricter module loading than CJS. CJS tolerates circular requires by returning partial exports; ESM may throw `ReferenceError` for uninitialized bindings. The Crowi bootstrap → routes → models → services graph needs audit.

**Research Needed**: Map the dependency graph of `crowi/index.ts` to identify circular chains.

---

## 4. Effort and Risk Summary

| Requirement | Effort | Risk | Justification |
|-------------|--------|------|---------------|
| Req 1: Shared packages | **S** (1 day) | Low | Zero CJS source code; config-only changes |
| Req 2: Server layer | **XL** (2+ weeks) | High | 43 factory routes, DI pattern refactor, dev server changes |
| Req 3: transpilePackages | **L** (1–2 weeks) | Medium | 145 entries need individual verification |
| Req 4: pnpm overrides | **S** (1 day) | Medium | Depends on `require(esm)` for transitive CJS→ESM |
| Req 5: Type declaration | **M** (3–5 days) | Medium | Config file renames, CLI tool compatibility |
| Req 6: Verification | **M** (3–5 days) | Medium | Production assembly + runtime testing |
| Req 7: Documentation | **S** (1 day) | Low | Straightforward updates |

**Total estimated effort: XL (4–6 weeks)**

---

## 5. Research Items for Design Phase

1. **Codemod tooling**: Evaluate `cjs-to-esm`, `jscodeshift`, or custom AST transforms for mechanical `require` → `import` conversion
2. **ESM dev server**: Compare `tsx` vs `ts-node/esm` vs `@swc-node/register` for dev-time ESM transpilation with path alias support
3. **Circular dependency audit**: Map the Crowi bootstrap dependency graph to identify cycles
4. **migrate-mongo ESM support**: Verify whether migration files can be ESM or must remain `.cjs`
5. **Turbopack ESM externalization**: Test removing a few transpilePackages entries to understand Turbopack's behavior with ESM externals
6. **`dotenv-flow` ESM hook**: Verify `--import dotenv-flow/config` works in Node.js 24
7. **`@lykmapipo/common` + `require(esm)`**: Test whether Node.js 24 allows CJS packages to `require()` ESM-only transitive deps without overrides
