---
name: esm-merge-coverage
description: ESM-ify source files that arrive from a non-ESM branch when merging into the ESM-migrated dev branch (apps/app). Use after merging master, support/mastra, or any large pre-ESM branch into dev/8.0.x — a git merge does NOT re-run any ESM transform, so incoming CJS/extension-bearing sources slip in silently and only break at build/runtime. Auto-invoked when the conversation is about merging a non-ESM branch into apps/app and bringing the result up to the ESM convention.
user-invocable: true
---

# ESM Merge Coverage (apps/app)

After `apps/app` was migrated to native ESM (specs `esm-migration` + `esm-import-convention`),
**every large merge from a pre-ESM branch reopens the migration for the files it carries.**
A `git merge` copies source verbatim — it does not run any codemod, lint, or build step — so
code written in the old style (`require`, `module.exports`, `__dirname`, `.js` in specifiers)
lands unconverted and only fails later at `build:server` type-check, `verify-dist-resolution`,
or runtime (`ERR_MODULE_NOT_FOUND`, `Cannot access 'X' before initialization`).

This skill is the **coverage pass** that runs after such a merge: detect the incoming
non-ESM sources, convert them with the migration's own tooling, isolate what must stay CJS,
and drive the verification gates to green — finishing the merge in one pass while flagging
the few spots that need human judgment.

> **Premise**: the `esm-migration` / `esm-import-convention` tooling
> (`tools/codemod/*`, `tools/lint/*`, `bin/add-js-extensions.ts`,
> `bin/verify-dist-resolution.ts`) is present on the target branch. This skill orchestrates
> that tooling; it does not reimplement it. If a referenced tool is missing, the ESM specs
> have not been merged yet — stop and say so rather than improvising a substitute.

## When to use

- Right after `git merge <pre-ESM-branch>` into an ESM'd branch (`dev/8.0.x` and later),
  **before** committing the merge or opening a PR.
- When `lint:no-cjs`, `lint:import-convention`, `build:server`, or `verify-dist-resolution`
  start failing on files that were green before a merge.
- Not for net-new code authored on an ESM branch — that is covered by the normal lint gates.
  This skill is specifically for **imported** code that predates the convention.

## Operating mode

Autonomous: detect → convert → isolate → configure → verify, then report. Apply the
mechanical transforms without asking. **Only pause to ask** for the genuinely ambiguous
spots listed under [Stop and ask](#stop-and-ask) — central-router factory DI, new
intentional cycle-breakers, and circular-dependency hazards.

## Step 1 — Scope the incoming files

Diff against the merge base, not the working tree, so you only touch what the merge brought in:

```bash
# files added/changed by the merged branch relative to the common ancestor
git diff --name-only "$(git merge-base HEAD MERGE_HEAD)"..MERGE_HEAD -- apps/app
# if the merge is already committed, use the first parent as the ESM base:
git diff --name-only HEAD^1..HEAD -- apps/app
```

Partition the result:

| Bucket | Glob | Treatment |
|---|---|---|
| **Server source** | `apps/app/src/server/**/*.{ts,js}` | Full CJS→ESM conversion (Step 2) |
| **Other src** | `apps/app/src/**/*.{ts,tsx}` (client, states, stores, utils) | Import-convention only (Step 3) |
| **Config consumed by CJS tools** | `apps/app/config/*.js`, new `*.config.js` | CJS isolation — `.cjs` (Step 4) |
| **Migrations** | `apps/app/src/migrations/*.js` | Stay CJS — verify isolation only (Step 4) |
| **Package manifests** | new `packages/*/package.json`, `apps/*/package.json` | `"type": "module"` (Step 5) |
| **Build config** | `next.config.ts`, `pnpm-workspace.yaml` | transpilePackages / overrides re-eval (Step 5) |

Skip `node_modules`, generated dirs, and `src/migrations/**` for the codemods (the
migrations dir is intentionally CJS).

## Step 2 — Convert server CJS → ESM

Run the migration codemod on the **server** buckets, leaf→root (models/events first, central
routers last) so circular-dependency breakage surfaces in the smallest possible step:

```bash
cd apps/app
pnpm codemod:cjs-to-esm -- src/server/models src/server/events
pnpm codemod:cjs-to-esm -- src/server/service
pnpm codemod:cjs-to-esm -- src/server/middlewares src/server/util src/server/pageserv
pnpm codemod:cjs-to-esm -- src/server/routes      # central routers (index.js) last
pnpm codemod:cjs-to-esm -- src/server/crowi
```

`cjs-to-esm.cjs` handles **8 patterns**:

1. `module.exports = …` / `exports.x = …` → `export …` (named / default)
2. `const x = require('./x')` → `import x from './x'`
3. `require('./x')(crowi, app)` factory invoke → `import { setup } from './x'` + explicit `const x = setup(crowi, app)`
4. ternary × factory invoke (non-async enclosing scope) → top-level hoisted `import` + invoke per branch
5. `const { x } = require('pkg')` → `import { x } from 'pkg'`
6. `require('pkg').member(…)` → `import { member } from 'pkg'`
7. `require(dynamicVar)(ctx)` → `(await import(dynamicVar)).default(ctx)` — **do NOT add instance memoization** (the ESM loader caches modules; memoizing `getUploader()` broke the `setUpFileUpload(isForceUpdate=true)` re-init contract once already)
8. exclusion list — intentional lazy `require`s are skipped (e.g. `crowi/index.ts` setupMailer's `~/server/service/mail`)

Then fix what the codemod intentionally leaves to a human:

- **`__dirname` / `__filename`** → `import.meta.dirname` / `import.meta.filename` (manual; e.g. `crowi/index.ts`, `crowi/dev.js`, `service/i18next.ts`).
- **New intentional lazy `require`** acting as a cycle-breaker → keep it, and **add it to the `EXCLUSION_LIST`** in `tools/codemod/cjs-to-esm.cjs` so future runs leave it alone.
- **Config specifiers** to `~/config/{migrate-mongo-config,next-i18next.config,i18next.config}` → ensure they carry `.cjs` (the codemod rewrites these; verify after).

### Circular-dependency rule (do not skip)

`crowi/index.ts` is the dependency **hub** — most server cycles route through it. Under CJS,
`require`'s lazy eval hid these; under ESM static hoisting they throw
`ReferenceError: Cannot access 'X' before initialization` at boot.

**Invariant: a service/event/model file must never `import` the `Crowi` class directly. It
receives the Crowi instance as an argument (factory DI).** If a merged file imports `Crowi`
at module top level to read a member, that is the bug — rewrite it to take `crowi` as a
parameter. If a new cycle cannot be broken by argument-passing, split the shared types into
an `interfaces.ts` (as `search-delegator` did) rather than lazy-loading on a hot path
(auth/ACL per-request).

## Step 3 — Normalize import convention (no extensions)

Pre-ESM branches usually have **no** extensions (fine), but merge-conflict resolutions and
support/mastra-style branches frequently reintroduce `.js`/`.jsx`. Strip them across all
touched `src` files:

```bash
cd apps/app
node tools/codemod/normalize-import-convention.cjs src   # strips .js/.jsx, normalizes /index barrels
```

> Do **not** run `add-import-extensions` on source — it *adds* extensions and is a
> build-output tool (`add-js-extensions.ts` does the equivalent over `dist/`). In source you
> only ever strip.

The hard rule (`apps/app/.claude/rules/import-convention.md`): **never write `.js`/`.jsx` in a
relative (`./`, `../`) or `~/` specifier** — value and type-only alike. `.js` is added only in
the build *output* by `bin/add-js-extensions.ts`, never in source. `normalize-import-convention.cjs`
is purely lexical: it strips extensions and normalizes `./sub/index.js` → `./sub`, `./index.js` → `.`,
while **preserving** each specifier's authored alias-vs-relative form. The alias-vs-relative
choice is a readability matter and is **not** linted — follow the natural convention by hand
(nearby = relative, distant/cross-area = `~/`).

## Step 4 — Isolate what must stay CJS

- **New config files** consumed by `migrate-mongo` / `i18next` / `nodemon` (anything that loads
  them as CJS) → rename `*.js` → `*.cjs`, and update every importer specifier to `.cjs`.
- **New migrations** (`src/migrations/*.js`) → leave as CJS. Confirm `src/migrations/package.json`
  (`{ "type": "commonjs" }`) exists and that `tsconfig.build.server.json`'s `exclude` still
  covers `src/migrations/**`. If the merge added migrations in a new location, extend the
  isolation, do not ESM-convert them (migrate-mongo is not ESM-capable).

## Step 5 — Package & build config

- **New buildable package** without `"type"` → add `"type": "module"` (unless it must stay CJS,
  which then needs `.cjs` entry points). New deps in `bin/` workspace default to CJS and need no change.
- **New runtime deps** pulled in by the merge → re-evaluate `next.config.ts` `getTranspilePackages()`
  (remove anything that resolves natively as ESM; keep + inline-comment what genuinely needs it)
  and `pnpm-workspace.yaml` overrides (only CJS-pin entries — never touch `axios` or other
  security pins).

## Step 6 — Verification gates (the safety net)

Run in order; a clean run is the proof the coverage pass is complete. Do **not** declare done
on conversion alone — these gates catch what the codemods missed.

```bash
cd apps/app
pnpm run lint:no-cjs                 # residual require/module.exports in src/server
pnpm run lint:import-convention      # any .js/.jsx left in relative/~ specifiers
pnpm run lint:route-guard            # central-router top-level invariant
pnpm run build:server                # Bundler type-check of extensionless source (tsgo/tspc)
pnpm run postbuild:server            # add-js-extensions over dist
node bin/verify-dist-resolution.ts dist   # exhaustive: every dist import points to a real file
pnpm run server:ci                   # boot smoke — loads every module (catches init-time cycles)
```

`verify-dist-resolution` is the strongest gate: it checks the emitted `dist/` graph
exhaustively (including lazy/conditional imports) and does not false-positive on dead
`.tsx→.jsx` emit. A single unresolved entry fails CI — chase it back to the source specifier.

## Stop and ask

Pause and use `AskUserQuestion` (do not guess) when:

- A **central router** (`routes/index.js`, `routes/apiv3/index.js`) factory-DI conversion is
  ambiguous — these concentrate dozens of injected setups and a wrong rewrite can silently
  drop a middleware or change an auth path.
- You find a **new circular dependency** that argument-passing alone can't break (needs a
  structural split decision).
- A merged file mixes ESM and CJS in a way the 8 patterns don't cover, or a `require` looks
  intentional-lazy but isn't in the exclusion list.

## Report

Summarize: files converted (by bucket), specifiers normalized, configs isolated, gates run
and their result, and an explicit list of **unresolved / human-judgment** items
(`verify-dist-resolution` unresolved entries, new exclusion-list additions, central-router
conversions, cycle splits). The merge is not done until the gates are green and that list is
empty or explicitly accepted.

## References

- Specs: `.kiro/specs/esm-migration/` (core CJS→ESM, design.md Codemod Transform = the 8 patterns,
  circular-dependency baseline) and `.kiro/specs/esm-import-convention/` (no-extension convention,
  emit-time `.js`, dist verification).
- Rule: `apps/app/.claude/rules/import-convention.md`.
- Tools: `tools/codemod/{cjs-to-esm,normalize-import-convention,add-import-extensions,migrations-cjs-to-esm}.cjs`,
  `tools/lint/{import-extension-guard,route-top-level-guard}.cjs`,
  `bin/{add-js-extensions,verify-dist-resolution,postbuild-server}.ts`.
