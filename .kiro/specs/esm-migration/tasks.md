# Implementation Plan

## Phase 1: Remaining Shared Packages ESM Conversion

- [ ] 1. Convert remaining shared packages to ESM declarations
- [ ] 1.1 (P) Convert `@growi/pdf-converter-client` to ESM
  - Add `"type": "module"` to `package.json`
  - Update `tsconfig.json` to use `"module": "ESNext"` and `"moduleResolution": "Bundler"` if not already set
  - Rename `orval.config.js` to `orval.config.cjs` to preserve CJS semantics for the Orval CLI
  - Verify `turbo run build --filter @growi/pdf-converter-client` passes
  - _Requirements: 1.1, 1.3_

- [ ] 1.2 (P) Convert `@growi/preset-templates` to ESM
  - Add `"type": "module"` to `package.json`
  - This package has no JS source (plugin data only); conversion is config-only
  - Verify build passes
  - _Requirements: 1.1, 1.3_

- [ ] 1.3 (P) Convert `@growi/preset-themes` to ESM
  - Add `"type": "module"` to `package.json`
  - Retain Vite dual (ES + UMD) output — the CJS fallback stays until all consumers are verified ESM-only
  - Verify `turbo run build --filter @growi/preset-themes` passes
  - _Requirements: 1.1, 1.2, 1.3_

- [ ] 1.4 (P) Convert `@growi/core-styles` and `@growi/custom-icons` to ESM
  - Add `"type": "module"` to both `package.json` files
  - These packages have no JS output (SCSS/SVG only); declaration is for consistency
  - Verify builds pass for both packages
  - _Requirements: 1.1, 1.3_

- [ ] 1.5 Verify all shared packages build successfully together
  - Run `turbo run build` for all 5 converted packages
  - Confirm no downstream consumer breakage across the monorepo
  - _Requirements: 1.4_

## Phase 2: Type Declarations and Config File Renames

- [ ] 2. Declare `"type": "module"` in root and app, rename CJS config files
- [ ] 2.1 Add `"type": "module"` to root and `apps/app` package.json
  - Add the field to the monorepo root `package.json`
  - Add the field to `apps/app/package.json`
  - _Requirements: 5.1, 5.2_

- [ ] 2.2 Rename CJS config files in `apps/app` to `.cjs`
  - Rename `config/migrate-mongo-config.js` → `.cjs`
  - Rename `config/next-i18next.config.js` → `.cjs`
  - Rename `config/i18next.config.js` → `.cjs`
  - Rename `config/logger/config.dev.js` → `.cjs`
  - Rename `config/logger/config.prod.js` → `.cjs`
  - _Requirements: 5.3_

- [ ] 2.3 Update all references to renamed config files
  - Update `package.json` `migrate` script and any CLI arguments that reference `migrate-mongo-config.js`
  - Update i18next initialization code that imports `next-i18next.config` and `i18next.config`
  - Update logger initialization that references `config.dev.js` / `config.prod.js`
  - Update `next.config.prod.cjs` if it references `next-i18next.config.js` by name
  - Grep the codebase for all remaining references to old filenames and fix them
  - _Requirements: 5.3_

- [ ] 2.4 Verify Phase 2 builds pass
  - Run `turbo run build` for all workspaces
  - Verify no broken config file references at build time
  - _Requirements: 5.4_

## Phase 3: Server Code ESM Migration

- [ ] 3. Migrate the Express server layer from CJS to ESM
- [ ] 3.1 Fix circular dependencies in model → service imports
  - In `models/user/index.js`, move the top-level `import { configManager }` and `import { aclService }` into the model factory body where the `crowi` parameter is available
  - Extract `configManager` and `aclService` from `crowi` at runtime instead of importing at module level
  - Audit other model files for similar top-level service imports using grep; fix any found
  - Verify existing tests still pass after the refactor
  - _Requirements: 2.2_

- [ ] 3.2 Write the jscodeshift custom transform for CJS → ESM conversion
  - Create a jscodeshift transform that handles all 4 CJS patterns:
    - Pattern 1: `module.exports = (crowi, app) => { ... }` → `export default function(crowi, app) { ... }`
    - Pattern 2: `const x = require('module')` → `import x from 'module'`
    - Pattern 3: `require('./page')(crowi, app)` → static import + factory call
    - Pattern 4: `__dirname` → `import.meta.dirname`
  - Add `.js` extensions to all relative import specifiers
  - Test the transform on a representative sample of files (one route, one middleware, one service, one util) and verify output correctness
  - _Requirements: 2.2, 2.3, 2.4, 2.5_
  - _Contracts: CodemodTransform Service_

- [ ] 3.3 Run codemod on all server source files
  - Execute the jscodeshift transform across `apps/app/src/server/` (82 files with `module.exports`, 179 `require()` occurrences)
  - Focus particular attention on `routes/apiv3/index.js` (36 factory require+invoke) and `routes/index.js` (9 factory patterns)
  - Static imports are safe for all factory patterns — each route module is a leaf receiving `crowi` as parameter
  - _Requirements: 2.2, 2.3_

- [ ] 3.4 Run ts2esm to fix import extensions
  - Execute ts2esm as a second pass to add `.js` extensions to any remaining extensionless relative imports
  - Verify all relative imports in the server directory include file extensions
  - _Requirements: 2.3_

- [ ] 3.5 Manually convert dynamic require patterns
  - Convert runtime-computed `require(modulePath)` in `service/s2s-messaging/index.ts` to `await import(modulePath)`
  - Convert runtime-computed `require(modulePath)` in `service/file-uploader/index.ts` to `await import(modulePath)`
  - Review conditional requires (ternary patterns) and convert to conditional `await import()`
  - Ensure wrapping functions are marked `async` where needed
  - _Requirements: 2.5_

- [ ] 3.6 Update `tsconfig.build.server.json` to ESM output
  - Change `"module": "CommonJS"` → `"module": "NodeNext"`
  - Change `"moduleResolution": "Node"` → `"moduleResolution": "NodeNext"`
  - This step runs AFTER codemod because `NodeNext` rejects `require()` in ESM context
  - Verify `turbo run build --filter @growi/app` succeeds with the new config
  - _Requirements: 2.1_
  - _Contracts: ServerBuildConfig Config_

- [ ] 3.7 Replace ts-node with tsx for dev server
  - Add `tsx` to `apps/app` devDependencies
  - Update the `ts-node` script in `package.json`: `node -r ts-node/register/transpile-only -r tsconfig-paths/register -r dotenv-flow/config` → `node --import tsx --import dotenv-flow/config`
  - Remove the `ts-node` override section from `apps/app/tsconfig.json` (the CJS `"module": "CommonJS"` override)
  - Verify `pnpm run dev` starts the server correctly with tsx
  - Remove `ts-node`, `tsconfig-paths` from devDependencies if no longer used elsewhere
  - _Requirements: 2.6_
  - _Contracts: DevServerConfig Config_

- [ ] 3.8 Update production entry point for ESM
  - Change production startup from `node -r dotenv-flow/config dist/server/app.js` to `node --import dotenv-flow/config dist/server/app.js`
  - Update the command in `Dockerfile` and/or `docker-compose.yml` if applicable
  - Verify the compiled ESM output at `dist/server/app.js` starts and serves requests
  - _Requirements: 2.6, 6.4, 6.5_
  - _Contracts: ProdEntryConfig Config_

- [ ] 3.9 Verify Phase 3 build, lint, and test
  - Run `turbo run build --filter @growi/app` and verify success
  - Run `turbo run lint --filter @growi/app` and verify no new warnings
  - Run `turbo run test --filter @growi/app` and verify no new failures
  - Confirm no `require()` or `module.exports` patterns remain in converted files (grep check)
  - _Requirements: 2.6, 2.7, 6.1, 6.2, 6.3_

## Phase 4: Cleanup

- [ ] 4. Remove transpilePackages entries and pnpm overrides
- [ ] 4.1 Remove @growi/* packages from transpilePackages
  - Evaluate and remove first-party @growi/* entries from `getTranspilePackages()` in `next.config.ts`
  - Verify build and SSR runtime resolution for each removed entry
  - Document any entries that must be retained with justification in code comments
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [ ] 4.2 Remove unified/remark/rehype ecosystem from transpilePackages
  - Test removing the `listPrefixedPackages()` dynamic block (remark-/rehype-/hast-/mdast-/micromark-/unist- prefixes) as a batch
  - If batch removal causes errors, fall back to incremental removal per prefix group
  - Verify Turbopack SSR resolves these ESM packages correctly without forced transpilation
  - Retain entries that cause `ERR_MODULE_NOT_FOUND` or `ERR_REQUIRE_ESM` and document
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [ ] 4.3 Remove remaining hardcoded transpilePackages entries
  - Evaluate the ~40 hardcoded entries individually or in small groups
  - Verify build + runtime after each removal batch
  - Confirm the final `transpilePackages` list contains only packages genuinely requiring forced transpilation
  - _Requirements: 3.1, 3.4, 3.5_

- [ ] 4.4 (P) Remove pnpm.overrides for `@lykmapipo/common` transitive dependencies
  - Remove the `flat` override (pinned to 5.0.2) — test with `pnpm install && turbo run build`
  - Remove the `mime` override (pinned to 3.0.0) — test with `pnpm install && turbo run build`
  - Remove the `parse-json` override (pinned to 5.2.0) — test with `pnpm install && turbo run build`
  - Node.js 24 `require(esm)` allows CJS packages to `require()` ESM-only deps (no top-level await in these packages)
  - If any removal causes failures, retain the override and document the reason
  - _Requirements: 4.1, 4.2, 4.3, 4.4_

## Phase 5: Full Verification and Documentation

- [ ] 5. End-to-end verification and documentation updates
- [ ] 5.1 Run full monorepo build, lint, and test
  - Execute `turbo run build` for all workspaces and verify success
  - Execute `turbo run lint` for all workspaces and verify pass
  - Execute `turbo run test` for all workspaces and verify no new failures
  - _Requirements: 6.1, 6.2, 6.3_

- [ ] 5.2 Verify production assembly and runtime
  - Run `assemble-prod.sh` and verify it produces a working artifact
  - Start the production server and verify Express, Next.js SSR, and WebSocket connections function correctly
  - Verify `check-next-symlinks.sh` passes after transpilePackages cleanup
  - _Requirements: 6.4, 6.5_

- [ ] 5.3 Update package.json dependency comments
  - Remove obsolete CJS/ESM pinning notes from `// comments for dependencies` blocks
  - Add justification comments for any remaining `transpilePackages` entries
  - Document packages with special constraints (handsontable license pinning, @keycloak deferred upgrade)
  - _Requirements: 7.1, 7.2, 7.3_

- [ ] 5.4 Update steering and project documentation
  - Update `.kiro/steering/tech.md` to reflect ESM architecture
  - Update production assembly documentation if the startup command changed
  - Remove outdated references to CJS workarounds in project docs
  - _Requirements: 7.1, 7.2, 7.3_
