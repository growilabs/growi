# Import Convention (apps/app/src)

Source files in `apps/app/src` follow a **no-extension import convention** (since
esm-import-convention, 2026-06): a relative (`./`, `../`) or `~/` alias specifier
**must not carry a `.js` / `.jsx` extension**. The required `.js` is added only in the
server build *output*, never written in source.

This replaces the former dual-notation scheme (`~/X.js` alias for NodeNext-program
files, extensionless relative for client-only files) that esm-migration introduced —
under which *which* form a file had to use depended on its invisible NodeNext-program
membership. Removing `.js` from source removes that coupling: both forms now resolve
everywhere, so the choice is free.

## The Rule

**The only hard rule: never write `.js` / `.jsx` in a relative or `~/` specifier**
(value and type-only imports alike).

```typescript
// ❌ WRONG: extension in source
import { foo } from './foo.js';
import { ctx } from '~/states/context.js';

// ✅ CORRECT: no extension
import { foo } from './foo';
import { ctx } from '~/states/context';
```

| Specifier kind | Form |
|---|---|
| Relative (`./`, `../`) and `~/` alias | Extensionless (`./foo`, `~/states/context`); a directory/barrel import is `.` / `./sub`, never `./sub/index.js` |
| External packages, `^/`, `.json`, `.cjs`, `.scss` | Unchanged |

**Only the no-extension rule is enforced.** Extensionless `~/` aliases and extensionless
relative paths resolve identically in every pipeline (server build, Turbopack, `tsgo`,
vitest, dev resolver), so the alias-vs-relative choice is a readability matter, not a
correctness one, and the lint does **not** police it.

The codebase follows the **natural convention**: a nearby reference (same area of `src/`)
uses a relative path (`./Sibling`, `../Near`), and a distant / cross-area reference uses
a `~/` alias (`~/states/context`). The esm-import-convention migration restored this form
to match the base branch — esm-migration had temporarily rewritten many nearby relatives
to `~/…js` aliases to satisfy NodeNext, and removing `.js` from source makes that
workaround unnecessary. New code should follow the same natural convention by hand.

## Why no `.js` in source

The friction this convention removes: the server production build runs
`tspc -p tsconfig.build.server.json`, whose program pulls in ~1142 `src` files (client
`.tsx` included, via the import graph). Native ESM requires `.js` on relative imports,
but Turbopack cannot rewrite a relative `.js`→`.ts`, so previously "dual-pipeline" files
needed `~/...js` aliases to satisfy both — and which form to use depended on the file's
(invisible) NodeNext-program membership.

Instead, **`.js` lives only in the build output, not in source**:
- The server build uses `module: Preserve` / `moduleResolution: Bundler`, so it
  type-checks extensionless source.
- Post-build `bin/add-js-extensions.ts` resolves each relative specifier against the
  real `dist/` filesystem and appends the correct form (`.js`, `/index.js`, `.jsx`).
- CI runs `bin/verify-dist-resolution.ts` to confirm every relative import in `dist/`
  points to an existing file (replaces the NodeNext compile-time guarantee with an
  exhaustive artifact check — stronger, since it also covers lazy/conditional imports).
- Turbopack (client), `tsgo --noEmit` (Bundler), vitest, and the dev resolver
  (`bin/runtime/dev-esm-resolver.mjs`) all resolve extensionless source natively — no change.

> Server-side native-ESM resolution is proven by `bin/verify-dist-resolution.ts` over
> the emitted `dist/` (exhaustive, decision-free), **not** by source type-checking: the
> server build (`tspc`, Bundler) and `tsgo` both accept extensionless source and neither
> proves the emitted `.js` graph resolves.

## Tooling

- **Enforcement**: `pnpm run lint:import-convention` (`tools/lint/import-extension-guard.cjs`)
  — fails CI on any `.js`/`.jsx` in a relative/`~/` specifier. It checks extensions
  only; it does not police the alias-vs-relative choice.
- **Batch migration**: `tools/codemod/normalize-import-convention.cjs` — a purely lexical
  transform that strips `.js`/`.jsx` and normalises `/index` barrels while **preserving**
  each specifier's authored alias/relative form (no collapse, no filesystem resolution).
