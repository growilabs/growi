# Gap Analysis: Remove ts-node

## Executive Summary

- **Scope**: Replace `ts-node` with Node.js 24 native type-stripping in `apps/app` and `apps/slackbot-proxy` dev/CI scripts
- **Core challenge**: Path alias resolution (`~/`, `^/`) — `tsconfig-paths/register` must remain or be replaced since Node.js native TS does not read `tsconfig.json`
- **Major blocker for slackbot-proxy**: Heavy use of TypeScript decorators (`@tsed/*`, TypeORM `@Entity`, `@Column`) — Node.js native type-stripping does **not** support decorators, even with `--experimental-transform-types`
- **CJS/ESM concern**: ~60 `.js` files in `apps/app/src/server/` use ESM `import` syntax but the package has no `"type": "module"` — currently transpiled by ts-node to CJS. Node.js 24 cannot transpile these.
- **Recommended approach**: Hybrid — straightforward removal for `apps/app` (with `.js` → `.ts` conversions as needed), separate investigation for `apps/slackbot-proxy` due to decorator dependency

---

## 1. Current State Investigation

### 1.1 ts-node Usage Map

| Location | Usage | Purpose |
|---|---|---|
| `apps/app/package.json:48` | `"ts-node": "node -r ts-node/register/transpile-only -r tsconfig-paths/register -r dotenv-flow/config"` | Composite script used by `dev`, `launch-dev:ci`, `dev:migrate-mongo`, `repl` |
| `apps/slackbot-proxy/package.json:23` | `"ts-node": "node -r ts-node/register/transpile-only -r tsconfig-paths/register -r dotenv-flow/config"` | Composite script used by `dev`, `dev:ci` |
| `apps/app/tsconfig.json:30-37` | `"ts-node": { "transpileOnly": true, "swc": true, ... }` | Configures ts-node to use SWC, CJS module output |
| `apps/slackbot-proxy/tsconfig.json:42-45` | `"ts-node": { "transpileOnly": true, "swc": true }` | Same SWC-based transpile-only mode |
| `package.json:81` | `"ts-node": "^10.9.2"` (root devDependency) | Hoisted dependency for both apps |

### 1.2 Hook Conflict Workaround

**File**: `apps/app/src/server/crowi/index.ts:557-566`

```typescript
const savedTsHook = require.extensions['.ts'];
this.nextApp = next({ dev });
await this.nextApp.prepare();
if (savedTsHook && !require.extensions['.ts']) {
  require.extensions['.ts'] = savedTsHook;
}
```

This saves/restores ts-node's `require.extensions['.ts']` hook around `nextApp.prepare()` because Next.js 15's `next.config.ts` transpiler destroys it. With native type-stripping (which does not register `require.extensions`), this workaround becomes unnecessary.

### 1.3 Path Alias Resolution

**Current mechanism**: `tsconfig-paths/register` loaded via `-r` flag reads `tsconfig.json` `paths` at runtime.

**Aliases in use**:
- `apps/app`: `~/` → `./src/*`, `^/` → `./*`
- `apps/slackbot-proxy`: `~/` → `./src/*`

**Consumers**: Extensive usage across server code — `project-dir-utils.ts`, `express-init.js`, `dev.js`, route files, services, etc.

### 1.4 CJS/ESM Mixed Files

**~60 `.js` files in `apps/app/src/server/`** use ESM `import` syntax (e.g., `import express from 'express'`) combined with `module.exports` or CJS `require()`. These work today because ts-node transpiles them to CJS. Notable files:
- `src/server/crowi/dev.js` — ESM imports + `module.exports`
- `src/server/crowi/express-init.js` — ESM imports + `module.exports`
- `src/server/routes/*.js` — Mixed ESM/CJS patterns
- `src/server/models/*.js` — Mixed ESM/CJS patterns

**Neither `apps/app` nor `apps/slackbot-proxy` have `"type": "module"` in package.json.**

Node.js 24 native type-stripping does **not** perform module system conversion. These files will fail with syntax errors if loaded as-is.

### 1.5 Decorator Usage (Critical for slackbot-proxy)

**`apps/slackbot-proxy`** heavily relies on TypeScript decorators via `@tsed/*` and TypeORM:
- `@Service()`, `@Inject()`, `@Controller()`, `@Middleware()`
- `@Entity()`, `@Column()`, `@PrimaryGeneratedColumn()`, `@ManyToOne()`
- `@Get()`, `@Post()`, `@HeaderParams()`, `@BodyParams()`

**Node.js native type-stripping does NOT support decorators** — not even with `--experimental-transform-types`. This is a hard blocker for `apps/slackbot-proxy`.

**`apps/app`** does **not** use decorators in server code. It has one `enum` usage (`UploadStatus` in `multipart-uploader.ts`), which should be converted to a `const` object to remain compatible with native type-stripping without any flags.

### 1.6 project-dir-utils.ts

**File**: `apps/app/src/server/util/project-dir-utils.ts`

Already checks for both `next.config.ts` and `next.config.js`:
```typescript
const isCurrentDirRoot = isServer() && (fs.existsSync('./next.config.ts') || fs.existsSync('./next.config.js'));
```

**Status**: ✅ Requirement 6 is already satisfied. No changes needed.

### 1.7 dotenv-flow Integration

`dotenv-flow/config` is loaded via `-r` flag in the composite `ts-node` script. Since it's a plain CJS module, `node -r dotenv-flow/config` will continue to work with Node.js 24 natively. No changes needed to dotenv-flow integration itself.

### 1.8 @swc/core Dependency

| Package | `@swc/core` Usage |
|---|---|
| Root `package.json` | `devDependency` — used by ts-node (SWC mode) and `@swc-node/register` |
| `apps/pdf-converter` | Independent `devDependency` — uses `@swc-node/register/esm-register` |
| `.vscode/launch.json` | "Debug: Current File" uses `@swc-node/register` |

**Assessment**: `@swc/core` in root is shared between ts-node and the VSCode debugger. Removing ts-node alone does not justify removing `@swc/core` from root — the VSCode launch config and `@swc-node/register` still need it.

---

## 2. Requirement-to-Asset Map

| Requirement | Current Assets | Gap |
|---|---|---|
| **R1: Remove ts-node from dev runtime** | `package.json` scripts, tsconfig `ts-node` sections | **Extend**: Replace `-r ts-node/register/transpile-only` with native TS execution |
| **R2: Maintain path alias resolution** | `tsconfig-paths/register` via `-r` flag | **Unknown**: Need to validate `tsconfig-paths/register` works with Node.js 24 native TS, or find alternative |
| **R3: Eliminate Next.js hook conflict** | `crowi/index.ts:557-566` workaround | **Simple removal**: Delete 6 lines of hook save/restore code |
| **R4: CJS/ESM compatibility** | ~60 `.js` files with mixed syntax, transpiled by ts-node | **Missing**: These files need conversion to valid CJS or `.ts` |
| **R5: dotenv-flow integration** | `-r dotenv-flow/config` in composite script | **No gap**: Works natively with `node -r` |
| **R6: project-dir-utils config detection** | Already checks both `.ts` and `.js` | **No gap**: Already implemented |
| **R7: Clean up dependencies** | `ts-node` in root, `tsconfig-paths` in root, `@swc/core` in root | **Constraint**: `@swc/core` needed by VSCode debug config; `tsconfig-paths` may still be needed |
| **R8: CI compatibility** | CI uses Node.js 24.x, runs `launch-dev:ci`, `test`, `lint` | **Extend**: Update scripts; CI infra already compatible |

### Gap Tags

- **R2**: `Research Needed` — validate `tsconfig-paths/register` + Node.js 24 native TS compatibility
- **R4**: `Missing` — ~60 `.js` files need conversion or the module system needs adjustment
- **R7**: `Constraint` — `@swc/core` and `@swc-node/register` are used outside of ts-node
- **slackbot-proxy decorators**: `Blocker` — decorators are not supported by native type-stripping

---

## 3. Implementation Approach Options

### Option A: Minimal Change — Keep `tsconfig-paths`, Convert `.js` Files

**Strategy**: Replace `ts-node/register/transpile-only` with nothing (rely on native TS), keep `tsconfig-paths/register` for path aliases, convert problematic `.js` files to `.ts`.

**Changes required**:
1. Update `apps/app/package.json` script: `"ts-node": "node -r tsconfig-paths/register -r dotenv-flow/config"`
2. Update `apps/slackbot-proxy/package.json` similarly (but see blocker below)
3. Remove `ts-node` sections from both `tsconfig.json` files
4. Remove hook workaround from `crowi/index.ts`
5. Convert ~60 `.js` files to `.ts` (or fix their CJS/ESM syntax)
6. Convert the one `enum UploadStatus` to a `const` object + type union
7. Remove `ts-node` from root `package.json`

**Trade-offs**:
- ✅ Minimal conceptual change — `tsconfig-paths/register` is well-understood
- ✅ Path aliases continue working without code changes
- ❌ Large file conversion effort (~60 `.js` → `.ts` files)
- ❌ `tsconfig-paths/register` + native TS compatibility not officially validated
- ❌ **Blocked for slackbot-proxy** due to decorators

### Option B: Full Native — Use Node.js Subpath Imports

**Strategy**: Replace both `ts-node` and `tsconfig-paths` with Node.js-native mechanisms. Use `package.json` `"imports"` field for path aliases.

**Changes required**:
1. Everything in Option A
2. Replace `~/` and `^/` aliases with `#` prefixed subpath imports
3. Update all import statements across the codebase
4. Remove `tsconfig-paths` from root `devDependencies`
5. Update `tsconfig.json` paths to match subpath imports

**Trade-offs**:
- ✅ Zero external runtime dependencies for TS execution
- ✅ Uses officially supported Node.js mechanism
- ❌ **Massive refactor**: hundreds of import statements to change
- ❌ `#` prefix is less ergonomic than `~/`
- ❌ Requires updating both `tsconfig.json` (for IDE/build) and `package.json` (for runtime)
- ❌ Still blocked for slackbot-proxy

### Option C: Hybrid — Phase by Package

**Strategy**: Remove ts-node from `apps/app` first (using Option A approach), defer `apps/slackbot-proxy` until its decorator situation is resolved (e.g., tsed v7 migration or keeping ts-node only for slackbot-proxy).

**Phase 1 — `apps/app`**:
1. Replace `ts-node` script with `node -r tsconfig-paths/register -r dotenv-flow/config`
2. Convert the one `enum UploadStatus` to a `const` object (no special flags needed)
3. Convert `.js` files with mixed ESM/CJS to proper `.ts`
4. Remove hook workaround
5. Remove `ts-node` config from `apps/app/tsconfig.json`

**Phase 2 — `apps/slackbot-proxy`** (deferred):
- Keep ts-node for slackbot-proxy until decorator support is available
- Or: migrate slackbot-proxy off decorators (separate project)
- Or: use `@swc-node/register` as ts-node replacement (it supports decorators)

**Phase 3 — Cleanup**:
- Remove `ts-node` from root only when both apps are migrated
- Evaluate `tsconfig-paths` removal after validation

**Trade-offs**:
- ✅ Delivers value incrementally
- ✅ Resolves the Next.js hook conflict immediately
- ✅ Does not block on slackbot-proxy's decorator dependency
- ❌ ts-node remains in root `devDependencies` until Phase 2 completes
- ❌ Two different TS execution patterns coexist temporarily

---

## 4. Implementation Complexity & Risk

**Effort**: **M (3–7 days)**
- Core script changes are straightforward (S)
- `.js` → `.ts` file conversions add bulk (M)
- slackbot-proxy decorator blocker may require investigation (pushes toward L if addressed)

**Risk**: **Medium**
- `tsconfig-paths/register` + native TS is not officially validated (mitigated by testing)
- ~60 file conversions carry regression risk (mitigated by existing tests)
- slackbot-proxy is a hard blocker without decorator support

---

## 5. Research Items for Design Phase

1. **`tsconfig-paths/register` + Node.js 24 native TS**: Validate that `node -r tsconfig-paths/register file.ts` correctly resolves `~/` and `^/` aliases without ts-node present. This is the highest priority research item.

2. **slackbot-proxy strategy**: Determine if `@swc-node/register` (already used by `apps/pdf-converter`) can replace ts-node for slackbot-proxy's decorator needs, or if slackbot-proxy should be excluded from scope.

3. **`.js` file conversion scope**: Audit all ~60 `.js` files to determine which actually need conversion vs. which are pure CJS (valid without ts-node). Files using only `require`/`module.exports` need no changes.

4. **VSCode launch.json**: The "Debug: Current File" configuration uses `@swc-node/register`. Evaluate if this should be updated to use native TS or left as-is.

---

## 6. Recommendations for Design Phase

**Preferred approach**: **Option C (Hybrid)**
- Scope Phase 1 to `apps/app` only, which resolves the core Next.js hook conflict
- Validate `tsconfig-paths/register` compatibility early (spike/PoC)
- Defer slackbot-proxy to a separate task or Phase 2
- Audit `.js` files to determine actual conversion scope (many may be pure CJS)

**Key decisions needed**:
- Whether slackbot-proxy is in scope or deferred
- Whether to keep `tsconfig-paths/register` or invest in an alternative

**Already decided**:
- Convert the one `enum UploadStatus` to a `const` object + type union — `--experimental-transform-types` is not needed
