# Research & Design Decisions: ESM Migration

---
**Purpose**: Capture discovery findings, architectural investigations, and rationale that inform the ESM migration technical design.
---

## Summary
- **Feature**: `esm-migration`
- **Discovery Scope**: Complex Integration (full monorepo CJS-to-ESM migration)
- **Key Findings**:
  - The factory DI pattern (`require('./route')(crowi, app)`) across 43+ route files is the critical migration challenge — no off-the-shelf codemod handles it
  - Circular dependencies exist between models and services (e.g., `models/user` imports `configManager` which dynamically imports `models/config`) — ESM strict loading will expose these
  - `module: "NodeNext"` with `moduleResolution: "NodeNext"` is the correct tsconfig setting for the server build targeting Node.js 24

## Research Log

### Codemod Tooling for CJS-to-ESM Conversion

- **Context**: 84 static requires, 43 factory-pattern exports, 25 require+invoke patterns need conversion
- **Sources Consulted**: npm registries for cjstoesm, commonjs-to-es-module-codemod, lebab, ts2esm; GitHub issues; Total TypeScript blog
- **Findings**:
  - `cjstoesm` (wessberg): Handles static `require()` → `import` and `module.exports` → `export default` well. Adds `.js` extensions. Cannot handle `require('./page')(crowi, app)` immediate invoke patterns. Known issues with newer TypeScript versions.
  - `jscodeshift` + `commonjs-to-es-module-codemod` (azu): Extensible via custom transforms. Can handle all patterns including factory DI with a custom ~50-100 line transform. Works with TypeScript files via `--extensions ts`.
  - `lebab`: No TypeScript support, limited CJS transform, unmaintained. Not suitable.
  - `ts2esm` (bennycode): Only adds `.js` extensions to existing ESM imports. Does NOT convert require/exports. Useful as a second pass.
  - ESLint plugins: `import/no-commonjs` can flag remaining CJS patterns (no auto-fix). `eslint-plugin-import-x` extensions rule can auto-fix missing `.js` extensions.
  - TypeScript compiler: Does NOT convert CJS syntax; it only changes output format based on `module` setting. Useful for enforcement after conversion.
- **Implications**: Use jscodeshift with a custom transform for all patterns (single tool), followed by ts2esm for extension fixing and eslint for enforcement.

### tsconfig Module Settings for Node.js 24 ESM

- **Context**: Server build currently uses `"module": "CommonJS"`, `"moduleResolution": "Node"`. Needs ESM output.
- **Sources Consulted**: TypeScript docs, Total TypeScript blog (Matt Pocock), Andrew Branch's blog on NodeNext for libraries
- **Findings**:
  - `"module": "NodeNext"` emits ESM or CJS per-file based on nearest `package.json` `"type"` field. Enforces `.js` extensions in imports at compile time.
  - `"module": "ESNext"` always emits ESM syntax regardless of context. Does not enforce extensions.
  - `"moduleResolution": "NodeNext"` matches Node.js runtime resolution. Required for `"module": "NodeNext"`.
  - `"moduleResolution": "Bundler"` allows bare specifiers and extensionless imports — suitable for bundled code (Next.js frontend) but NOT for Node.js direct execution.
- **Implications**: Server build must use `NodeNext`/`NodeNext`. Base tsconfig (`ESNext`/`Bundler`) stays for bundled packages. Server tsconfig overrides these.

| Context | module | moduleResolution | Rationale |
|---------|--------|------------------|-----------|
| Server build (Node.js 24) | NodeNext | NodeNext | Direct Node.js execution; enforces ESM correctness |
| Next.js frontend | ESNext | Bundler | Turbopack handles resolution |
| Shared packages (bundled) | ESNext | Bundler | Consumed via bundler |

### Circular Dependency Analysis

- **Context**: ESM has stricter module loading than CJS. CJS tolerates circular requires by returning partial exports; ESM throws `ReferenceError` for uninitialized bindings.
- **Sources Consulted**: Direct codebase analysis of crowi/index.ts, routes/index.js, models/*, services/*
- **Findings**:
  - **Pattern A — Model → Service at module level**: `models/user/index.js` imports `configManager` and `aclService` at module top level. `configManager` dynamically imports `models/config`. This is a circular chain masked by CJS lazy evaluation.
  - **Pattern B — Crowi → Routes → Middleware → Crowi instance**: `crowi/index.ts` dynamically imports `routes/index.js` which creates middleware factories requiring `crowi` parameter. No direct circular import but tight coupling.
  - **Pattern C — Service ↔ Crowi backreference**: `service/app.ts:94` calls `crowi.setupRoutesAtLast()` — a callback loop.
  - **Pattern D — Dynamic requires with runtime paths**: `service/s2s-messaging/index.ts:60` and `service/file-uploader/index.ts:16` use `require(modulePath)(crowi)` with runtime-computed paths.
- **Implications**: Pattern A is the highest risk — models importing service singletons at module level may cause initialization deadlocks under ESM. The factory DI pattern (B) is actually safe because `crowi` is passed as a runtime argument, not imported. Pattern D must convert to `await import()`.

### Dev Server Startup (ESM TypeScript Runner)

- **Context**: Current setup uses `node -r ts-node/register/transpile-only -r tsconfig-paths/register -r dotenv-flow/config`. CJS-only.
- **Sources Consulted**: tsx docs, ts-node ESM docs, Node.js strip-types docs
- **Findings**:
  - **tsx**: Recommended. Supports ESM natively via `--import tsx`. Handles path aliases via tsconfig `paths`. Compatible with Node.js 24. Command: `node --import tsx src/server/app.ts`
  - **ts-node/esm**: Deprecated `--loader` API. `--import ts-node/esm` available but tsx is simpler and faster.
  - **Node.js native `--experimental-strip-types`**: Available in Node.js 22+, unflagged in 24. Does NOT handle path aliases or advanced TypeScript features (decorators, enum). Not sufficient for GROWI.
  - **tsconfig-paths**: CJS-only via `-r`. For ESM, tsx handles paths natively; alternatively use Node.js `imports` field in package.json.
- **Implications**: Replace `ts-node` + `tsconfig-paths` with `tsx` for dev. Keeps path alias support without extra tooling.

### Production Entry Point

- **Context**: Currently `node -r dotenv-flow/config dist/server/app.js`. The `-r` flag is for CJS preloading.
- **Findings**:
  - `dotenv-flow` v4+ supports `--import dotenv-flow/config` for ESM preloading.
  - Node.js 24 `--import` flag is the ESM equivalent of `-r`.
  - Command becomes: `node --import dotenv-flow/config dist/server/app.js`
- **Implications**: Simple one-line change. Verify dotenv-flow version in package.json.

### migrate-mongo ESM Support

- **Context**: 60+ migration files in `src/migrations/` use `require('mongoose')`.
- **Findings**:
  - migrate-mongo internally uses `require()` to load migration files and config. As of v10.x, it does NOT support ESM migration files.
  - Node.js 24's `require(esm)` may allow migrate-mongo to `require()` ESM files, but this is untested.
  - Migration files are not part of `tsconfig.build.server.json` compilation — they are raw JS files.
- **Implications**: Safest approach: rename migration files to `.cjs` or keep as `.js` in a directory with its own `package.json` declaring `"type": "commonjs"`. The config file (`migrate-mongo-config.js`) should be renamed to `.cjs`.

### Config Files Requiring CJS

- **Context**: Multiple config files in `apps/app/config/` use `require()` syntax.
- **Files analyzed**:
  - `config/migrate-mongo-config.js`: Conditional require of dev/prod mongoose utils. Rename to `.cjs`.
  - `config/next-i18next.config.js`: Multiple `require()` calls for i18next backends. Rename to `.cjs`.
  - `config/i18next.config.js`: Simple require from `@growi/core`. Rename to `.cjs`.
  - `config/logger/config.dev.js`, `config.prod.js`: Logger configuration. Rename to `.cjs`.
  - `next.config.prod.cjs`: Already `.cjs`. No change needed.
  - `packages/pdf-converter-client/orval.config.js`: Orval code generation config. Rename to `.cjs`.
- **Implications**: Renaming to `.cjs` is the safest approach — these files are consumed by CLIs and tools that expect CJS, and converting them to ESM may break tool compatibility.

### pnpm Overrides and require(esm)

- **Context**: Overrides pin `flat`, `mime`, `parse-json` to CJS versions for `@lykmapipo/common`.
- **Findings**:
  - `@lykmapipo/common` is a third-party CJS package that internally `require()`s these dependencies.
  - Node.js 24's `require(esm)` allows CJS code to `require()` ESM-only packages (with limitations: no top-level await in the ESM module).
  - `flat` v6, `mime` v4, `parse-json` v7 are ESM-only but do not use top-level await.
- **Implications**: With Node.js 24, the overrides should be removable. Test by removing one at a time and running `pnpm install && turbo run build`.

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| Big-Bang | Convert all server code in one pass | Single consistent state; leverages codemods | Very large PR; difficult to debug; blocks development | Not recommended for 200+ file changes |
| Incremental with require(esm) | Migrate file-by-file using Node.js 24 bridge | Small PRs; independently verifiable | Extended hybrid period; must still flip tsconfig eventually | Viable but slower |
| **Phased Migration** | Layer-by-layer with each phase independently testable | Each phase deployable; Phase 1-2 are trivial; Phase 3 can be one large PR or split | More total PRs; Phase 3 is still large | **Selected approach** |

## Design Decisions

### Decision: Phased Migration Strategy

- **Context**: 200+ files need conversion. Big-bang is risky; pure incremental is slow.
- **Alternatives Considered**:
  1. Big-bang — all at once with codemods
  2. File-by-file incremental with require(esm) bridge
  3. Phased by architectural layer
- **Selected Approach**: Phased migration in 5 phases, ordered by dependency (packages → type declarations → server code → transpilePackages cleanup → overrides/docs)
- **Rationale**: Each phase is independently testable and deployable. Early phases (packages, type declarations) are trivial and land immediately. The large server migration (Phase 3) can be done as one PR using jscodeshift.
- **Trade-offs**: More PRs to manage, but each is verifiable and reversible.

### Decision: jscodeshift for Codemod Tooling

- **Context**: Multiple CJS patterns need automated conversion.
- **Alternatives Considered**:
  1. cjstoesm — cannot handle require+invoke patterns
  2. jscodeshift with custom transform — handles all patterns
  3. Manual conversion — error-prone for 200+ files
- **Selected Approach**: jscodeshift with a custom ~50-100 line transform targeting all 4 GROWI patterns
- **Rationale**: Single tool handles all patterns. Custom transform can be tested on sample files before running on full codebase.
- **Follow-up**: Write and test the custom transform before running on production code.

### Decision: NodeNext Module Resolution for Server Build

- **Context**: Server code runs directly in Node.js (not bundled).
- **Alternatives Considered**:
  1. `module: "ESNext"` + `moduleResolution: "Bundler"` — does not enforce extensions
  2. `module: "NodeNext"` + `moduleResolution: "NodeNext"` — enforces ESM correctness
- **Selected Approach**: `NodeNext`/`NodeNext` for `tsconfig.build.server.json`
- **Rationale**: Server code is executed directly by Node.js. `NodeNext` enforces `.js` extensions and correct ESM semantics at compile time, catching errors before runtime.

### Decision: tsx for Dev Server

- **Context**: Need ESM-compatible TypeScript runner with path alias support.
- **Alternatives Considered**:
  1. ts-node/esm — deprecated loader API
  2. tsx — modern, fast, supports ESM + paths
  3. Node.js --experimental-strip-types — no path alias support
- **Selected Approach**: Replace `ts-node` + `tsconfig-paths` with `tsx`
- **Rationale**: Single tool replaces two. Supports ESM natively. Handles tsconfig path aliases without additional configuration. Actively maintained.

### Decision: Rename CJS Config Files to .cjs

- **Context**: Config files consumed by CLIs (migrate-mongo, nodemon, i18next) use `require()`.
- **Alternatives Considered**:
  1. Convert to ESM — risky, may break CLI tools
  2. Rename to `.cjs` — safe, preserves CJS semantics
  3. Add per-directory `package.json` with `"type": "commonjs"` — adds complexity
- **Selected Approach**: Rename to `.cjs`
- **Rationale**: Explicit file extension is the Node.js-recommended approach. No behavioral change; just makes the CJS intent explicit.

## Risks & Mitigations

- **Circular dependency deadlocks under ESM** — Audit model→service imports; refactor `models/user/index.js` to lazy-load `configManager` and `aclService` instead of top-level imports
- **migrate-mongo incompatibility with ESM** — Keep migration files as CJS (`.cjs` or per-directory `"type": "commonjs"`)
- **transpilePackages removal breaks SSR** — Remove entries one at a time with build + runtime verification; retain entries that fail
- **Production assembly regression** — Full end-to-end test of `assemble-prod.sh` after each phase
- **Third-party CJS packages break** — Node.js 24 `require(esm)` mitigates most cases; override pins remain as fallback

## References

- [TypeScript: Choosing Compiler Options](https://www.typescriptlang.org/docs/handbook/modules/guides/choosing-compiler-options.html)
- [tsx - TypeScript Execute](https://tsx.is/)
- [wessberg/cjstoesm](https://github.com/wessberg/cjstoesm)
- [azu/commonjs-to-es-module-codemod](https://github.com/azu/commonjs-to-es-module-codemod)
- [bennycode/ts2esm](https://github.com/bennycode/ts2esm)
- [Node.js: require(esm)](https://nodejs.org/api/modules.html#loading-ecmascript-modules-using-require)
- [dotenv-flow ESM support](https://github.com/kerimdzhanov/dotenv-flow)
