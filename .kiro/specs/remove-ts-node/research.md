# Research & Design Decisions: remove-ts-node

## Summary
- **Feature**: `remove-ts-node`
- **Discovery Scope**: Extension (modifying existing dev/CI toolchain)
- **Key Findings**:
  - `tsconfig-paths/register` is fully independent of ts-node and works with Node.js 24 native TS via CJS `Module._resolveFilename` patching
  - 52 of 64 `.js` files in `apps/app/src/server/` use ESM `import` syntax and require `.js` → `.ts` conversion
  - `apps/slackbot-proxy` is blocked by decorator dependency — deferred to separate work

## Research Log

### tsconfig-paths/register + Node.js 24 Native TS Compatibility

- **Context**: Gap analysis identified this as the highest-priority research item. Node.js 24 does not read `tsconfig.json`, so path aliases (`~/`, `^/`) need an independent mechanism.
- **Sources Consulted**:
  - [tsconfig-paths source code](https://github.com/dividab/tsconfig-paths) — `register.js`, `config-loader.js`, `match-path-sync.ts`
  - [Node.js TypeScript documentation](https://nodejs.org/api/typescript.html)
  - [tsconfig-paths npm](https://www.npmjs.com/package/tsconfig-paths) — README standalone usage
- **Findings**:
  - `tsconfig-paths/register` has **zero dependency on ts-node**. Dependencies: `json5`, `minimist`, `strip-bom` only.
  - It patches `Module._resolveFilename` (CJS resolver) to intercept aliased imports before normal resolution.
  - Node.js 24 native type-stripping does not modify `Module._resolveFilename` — it only registers an internal `.ts` extension handler for type erasure.
  - Execution order with `node -r tsconfig-paths/register -r dotenv-flow/config file.ts`: (1) tsconfig-paths patches resolver, (2) dotenv-flow loads env, (3) Node strips types from `.ts` file, (4) aliased `require()` calls go through patched resolver.
  - The `TS_NODE_PROJECT` / `TS_NODE_BASEURL` env var checks in tsconfig-paths are backward-compatibility shortcuts, not hard dependencies.
  - GROWI's `apps/app/tsconfig.json` has `paths` but no `baseUrl`. tsconfig-paths handles this correctly — it uses `tsconfig.json`'s directory as the base and only resolves explicit path patterns.
- **Implications**: `node -r tsconfig-paths/register -r dotenv-flow/config src/server/app.ts` is a valid drop-in replacement for the current `ts-node` composite script. No alternative path resolution mechanism needed.

### .js File Audit: ESM/CJS Categorization

- **Context**: ts-node currently transpiles `.js` files containing ESM `import` syntax to CJS. Without ts-node, Node.js 24 cannot do this conversion. Files must be assessed for conversion needs.
- **Sources Consulted**: Direct file-by-file read of all 64 `.js` files in `apps/app/src/server/`
- **Findings**:
  - **12 files: Pure CJS** — use only `require()`/`module.exports`, no conversion needed
    - `models/vo/s2s-message.js`, `middlewares/inject-currentuser-to-localvars.js`, `middlewares/auto-reconnect-to-s2s-msg-server.js`, `routes/user.js`, `routes/avoid-session-routes.js`, `util/apiResponse.js`, `util/apiPaginate.js`, `util/formUtil.js`, `util/getToday.js`, `util/express-validator/sanitizer.js`, `util/express-validator/validator.js` (empty), `service/slack-command-handler/slack-command-handler.js`
  - **8 files: Pure ESM** — use only `import`/`export`, cleanest conversion candidates
    - `models/serializers/*.js` (4 files), `models/slack-app-integration.js`, `models/user/index.js`, `routes/attachment/api.js`, `util/slack.js`
  - **44 files: Mixed ESM/CJS** — ESM `import` at top + `module.exports` at bottom (some with inline `require()`)
    - Routes (`routes/*.js`, `routes/apiv3/*.js`), services (`service/slack-command-handler/*.js`), middlewares, crowi (`dev.js`, `express-init.js`)
- **Implications**:
  - All 52 ESM/mixed files can be converted by simple `.js` → `.ts` rename. The ESM `import` syntax is already valid TypeScript. Inline `require()` calls are also valid in TypeScript with `esModuleInterop: true`.
  - The 12 pure CJS files can remain as `.js` but renaming to `.ts` for consistency is acceptable since `require()`/`module.exports` is valid TypeScript.
  - Recommended: rename all 64 files to `.ts` for uniformity. This eliminates the CJS/ESM ambiguity entirely.

### Node.js 24 Type-Stripping Limitations

- **Context**: Identify which TypeScript features used in `apps/app` are incompatible with native type-stripping.
- **Findings**:
  - **Enums**: 1 usage — `UploadStatus` in `src/server/service/file-uploader/multipart-uploader.ts`. Decision: convert to `const` object.
  - **Decorators**: None in `apps/app` server code. (slackbot-proxy has heavy decorator use — out of scope)
  - **Parameter properties**: Not found in server code.
  - **`import =` syntax**: Not found.
  - **JSX/TSX**: Server code does not use JSX.
- **Implications**: With the `enum` → `const` conversion, all `apps/app` server code is compatible with native type-stripping without any flags.

### apps/slackbot-proxy Decorator Blocker

- **Context**: Requirements scope includes both `apps/app` and `apps/slackbot-proxy`.
- **Findings**:
  - slackbot-proxy uses `@tsed/*` framework decorators (`@Service`, `@Controller`, `@Get`, `@Post`, etc.) and TypeORM decorators (`@Entity`, `@Column`, etc.)
  - Node.js 24 does not support decorators, even with `--experimental-transform-types`
  - `@swc-node/register` (used by `apps/pdf-converter`) supports decorators and could replace ts-node for slackbot-proxy
- **Implications**: slackbot-proxy migration is deferred to separate work. Phase 1 focuses on `apps/app` only.

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| Keep tsconfig-paths/register | Continue using `-r tsconfig-paths/register` without ts-node | Zero import changes, proven CJS hook, minimal risk | Not officially validated with native TS (but mechanism is sound) | Recommended for Phase 1 |
| Node.js subpath imports | Replace `~/`/`^/` with `#` prefixed imports | Native Node.js mechanism, no runtime deps | Massive refactor (hundreds of imports), `#` prefix ergonomics | Not recommended |
| Custom ESM loader | Write `--import` loader hook for path resolution | Full control, ESM compatible | Maintenance burden, non-standard | Overkill for CJS server |

## Design Decisions

### Decision: Keep tsconfig-paths/register for path alias resolution
- **Context**: `~/` and `^/` path aliases used extensively throughout server code
- **Alternatives Considered**:
  1. Node.js subpath imports — requires `#` prefix and massive import refactor
  2. Custom loader hook — maintenance overhead
  3. Keep tsconfig-paths/register — no code changes needed
- **Selected Approach**: Keep `tsconfig-paths/register` loaded via `-r` flag
- **Rationale**: Mechanism is CJS `Module._resolveFilename` patching, independent of ts-node. Proven pattern, zero import changes.
- **Trade-offs**: External dependency remains, but it's lightweight (3 deps) and well-maintained
- **Follow-up**: Validate with smoke test during implementation

### Decision: Rename all .js → .ts in apps/app/src/server/
- **Context**: 52 of 64 `.js` files use ESM `import` syntax that ts-node was transpiling. Remaining 12 are pure CJS.
- **Alternatives Considered**:
  1. Convert only 52 ESM/mixed files — leaves inconsistency
  2. Convert all 64 to `.ts` — uniform codebase
  3. Add `"type": "module"` to package.json — massive cascading changes
- **Selected Approach**: Rename all 64 files to `.ts`
- **Rationale**: Simplest approach. ESM `import` + `module.exports` is valid TypeScript. Pure CJS `require()` is also valid TypeScript. No code changes needed inside files — just rename.
- **Trade-offs**: Git history shows rename (mitigated by `git mv`). 12 pure CJS files didn't strictly need it.
- **Follow-up**: Verify all imports referencing these files resolve correctly after rename

### Decision: Convert enum UploadStatus to const object
- **Context**: Single `enum` usage blocks native type-stripping without `--experimental-transform-types`
- **Selected Approach**: Replace `enum UploadStatus { ... }` with `const UploadStatus = { ... } as const` + type union
- **Rationale**: Avoids experimental flag dependency. Functional behavior identical.

### Decision: Defer apps/slackbot-proxy to separate work
- **Context**: Decorator usage makes native type-stripping impossible
- **Selected Approach**: Phase 1 covers `apps/app` only. slackbot-proxy keeps ts-node or migrates to `@swc-node/register` in a separate effort.
- **Rationale**: Unblocks the primary goal (Next.js hook conflict resolution) without being held up by an unrelated constraint.

## Risks & Mitigations
- `tsconfig-paths/register` untested with native TS → Mitigated by smoke test in CI
- 64 file renames carry git blame disruption → Mitigated by `git mv` and separate rename commit
- Mixed ESM/CJS patterns may have edge cases → Mitigated by existing test suite coverage
- ts-node remains in root `devDependencies` for slackbot-proxy → Acceptable temporary state

## References
- [tsconfig-paths GitHub](https://github.com/dividab/tsconfig-paths) — standalone CJS usage documentation
- [Node.js TypeScript docs](https://nodejs.org/api/typescript.html) — native type-stripping limitations
- [Node.js Running TypeScript Natively](https://nodejs.org/en/learn/typescript/run-natively) — official guide
- [Amaro (Node.js TS engine)](https://github.com/nodejs/amaro) — SWC-based type erasure
