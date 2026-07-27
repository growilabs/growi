---
name: esm-merge-coverage
description: ESM-ify source files that arrive from a pre-ESM branch when merging into apps/app. Use after merging any branch that predates the v8 ESM migration (long-lived feature branches cut from v7-era master, v7.5 maintenance work) into master or a v8 branch — a git merge does NOT re-run any ESM transform, so incoming CJS/extension-bearing sources slip in silently and only break at build/runtime. Auto-invoked when the conversation is about merging a pre-ESM branch into apps/app and bringing the result up to the ESM convention.
user-invocable: true
---

# ESM Merge Coverage (apps/app)

`apps/app` is native ESM since v8 (master is the v8 mainline), so **every merge from a
pre-ESM branch reopens the migration for the files it carries.** A `git merge` copies
source verbatim — it does not run any codemod, lint, or build step — so code written in
the old style (`require`, `module.exports`, `__dirname`, `.js` in specifiers) lands
unconverted and only fails later at `build:server` type-check, `verify-dist-resolution`,
or runtime (`ERR_MODULE_NOT_FOUND`, `Cannot access 'X' before initialization`).

This skill is the **coverage pass** that runs after such a merge: detect the incoming
non-ESM sources, convert them with the migration's own tooling, isolate what must stay CJS,
and drive the verification gates to green — finishing the merge in one pass while flagging
the few spots that need human judgment.

> **Premise**: the tooling listed under [Tools](#tools) is present on the target branch.
> This skill orchestrates that tooling; it does not reimplement it. If a referenced tool is
> missing, stop and say so rather than improvising a substitute (`tool-manifest.spec.ts`
> next to this file fails CI when a path drifts).

## When to use

- Right after `git merge <pre-ESM-branch>` into master or any v8 branch, **before**
  committing the merge or opening a PR.
- When `lint:no-cjs`, `lint:import-convention`, `build:server`, or `verify-dist-resolution`
  start failing on files that were green before a merge.
- Not for net-new code authored on an ESM branch — that is covered by the normal lint gates
  and `.claude/rules/esm-authoring.md`. This skill is specifically for **imported** code
  that predates the convention.

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
| **Migrations** | `apps/app/src/migrations/*.js` | Convert to ESM with named exports (Step 4) |
| **Package manifests** | new `packages/*/package.json`, `apps/*/package.json` | `"type": "module"` (Step 5) |
| **Build config** | `next.config.ts`, `pnpm-workspace.yaml` | transpilePackages / overrides re-eval (Step 5) |

Skip `node_modules` and generated dirs. `src/migrations/**` gets its own codemod
(Step 4) — do not run the server codemod over it.

## Step 2 — Convert server CJS → ESM

Run the migration codemod on the **server** buckets, leaf→root (models/events first, central
routers last) so circular-dependency breakage surfaces in the smallest possible step:

```bash
cd apps/app
node tools/codemod/cjs-to-esm.cjs src/server/models src/server/events
node tools/codemod/cjs-to-esm.cjs src/server/service
node tools/codemod/cjs-to-esm.cjs src/server/middlewares src/server/util src/server/pageserv
node tools/codemod/cjs-to-esm.cjs src/server/routes      # central routers (index.js) last
node tools/codemod/cjs-to-esm.cjs src/server/crowi
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
- **Config specifiers** to `~/config/migrate-mongo-config` → ensure they carry `.cjs` (the codemod rewrites these; verify after). The i18next configs are `.mjs` and need no suffix in the specifier.

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
branches that were themselves partway through an ESM conversion frequently reintroduce
`.js`/`.jsx`. Strip them across all touched `src` files:

```bash
cd apps/app
node tools/codemod/normalize-import-convention.cjs src   # strips .js/.jsx, normalizes /index barrels
```

> Extensions are **only ever added to build output**, by `bin/add-js-extensions.ts` over
> `dist/`. In source you only ever strip.

The hard rule (`apps/app/.claude/rules/import-convention.md`): **never write `.js`/`.jsx` in a
relative (`./`, `../`) or `~/` specifier** — value and type-only alike. `.js` is added only in
the build *output* by `bin/add-js-extensions.ts`, never in source. `normalize-import-convention.cjs`
is purely lexical: it strips extensions and normalizes `./sub/index.js` → `./sub`, `./index.js` → `.`,
while **preserving** each specifier's authored alias-vs-relative form. The alias-vs-relative
choice is a readability matter and is **not** linted — follow the natural convention by hand
(nearby = relative, distant/cross-area = `~/`).

## Step 4 — Convert migrations, isolate what genuinely must stay CJS

- **New migrations** (`src/migrations/*.js`) → **convert to ESM**. Migrations are ESM on
  this branch (there is no `src/migrations/package.json` isolation any more), and
  `migrate-mongo` reads `migration.up` / `migration.down` off the loaded module, so they
  need **named exports** — `export async function up() {}`, never `module.exports = {…}`
  (which throws under `type: module`) and never `export default { up, down }` (which leaves
  `migration.up` undefined).

  ```bash
  cd apps/app
  node tools/codemod/migrations-cjs-to-esm.cjs src/migrations   # requires jscodeshift installed
  ```

  A merge typically leaves a *hybrid* file — ESM `import` at the top plus a CJS
  `module.exports` at the bottom — which passes review by eye and dies at run time. If
  `jscodeshift` is not installed in the current environment, apply the codemod's
  transformation by hand and verify with `node --check`.
- **New config files** consumed by a CJS-only CLI (`migrate-mongo` is the remaining one)
  → keep them `.cjs`, with a hand-written `.d.cts` sibling, and update every importer
  specifier to `.cjs`. Config consumed by ESM-capable tooling should be `.mjs`
  (`config/i18next.config.mjs`, `config/next-i18next.config.mjs` are the precedent).

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

## Tools

The tools live in the repo (inside Biome's and CI's reach), not in this skill directory;
this list is the binding between them and `tool-manifest.spec.ts` fails when a path
drifts. All paths are relative to `apps/app/`.

| Tool | Role |
|---|---|
| `tools/codemod/cjs-to-esm.cjs` | CJS→ESM conversion of server source (the 8 patterns above). Migration-only: it exists for pre-ESM merges |
| `tools/codemod/migrations-cjs-to-esm.cjs` | migrate-mongo migrations → ESM with named `up`/`down` |
| `tools/codemod/normalize-import-convention.cjs` | Strips `.js`/`.jsx` from relative / `~/` specifiers, normalises `/index` barrels (also the everyday batch fixer for the lint below) |
| `tools/lint/import-extension-guard.cjs` | `lint:import-convention` — fails on any `.js`/`.jsx` in a relative / `~/` specifier |
| `tools/lint/route-top-level-guard.cjs` | `lint:route-guard` (central-router top-level invariant) and `lint:no-cjs` (`--cjs-only`) |
| `bin/add-js-extensions.ts` | Post-build: adds `.js` / `/index.js` / `.jsx` to `dist/` specifiers |
| `bin/verify-dist-resolution.ts` | CI: every relative import in `dist/` points at a real file |
| `bin/postbuild-server.ts` | `postbuild:server` — moves `transpiled/` → `dist/` and invokes `add-js-extensions` |

The codemods need `jscodeshift` (a devDependency); it is occasionally missing in a fresh
environment, in which case both the codemods and `lint:import-convention` fail to run —
install first rather than hand-editing at scale.

## Related documentation

- `apps/app/.claude/rules/import-convention.md` — the no-extension convention (canonical).
- `apps/app/.claude/rules/esm-authoring.md` — native-ESM traps that survive build and boot
  (JSON import attributes, `__dirname`, CJS default-import interop, TS2742, the
  no-`Crowi`-import cycle invariant). Read it before converting anything by hand.
- `apps/app/.claude/skills/app-commands/SKILL.md` — smoke-testing procedures, including the
  authorization-matrix regression check and the external-plugin install smoke.
