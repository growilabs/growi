# Import Convention (apps/app/src)

All source files in `apps/app/src` follow a **single, no-extension import convention** (since esm-import-convention, 2026-06). This replaces the former dual-notation scheme (`~/X.js` alias for NodeNext-program files, extensionless relative for client-only files) introduced during esm-migration.

## The Rule

| Reference target | Required form | Example |
|---|---|---|
| Same-dir / descendant / ancestor / sibling-dir (local — same `src/` first-level dir) | Extensionless **relative** | `./AuthorInfo`, `../FormattedDistanceDate` |
| Cross-module (different `src/` first-level dir) | Extensionless **`~/` alias** | `~/states/context`, `~/stores/bookmark` |
| External packages, `.json`, `.cjs`, `.scss` | Unchanged | `mongoose`, `^/config/i18next.config.cjs` |

**Never write `.js` / `.jsx` in a relative or `~/` import specifier.** Applies to value and type-only imports alike.

```typescript
// ❌ WRONG: extension in source
import { foo } from './foo.js';
import { ctx } from '~/states/context.js';

// ✅ CORRECT: no extension
import { foo } from './foo';
import { ctx } from '~/states/context';
import { bar } from '../bar';          // local (same src/ subtree) → relative
import mongoose from 'mongoose';        // external package → unchanged
```

## Why no `.js` in source

The friction this convention removes: the server production build runs `tspc -p tsconfig.build.server.json` whose NodeNext program pulls in ~1142 `src` files (client `.tsx` included, via the import graph). Native ESM requires `.js` on relative imports, but Turbopack cannot rewrite a relative `.js`→`.ts`, so previously "dual-pipeline" files needed `~/...js` aliases to satisfy both — and which form to use depended on the file's (invisible) NodeNext-program membership.

Instead, **`.js` lives only in the build output, not in source**:
- The server build uses `module: Preserve` / `moduleResolution: Bundler`, so it type-checks extensionless source.
- Post-build `bin/add-js-extensions.mjs` resolves each relative specifier against the real `dist/` filesystem and appends the correct form (`.js`, `/index.js`, `.jsx`).
- CI runs `bin/verify-dist-resolution.mjs` to confirm every relative import in `dist/` points to an existing file (replaces the NodeNext compile-time guarantee with an exhaustive artifact check — stronger, since it also covers lazy/conditional imports).
- Turbopack (client), `tsgo --noEmit` (Bundler), vitest, and the dev resolver (`bin/dev-esm-resolver.mjs`) all resolve extensionless source natively — no change.

> Verify server-side resolution with `pnpm exec tspc -p tsconfig.build.server.json --noEmit` (NodeNext), **not only** `tsgo` (Bundler) — tsgo accepts extensionless and does not prove the server build.

## Tooling

- **Enforcement**: `pnpm run lint:import-convention` (`tools/lint/import-extension-guard.cjs`) — fails CI on any `.js`/`.jsx` in a relative/`~/` specifier.
- **Batch migration**: `tools/codemod/normalize-import-convention.cjs` (full-`src` transform; reuses `ssr-relative-to-alias.cjs` AST helpers).
