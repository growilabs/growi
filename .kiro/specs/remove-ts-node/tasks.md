# Implementation Plan

- [ ] 1. Convert enum UploadStatus to const object
- [ ] 1.1 (P) Replace the enum declaration with a const object and type union in the multipart uploader module
  - Change `enum UploadStatus { BEFORE_INIT, IN_PROGRESS, COMPLETED, ABORTED }` to a `const` object with `as const` and a corresponding type alias
  - Preserve numeric values (0, 1, 2, 3) to maintain identical runtime behavior
  - Verify all consumers use named member access (`UploadStatus.BEFORE_INIT`) — no reverse numeric lookups
  - _Requirements: 1.1, 1.2, 1.3_
  - _Contracts: EnumToConstConversion Service_

- [ ] 1.2 (P) Run existing unit tests for the multipart uploader to confirm the const conversion is behavior-preserving
  - Execute the multipart-uploader spec covering all upload status transitions and error cases
  - Confirm GCS and AWS multipart uploader subclasses pass without modification
  - _Requirements: 8.2_

- [ ] 2. Rename server-side .js files to .ts
- [ ] 2.1 Rename all 64 `.js` files in `apps/app/src/server/` to `.ts` using `git mv`
  - Rename the 52 files that use ESM `import` syntax (mandatory — these fail without ts-node transpilation)
  - Rename the 12 pure CJS files for consistency (recommended — `require`/`module.exports` is valid TypeScript)
  - Use `git mv` for each file to preserve git blame history
  - No content changes inside any file — ESM `import` + `module.exports` is valid TypeScript with `esModuleInterop: true`
  - Callers import these files via path aliases (`~/`, `^/`) or relative paths without extensions, so no caller modifications are needed
  - _Requirements: 4.1, 4.2, 4.3_

- [ ] 2.2 Verify typecheck and lint pass after renames
  - Run `pnpm lint:typecheck` in apps/app directory to confirm TypeScript accepts the renamed files
  - Run `pnpm lint:biome` in apps/app directory to confirm no lint regressions
  - Fix any type errors that surface from stricter checking on newly-typed files (if any)
  - _Requirements: 8.3_

- [ ] 3. Update package.json scripts to use native Node.js TypeScript execution
- [ ] 3.1 Replace the `ts-node` composite script with `node-dev` in `apps/app/package.json`
  - Rename script key from `ts-node` to `node-dev`
  - Change value from `node -r ts-node/register/transpile-only -r tsconfig-paths/register -r dotenv-flow/config` to `node -r tsconfig-paths/register -r dotenv-flow/config`
  - Update all 4 callers: `dev`, `launch-dev:ci`, `dev:migrate-mongo`, `repl` — change `pnpm run ts-node` to `pnpm run node-dev` (and `npm run ts-node` to `pnpm run node-dev` in `repl`)
  - Verify `dotenv-flow/config` remains in the preload chain for environment variable loading
  - Verify `tsconfig-paths/register` remains in the preload chain for path alias resolution
  - _Requirements: 1.1, 1.2, 1.3, 1.6, 2.1, 2.2, 2.3, 2.4, 5.1, 5.2_
  - _Contracts: PackageJsonScripts, PathAliasResolution_

- [ ] 4. Remove the Next.js hook conflict workaround
- [ ] 4.1 (P) Delete the `require.extensions['.ts']` save/restore block in the server startup
  - Remove the code that saves `require.extensions['.ts']` before `nextApp.prepare()` and restores it afterward
  - Remove the associated comments explaining the ts-node hook conflict
  - Simplify the Next.js setup to just `this.nextApp = next({ dev }); await this.nextApp.prepare();`
  - Node.js 24 native type-stripping uses an internal mechanism that Next.js cannot interfere with
  - _Requirements: 3.1, 3.2, 3.3_
  - _Contracts: HookWorkaroundRemoval_

- [ ] 5. Clean up ts-node configuration
- [ ] 5.1 (P) Remove the `ts-node` section from `apps/app/tsconfig.json`
  - Delete the `"ts-node": { "transpileOnly": true, "swc": true, "compilerOptions": { "module": "CommonJS", "moduleResolution": "Node" } }` block
  - The `module: "CommonJS"` and `moduleResolution: "Node"` overrides were ts-node-specific; the base config (`module: "ESNext"`, `moduleResolution: "Bundler"`) remains correct for the build pipeline
  - `apps/slackbot-proxy/tsconfig.json` is out of scope (deferred)
  - _Requirements: 1.4, 1.5_
  - _Contracts: TsconfigCleanup_

- [ ] 6. Validate the complete migration
- [ ] 6.1 Run the full test suite to confirm no regressions
  - Execute `turbo run test --filter @growi/app` to run all unit and integration tests
  - Verify all tests pass without modification (path aliases, imports, and module resolution unchanged)
  - _Requirements: 8.2_

- [ ] 6.2 Run typecheck and lint to confirm build integrity
  - Execute `turbo run lint --filter @growi/app`
  - _Requirements: 8.3_

- [ ] 6.3 Verify dev server launch in CI mode
  - Execute `pnpm run launch-dev:ci` and confirm the server starts and responds to health checks
  - Confirms path alias resolution, dotenv-flow loading, and Next.js startup all work without ts-node
  - _Requirements: 8.1, 2.1, 2.2, 2.3, 2.4, 5.1, 5.2, 6.1, 6.2_

- [ ] 6.4 Verify production build is unaffected
  - Execute `turbo run build --filter @growi/app` to confirm the production build succeeds
  - Production build uses `tsc` and `next build`, which are independent of the dev runtime changes
  - _Requirements: 8.4_

## Deferred Requirements

The following requirements are intentionally deferred due to the `apps/slackbot-proxy` decorator blocker:
- **7.1** (Remove ts-node from root devDependencies): ts-node remains in root for slackbot-proxy
- **7.2** (Evaluate tsconfig-paths removal): tsconfig-paths is actively used by the new `node-dev` script
- **7.3** (Evaluate @swc/core removal): @swc/core is used by VSCode debug config and pdf-converter
