# Requirements Document

## Introduction

GROWI's development server (`apps/app` and `apps/slackbot-proxy`) currently uses `ts-node` to execute TypeScript at runtime. This creates an incompatibility with Next.js 15's `next.config.ts` transpilation, which destroys `require.extensions['.ts']` hooks registered by ts-node. Since GROWI targets Node.js 24 (`"node": "^24"`), which has built-in TypeScript type-stripping enabled by default, ts-node can be replaced with Node.js native TypeScript execution. This eliminates the hook conflict, reduces dependencies, and simplifies the runtime stack.

**Scope**: Development and CI environments only. Production already runs compiled JavaScript (`dist/`) and is unaffected.

**Affected packages**:
- `apps/app` — uses `node -r ts-node/register/transpile-only -r tsconfig-paths/register -r dotenv-flow/config`
- `apps/slackbot-proxy` — uses the same pattern

**Out of scope**:
- `apps/pdf-converter` — already uses `@swc-node/register/esm-register` (no ts-node)
- Production builds — already compile to JavaScript via `next build` / `tsc`
- Vitest configurations — use `vite-tsconfig-paths` (unrelated to runtime ts-node)

## Requirements

### Requirement 1: Remove ts-node from Development Runtime

**Objective:** As a developer, I want the dev server to run TypeScript using Node.js native type-stripping, so that the ts-node dependency and its configuration are no longer needed at runtime.

#### Acceptance Criteria

1. When the `pnpm run dev` command is executed in `apps/app`, the dev server shall start without loading `ts-node/register/transpile-only`.
2. When the `pnpm run dev` command is executed in `apps/slackbot-proxy`, the dev server shall start without loading `ts-node/register/transpile-only`.
3. When the `pnpm run launch-dev:ci` command is executed, the dev server shall start successfully without ts-node.
4. The `ts-node` configuration section in `apps/app/tsconfig.json` shall be removed.
5. The `ts-node` configuration section in `apps/slackbot-proxy/tsconfig.json` shall be removed.
6. The `ts-node` package script in `apps/app/package.json` and `apps/slackbot-proxy/package.json` shall be replaced with an equivalent that uses Node.js native TypeScript execution.

### Requirement 2: Maintain Path Alias Resolution

**Objective:** As a developer, I want `~/` and `^/` path aliases to continue resolving correctly at runtime, so that all existing `import` and `require` statements work without modification.

#### Acceptance Criteria

1. When a TypeScript source file imports a module using the `~/` prefix (e.g., `import x from '~/utils/logger'`), the dev server shall resolve it to the corresponding file under `src/`.
2. When a TypeScript source file imports a module using the `^/` prefix (e.g., `import x from '^/config/foo'`), the dev server shall resolve it to the corresponding file under the project root.
3. While the dev server is running, the path alias resolution shall work for both `.ts` and `.js` files.
4. The path alias resolution mechanism shall not depend on `require.extensions['.ts']` being registered, since Node.js native TypeScript execution does not register it.

### Requirement 3: Eliminate Next.js 15 Hook Conflict

**Objective:** As a developer, I want the Next.js hook conflict workaround to become unnecessary, so that the codebase is simpler and not reliant on brittle hook restoration logic.

#### Acceptance Criteria

1. When `nextApp.prepare()` completes, the dev server shall be able to `require()` TypeScript files without any explicit hook restoration code.
2. The workaround code in `src/server/crowi/index.ts` that saves and restores `require.extensions['.ts']` shall be removed.
3. When `next.config.ts` is loaded by Next.js, the dev server's ability to execute TypeScript files shall not be affected.

### Requirement 4: Maintain CJS/ESM Compatibility for Mixed-Format Files

**Objective:** As a developer, I want existing `.js` files that use ESM `import` syntax (transpiled by ts-node today) to continue working, so that no source file changes are required in those files.

#### Acceptance Criteria

1. When the dev server loads `src/server/crowi/dev.js` (which uses ESM `import` syntax in a `.js` file), the file shall execute correctly.
2. While the dev server is running, files that mix ESM `import` syntax and CommonJS `module.exports` shall be handled without errors.
3. If a `.js` file cannot be executed by Node.js native TypeScript support alone, the build system shall provide a fallback mechanism or the file shall be converted to `.ts`.

### Requirement 5: Maintain dotenv-flow Integration

**Objective:** As a developer, I want environment variables to continue loading via `dotenv-flow/config` at dev server startup, so that `.env` files are processed as before.

#### Acceptance Criteria

1. When the dev server starts, the `dotenv-flow/config` module shall be loaded before the application entry point executes.
2. The environment variable loading behavior shall be identical to the current `node -r dotenv-flow/config` approach.

### Requirement 6: Update project-dir-utils.ts Config Detection

**Objective:** As a developer, I want `project-dir-utils.ts` to detect the project root correctly regardless of whether the config file is `.ts` or `.js`, so that runtime path resolution is accurate.

#### Acceptance Criteria

1. The `isCurrentDirRoot` check in `project-dir-utils.ts` shall accept both `next.config.ts` and `next.config.js`.
2. When `next.config.ts` exists (and `next.config.js` does not), the `projectRoot` shall resolve to `process.cwd()`.

### Requirement 7: Clean Up Unused Dependencies

**Objective:** As a maintainer, I want ts-node and related unnecessary dependencies removed from the workspace, so that the dependency tree is smaller and maintenance burden is reduced.

#### Acceptance Criteria

1. The `ts-node` package shall be removed from the root `package.json` `devDependencies`.
2. If `tsconfig-paths` is no longer used by any runtime script (only by Vitest via `vite-tsconfig-paths`), it shall be evaluated for removal from `devDependencies`.
3. The `@swc/core` dependency shall be evaluated: if it was only required for ts-node's SWC mode and is not used elsewhere, it shall be removed.

### Requirement 8: CI Pipeline Compatibility

**Objective:** As a CI engineer, I want all CI jobs (`ci-app-launch-dev`, `ci-app-test`, `ci-app-lint`) to pass with the new TypeScript execution approach, so that the migration does not break the development workflow.

#### Acceptance Criteria

1. When `ci-app-launch-dev` runs, the dev server shall start and respond to health checks successfully.
2. When `ci-app-test` runs, all existing tests shall pass without modification.
3. When `ci-app-lint` runs, all lint checks shall pass without new errors.
4. When `test-prod-node24 / build-prod` runs, the production build shall succeed.
