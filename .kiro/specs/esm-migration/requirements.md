# Requirements Document

## Introduction

The GROWI monorepo currently operates in a hybrid CJS/ESM state: 12 of 16 shared packages already declare `"type": "module"`, but the two main applications — `apps/app` (server layer) — still compiles to CommonJS. This forces a 48-entry `transpilePackages` workaround in `next.config.ts`, `pnpm.overrides` that pin ESM-only transitive dependencies to old CJS versions, and a growing maintenance burden.

The goal is to migrate the entire repository to native ESM, eliminating CJS output, removing the `transpilePackages` workaround, and aligning with the Node.js 24 ecosystem where ESM is the default module system.

### Key Context from `upgrade-fixed-packages`

- Node.js ^24 provides stable `require(esm)` and native `RegExp.escape()` (ES2026 Stage 4).
- The `transpilePackages` list in `next.config.ts` was identified as a future cleanup target — its removal depends on full ESM adoption.
- `pnpm.overrides` force CJS versions of `flat`, `mime`, and `parse-json` for `@lykmapipo/common` — these can be removed once the server layer is ESM.
- `@keycloak/keycloak-admin-client` (ESM-only from v19+) was deferred due to API breaking changes; full ESM migration enables the upgrade path.

### Current State Summary

| Category | Package Count | ESM Status |
|----------|:------------:|------------|
| Shared packages (`packages/*`) | 11 / 16 | Already ESM |
| Remaining CJS packages | 5 | `pdf-converter-client`, `preset-templates`, `preset-themes`, `core-styles`, `custom-icons` |
| `apps/pdf-converter` | 1 | Already ESM |
| `apps/app` (client/Next.js) | 1 | ESM-compatible (Turbopack) |
| `apps/app` (server/Express) | 1 | **CommonJS** — 82 files with `module.exports`, 179 `require()` across 57 files, 3 `__dirname` files |
| `apps/slackbot-proxy` | 1 | **CommonJS** (out of scope — scheduled for deprecation) |

## Requirements

### Requirement 1: Remaining Shared Packages ESM Conversion

**Objective:** As a maintainer, I want all shared packages in `packages/` to declare `"type": "module"` and output ESM, so that the monorepo has a uniform module system at the library layer.

#### Acceptance Criteria

1. The build system shall produce ESM output for `@growi/pdf-converter-client`, `@growi/preset-templates`, `@growi/preset-themes`, `@growi/core-styles`, and `@growi/custom-icons`.
2. When a package already provides dual (ESM + CJS) output via Vite, the build system shall retain the CJS output as a fallback until all consumers are verified ESM-compatible.
3. When converting a package, the migration process shall add `"type": "module"` to `package.json` and update `tsconfig.json` to use `"module": "ESNext"` and `"moduleResolution": "Bundler"`.
4. When all shared packages are converted, the build system shall pass `turbo run build` for all affected packages without errors.

### Requirement 2: apps/app Server Layer ESM Migration

**Objective:** As a maintainer, I want the Express server layer of `apps/app` to compile to ESM instead of CommonJS, so that ESM-only dependencies can be imported natively and the `transpilePackages` workaround can be removed.

#### Acceptance Criteria

1. The server build (`tsconfig.build.server.json`) shall output ESM modules (`"module": "NodeNext"`, `"moduleResolution": "NodeNext"`) instead of CommonJS.
2. When migrating server code, all `module.exports` statements shall be replaced with ES `export` syntax.
3. When migrating server code, all static `require()` calls shall be replaced with ES `import` statements.
4. When migrating server code, all `__dirname` and `__filename` references shall be replaced with `import.meta.url`-based equivalents (e.g., `import.meta.dirname` available in Node.js 21.2+, or `fileURLToPath(import.meta.url)`).
5. When migrating dynamic `require()` patterns (e.g., `dynamicImport()` helper), the migration process shall replace them with dynamic `import()` expressions.
6. When the server layer migration is complete, `turbo run build --filter @growi/app` shall succeed and the Express server shall start and serve requests correctly.
7. When the server layer migration is complete, `turbo run test --filter @growi/app` shall pass without new failures.

### Requirement 3: Next.js transpilePackages Cleanup

**Objective:** As a maintainer, I want to remove or significantly reduce the `transpilePackages` list in `next.config.ts`, so that ESM packages are resolved natively by Turbopack/Node.js instead of being force-bundled.

#### Acceptance Criteria

1. When all server code outputs ESM, the migration process shall evaluate each entry in the `transpilePackages` list (currently 48+ packages) for removal.
2. When an entry is removed from `transpilePackages`, the build system shall verify that Turbopack SSR can resolve the package correctly (either by bundling it naturally or by externalizing it to `.next/node_modules/`).
3. If removing an entry causes `ERR_MODULE_NOT_FOUND` or `ERR_REQUIRE_ESM` at runtime, the migration process shall document the failure and retain that entry.
4. When the cleanup is complete, the `transpilePackages` list shall contain only packages that genuinely require forced transpilation (not those that were listed solely due to CJS/ESM incompatibility).
5. When the cleanup is complete, `turbo run build --filter @growi/app` and runtime startup shall succeed.

### Requirement 4: pnpm Overrides and Dependency Constraint Removal

**Objective:** As a maintainer, I want to remove `pnpm.overrides` entries that pin ESM-only packages to old CJS versions, so that transitive dependencies can receive updates.

#### Acceptance Criteria

1. When the server layer is ESM-native, the migration process shall evaluate each CJS-forcing override in root `package.json` (`flat`, `mime`, `parse-json` for `@lykmapipo/common`) for removal.
2. When removing an override, the build system shall verify that the ESM version of the transitive dependency resolves correctly.
3. If removing an override causes build or runtime failures, the migration process shall document the reason and retain the override.
4. When the cleanup is complete, `pnpm install` and `turbo run build` shall succeed without errors.

### Requirement 5: package.json Type Declaration

**Objective:** As a maintainer, I want every `package.json` in the monorepo to explicitly declare `"type": "module"`, so that Node.js treats all `.js` files as ESM by default.

#### Acceptance Criteria

1. The root `package.json` shall declare `"type": "module"`.
2. When a workspace package does not yet have `"type": "module"`, the migration process shall add it.
3. When `"type": "module"` is added, any configuration files that must remain CJS (e.g., legacy config files) shall be renamed to `.cjs` extension.
4. When all `package.json` files declare `"type": "module"`, the build system shall pass `turbo run build` for all workspaces.

### Requirement 6: Build and Runtime Verification

**Objective:** As a maintainer, I want comprehensive verification that the ESM migration does not introduce regressions, so that the application remains fully functional.

#### Acceptance Criteria

1. When the full migration is complete, `turbo run build` (all workspaces) shall succeed.
2. When the full migration is complete, `turbo run lint` (all workspaces) shall pass.
3. When the full migration is complete, `turbo run test` (all workspaces) shall pass without new failures.
4. When the full migration is complete, the production assembly (`assemble-prod.sh`) shall produce a working artifact.
5. When the production artifact is started, the Express server, Next.js SSR, and WebSocket connections shall function correctly.
6. If a migration step causes verification failures, the migration process shall isolate and fix the issue before proceeding to subsequent steps.

### Requirement 7: Migration Documentation

**Objective:** As a maintainer, I want the migration decisions and remaining constraints documented, so that future contributors understand the ESM architecture.

#### Acceptance Criteria

1. When the migration is complete, the `// comments for dependencies` blocks in `package.json` files shall be updated to remove obsolete CJS/ESM pinning notes.
2. When packages remain with special constraints (e.g., handsontable license pinning, @keycloak API breaking changes), the documentation shall explain why they are not affected by or exempt from ESM migration.
3. When the `transpilePackages` list is modified, any remaining entries shall have documented justification in code comments.
