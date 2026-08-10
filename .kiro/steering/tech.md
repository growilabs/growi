# Technology Stack

The tech-stack overview lives in `AGENTS.md` / `apps/app/AGENTS.md` (auto-loaded via `CLAUDE.md`). This file records cc-sdd-specific build/runtime decisions.

## cc-sdd Specific Notes

### Module System (native ESM)

Native ESM is the baseline of GROWI v8 (the version now on the mainline): the workspace root, `apps/app`, and the 17 shared `@growi/*` packages under `packages/*` all declare `"type": "module"`. `apps/app`'s Express server emits native ESM under `dist/`, and **the runtime path contains no `ts-node` / `tsx`** — TypeScript runs via Node v24's built-in type stripping:

- **Production**: `node --import ./bin/runtime/env-preload.mjs dist/server/app.js` (`server:ci` adds `--ci` for load-only smoke); `bin/runtime/` holds the self-contained runtime hooks and is the only `bin/` subset shipped in the production tarball
- **Dev**: `nodemon` → Node v24 native TS + an in-thread resolve-only hook (`apps/app/bin/runtime/dev-esm-resolver.mjs`) that maps `~/`/`^/` aliases and `.js`→`.ts`

**Why a hand-written resolve hook instead of a TS runner** (measured during the migration, and the reason not to "simplify" this back): `@swc-node/register` misreads the `^/*` alias as a bare package `'^'` and cannot resolve it at all; `tsx` works but routes every resolve/load through an out-of-thread loader hook and made a cold graph load ~2.3× slower than Node's native transform (5.8–6.4 s vs 2.4–2.8 s). Node's own type stripping needs no runner but has no `tsconfig.paths` support — hence the ~40-line in-thread `module.registerHooks` resolver, which is the only piece that has to exist. To keep Node's *default* strip-only mode usable (no `--experimental-transform-types`), `tsconfig.json` sets `erasableSyntaxOnly: true`, so `enum` / parameter properties / namespaces are banned repo-wide in `apps/app` and CI lint catches a regression.

Node 24's `require(esm)` lets residual CommonJS consumers (e.g. third-party `@lykmapipo/common`) load ESM-only transitive deps, **but it returns a module *namespace* object, not the CJS default export**. Packages that read members off the default (e.g. `mime.getType`) still need a CJS pin; packages that use named members (e.g. `flat.flatten`) work natively. This is why `pnpm-workspace.yaml` keeps the `@lykmapipo/common>mime` pin but no longer needs the `flat` / `parse-json` pins.

App-scoped detail lives under `apps/app/.claude/`: **`rules/esm-authoring.md`** (native-ESM traps that build and boot checks do not catch — JSON import attributes, `__dirname`, CJS default-import interop, TS2742 on exported route factories, the no-`Crowi`-import cycle invariant) and **`skills/esm-merge-coverage/`** (the coverage pass for merging a pre-ESM branch, plus the codemod / lint tool inventory).

### apps/app Import Convention

`apps/app/src` uses a **single no-extension import convention** (local → relative `./X` / `../X`, cross-module → `~/X`; never `.js`/`.jsx` in source). The `.js` is added only at server-build emit by `bin/add-js-extensions.ts` and verified by `bin/verify-dist-resolution.ts` (both run directly via Node native type stripping) — the server build type-checks with `module: Preserve` / `moduleResolution: Bundler`, so the compile-time extension guarantee that `NodeNext` used to give is replaced by an exhaustive check of the emitted artifact. The full developer rule lives in **`apps/app/.claude/rules/import-convention.md`** (app-scoped); this note records only the build/runtime decision behind it.

### Bundler Strategy (Project-Wide Decision)

GROWI uses **Turbopack** (Next.js 16 default) for **both development and production builds** (`next build` without flags). Webpack fallback is available via `USE_WEBPACK=1` environment variable for debugging only. All custom webpack loaders/plugins have been migrated to Turbopack equivalents (`turbopack.rules`, `turbopack.resolveAlias`). See `apps/app/.claude/skills/build-optimization/SKILL.md` for details.

`transpilePackages` is now **empty**: once `apps/app` became native ESM, Turbopack resolves the ESM-only unified/remark/rehype ecosystem (and superjson) natively, so the former 40 hardcoded + 6 prefix-group entries were all removed during the ESM migration. See `apps/app/next.config.ts` for the rationale comment.

### Import Optimization Principles

To prevent module count regression across the monorepo:

- **Subpath imports over barrel imports** — e.g., `import { format } from 'date-fns/format'` instead of `from 'date-fns'`
- **Lightweight replacements** — prefer small single-purpose packages over large multi-feature libraries
- **Server-client boundary** — never import server-only code from client modules; extract client-safe utilities if needed

### Turbopack Externalisation Rule (`apps/app/package.json`)

A consequence of the two choices above (Turbopack for the build, `pnpm deploy --prod` for the release artifact): **any package Turbopack externalises must be listed under `dependencies`, not `devDependencies`.** Turbopack emits externalised packages as symlinks in `.next/node_modules/`, while `pnpm deploy --prod` copies only `dependencies` — so a package in the wrong section is simply missing from the deploy output, and the production server dies at startup with `ERR_MODULE_NOT_FOUND`.

What makes this a recurring cost is that the boundary is **not** where intuition puts it: neither `dynamic(..., { ssr: false })` nor a `useEffect`-guarded `import()` keeps a package out of the production graph, because Turbopack's static import analysis reaches the call site regardless. Classification therefore has to be decided by **inspecting the built artifact**, never by reading the import style at the call site.

The operational rule — how to classify a new package, the verified per-package inventory in both directions, and the separate case of a dangling symlink for a package that is already in `dependencies` (a drifting optional peer, fixed by pinning in `pnpm-workspace.yaml`, not by reclassifying) — lives in **`apps/app/.claude/rules/package-dependencies.md`**, which auto-loads when the work touches `apps/app`. That file is the single source of truth: **do not mirror its package lists here**, because the copy goes stale silently and this steering file already had that happen.

### Production Assembly Pattern

`assemble-prod.sh` produces the release artifact via **workspace-root staging** (not `apps/app/` staging):

```
pnpm deploy out --prod --legacy   → self-contained out/node_modules/ (pnpm v11)
rm -rf node_modules
mv out/node_modules node_modules  → workspace root is now prod-only
ln -sfn ../../node_modules apps/app/node_modules  → compatibility symlink
```

The release image includes `node_modules/` at workspace root alongside `apps/app/`. Turbopack's `.next/node_modules/` symlinks (pointing `../../../../node_modules/.pnpm/`) resolve naturally without any sed-based rewriting. `apps/app/node_modules` is a symlink to `../../node_modules` for migration script and Node.js `require()` compatibility.

**pnpm version sensitivity**: `--legacy` produces self-contained symlinks in pnpm v10+. Downgrading below v10 may break the assembly. After running `assemble-prod.sh` locally, run `pnpm install` to restore the development environment.

For apps/app-specific build optimization details (webpack config, null-loader rules, SuperJSON architecture, module count KPI), see `apps/app/.claude/skills/build-optimization/SKILL.md`.

### Data Layer (Mongoose → Prisma, migration in progress)

The data layer is **mid-migration**: Mongoose models are being replaced by Prisma
extensions **one model at a time**, so both access styles coexist in the tree and will
keep coexisting for a while. `apps/app/prisma/schema.prisma` is the source of truth for
which collections have been declared so far; `@prisma/client` is a runtime dependency of
`apps/app`.

Decisions worth knowing before touching a model (the step-by-step procedure lives in the
**`/mongoose-to-prisma`** skill, and the detailed rules in **`.claude/rules/model.md`**,
which auto-loads when you edit `apps/app/src/server/models/**`):

- **Mongoose still owns collection and index creation** until every model is migrated —
  only then does `prisma db push` take over. Do not move index creation to Prisma early.
- **Mongoose statics / instance methods become `Prisma.defineExtension`**, not free
  functions bolted onto call sites.
- **`_id` / `__v` are renamed, not dropped.** Prisma forbids field names starting with
  `_`, so the schema declares `id` / `v` with `@map("_id")` / `@map("__v")`, and
  `createPrisma()` (`apps/app/src/utils/prisma.ts`) restores `_id` via a global
  `$allModels` compute — which **also propagates through nested `include`s**. That last
  point has already caused a false review finding ("`_id` is missing, so an `_id`-gated
  serializer silently stops redacting"): the compute means results do carry `_id`, so
  verify against real query output before reporting that class of leak.
- **`__v` no longer means what it meant under Mongoose.** Mongoose bumped it only on
  particular operations (array `$push` / `$pull` etc.); the Prisma query extension bumps
  it on every `update` / `updateMany`. Any code or test asserting an exact `__v` after a
  partial update is depending on behavior that no longer exists.
- **Production runtime**: the Prisma query engine library must be located explicitly via
  `PRISMA_QUERY_ENGINE_LIBRARY`. Turbopack rewrites the paths Prisma would otherwise use
  to find it, after which Prisma's internal hardcoded fallback search takes over and SSR
  500s. Pointing the variable at the real engine file is the fix, not patching paths.
- **Prisma is a resident startup cost**, so it is subject to the boot-time load
  conventions in `apps/app/.claude/rules/server-boot-imports.md` (lazy-load
  config-gated heavy SDKs; warm up costs that every deployment pays anyway).

### Logging

The monorepo uses **pino** (via `@growi/logger`) as the standard logging library. Legacy bunyan usage has been migrated.

`@growi/logger` is a **universal** package (server + browser). Two constraints follow from that, both learned the hard way during the ESM migration:

- **No static `import … from 'node:*'` that a browser code path can reach.** Builtins like `node:module` have no browser polyfill and break the Turbopack client build. Acquire them at runtime inside a server-only branch via `process.getBuiltinModule('node:module')` (not an import statement → never enters the browser graph).
- **pino transport targets must be ABSOLUTE PATHS, not bare specifiers,** because pino loads transports in a worker thread that resolves a bare specifier relative to the caller — and when the logger is **bundled** (Next.js SSR via Turbopack) that resolution fails with `unable to determine transport target for "pino-pretty"`, 500-ing every SSR page when `FORMAT_NODE_LOG` is truthy. `transport-factory.ts` resolves both the dev (`bunyan-format`) and prod (`pino-pretty`) targets to absolute paths for this reason.

### External Plugin Distribution Contract (orthogonal to the internal module system)

Third-party plugins published at **https://growi.org/plugins** reach a running GROWI by a
path that is deliberately decoupled from how `apps/app`'s own source is authored or built.
This decoupling is a **system-wide invariant to protect and verify, not an assumption to
lean on** — it is easy to silently break from inside an unrelated refactor (such as the ESM
migration).

How an installed plugin actually flows (`features/growi-plugin/server`):

- **Install** downloads the plugin repo as a GitHub archive zip, unzips it, validates the
  `growiPlugin` directive in its `package.json` (`schemaVersion >= 4`), and saves metadata.
  GROWI **never builds, bundles, `require()`s, or `import()`s the plugin's own code.** It
  relies on the plugin shipping a **prebuilt `dist/` with a Vite manifest**
  (`dist/.vite/manifest.json`, or the Vite 4 `dist/manifest.json` — both are read).
- **script / theme** plugins are served as **static files** (`express.static` at
  `/static/plugins`) and loaded by the **browser as native ESM** —
  `<script type="module">` / `<link rel="stylesheet">` injected by `_document.page.tsx`.
  These assets are served raw; they do **not** pass through Turbopack or the server build.
- **template** plugins are read server-side as markdown (scanned via `@growi/pluginkit`).
- The only server-side use of plugin packaging is reading the manifest + `package.json`
  directive, done through GROWI's own **`@growi/pluginkit` `.cjs`** build (published dual
  CJS/ESM).

**Consequence:** GROWI's internal CJS→ESM module-system choice is structurally orthogonal
to the external plugin contract — existing prebuilt plugins keep working because their code
is never re-processed by GROWI's build. **But the surfaces that carry this contract can
still regress** — the plugin install route factory, the `/static/plugins` serving, the
`_document` script/stylesheet injection, the Vite-manifest reader, and the published
`@growi/pluginkit` format. Any change touching those (the ESM migration touched several)
must re-run the **plugin-install smoke** — install one officially-released *script*, one
*theme*, and one *template* plugin and confirm each is served/loaded — because build/boot
checks do not exercise this path. Procedure and reference plugins: the "External Plugin
Install Smoke" section of `apps/app/.claude/skills/app-commands/SKILL.md`.

---
_Updated: 2026-08-06. (1) Added "Data Layer (Mongoose → Prisma, migration in progress)" — the incremental per-model migration was project-wide and in flight but had no steering entry at all. (2) Reduced the Turbopack externalisation section to the decision plus the counter-intuitive part, and delegated the classification procedure and the per-package inventory to `apps/app/.claude/rules/package-dependencies.md`; the list kept here had already drifted behind that rule. Prior: 2026-07-27. v8 (native ESM) is now the mainline. The `esm-migration` / `esm-import-convention` specs were retired: their durable content moved to `apps/app/.claude/rules/esm-authoring.md`, `apps/app/.claude/skills/esm-merge-coverage/`, and the app-commands skill (authorization-matrix + plugin-install smoke procedures), and the dev-runner selection rationale was folded into "Module System" above. Prior: 2026-06-17 External Plugin Distribution Contract; 2026-06-16 Module System (native ESM) + transpilePackages-empty._
