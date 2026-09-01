# Native ESM Authoring (apps/app)

`apps/app` is `"type": "module"` and the Express server runs as **native ESM** — no
`ts-node` / `tsx` in the runtime path; Node 24 strips types and a resolve-only hook
(`bin/runtime/dev-esm-resolver.mjs`) maps the `~/` / `^/` aliases in dev.

Each trap below cost a real regression during the CJS→ESM migration, and every one of
them passed `build:server` and `server:ci` before biting at runtime.

For import specifier *form* (no `.js` in relative / `~/` specifiers), see
`import-convention.md`.

## JSON imports require an import attribute

Native ESM needs `with { type: 'json' }` on **every** JSON import — static *and*
dynamic — or the import throws `ERR_IMPORT_ATTRIBUTE_MISSING` when it executes.

```typescript
import pkg from '^/package.json' with { type: 'json' };
const manifest = await import(manifestPath, { with: { type: 'json' } });
```

A dynamic JSON import inside a function body slips past `build:server`, `server:ci`
(module load only) and most E2E: the preset-themes manifest import in
`service/customize.ts` shipped broken this way and 500-ed production for the default
theme. Known sites: i18next locales, `^/package.json`, preset-themes manifest.

## `__dirname` / `__filename` do not exist

Use `import.meta.dirname` / `import.meta.filename`, and sweep the **whole** tree, not
just `src/server` — `playwright.config.ts`, `src/features/*/server/**`, and vite /
vitest configs are all loaded as native ESM. Contexts that shim the globals (Next
config, Vitest specs) hide the breakage, and the Prisma generated client assigns
`globalThis.__dirname`, which once let a real `dynamicImport(pkg, __dirname)` bug
survive `server:ci` and surface only in a browser E2E run. **Build and boot green do
not prove `__dirname` health** — only executing the feature does.

## Prefer namespace / named imports over default for CJS packages

`esModuleInterop` masks a missing default export: `import diff from 'diff'`
type-checks, but the package's ESM entry has no default, so the value is `undefined`
at runtime. Use `import * as x from 'pkg'` or named imports for CJS / dual packages,
and verify before trusting the type checker:

```bash
node -e "import('pkg').then(m => console.log(typeof m.default))"
```

The same hazard applies to **local** modules: `import X from './mod'` where `./mod`
has only named exports type-checks (TypeScript synthesizes a default) and is
`undefined` at runtime → boot crash. When you change a module's export shape, audit
its importers.

## Exported route factories need an explicit return type

`tsconfig.build.server.json` sets `declaration: true`, so an exported factory whose
express return type is inferred fails the build with TS2742 ("not portable").
Annotate it — `: Router` in `.ts`, `@returns {import('express').Router}` JSDoc in
`.js`. `lint:typecheck` (tsgo, emits no declarations) does **not** catch this; only
`build:server` does.

## `config/migrate-mongo-config.cjs` ships a hand-written `.d.cts` sibling

That config stays CJS because the `migrate-mongo` CLI loads it with `require()`, and
its `migrate-mongo-config.d.cts` is load-bearing: callers do
`import * as x from '….cjs'` against a `module.exports` shape, and only the `.d.cts`
pairing resolves cleanly. Keep it in sync when adding or removing exported symbols;
never delete it. (The i18next configs no longer need this — they are `.mjs` with a
plain `.d.ts`.)

## Services must not import the `Crowi` class

`crowi/index.ts` is the dependency hub — most server cycles route through it. Under
CJS, `require`'s lazy evaluation hid those cycles; under ESM's static hoisting they
throw `ReferenceError: Cannot access 'X' before initialization` at boot. A service /
event / model receives the Crowi **instance as a factory argument** and never imports
the class. If a new cycle cannot be broken by argument passing, split the shared types
into an `interfaces.ts` (as `service/search-delegator` did) rather than lazy-loading
on a per-request path.

## Erasable syntax only

`tsconfig.json` sets `erasableSyntaxOnly: true`: no `enum`, no parameter properties,
no namespaces. The server runs under Node's default strip-only type stripping (no
`--experimental-transform-types`), so non-erasable TypeScript would fail at runtime.
Use const objects + union types instead of `enum`, and explicit field assignment
instead of parameter properties. `lint:typecheck` fails on a regression.

## Migrations are ESM

`src/migrations/*.js` are ESM (the old `type: commonjs` directory isolation is gone), and
`migrate-mongo` reads `migration.up` / `migration.down` off the loaded module — so they
must use **named exports** (`export async function up() {}`), never
`export default { up, down }` and never `module.exports` (which throws under
`type: module`). They are part of the server build program (`MIGRATIONS_DIR` is
`src/migrations/` in dev and `dist/migrations/` in production), so the no-extension
import convention applies to them too. Biome does not lint this directory.
