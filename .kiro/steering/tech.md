# Technology Stack

The tech-stack overview lives in `AGENTS.md` / `apps/app/AGENTS.md` (auto-loaded via `CLAUDE.md`). This file records cc-sdd-specific build/runtime decisions.

## cc-sdd Specific Notes

### Module System (native ESM)

Since the ESM migration (2026-06), the workspace root, `apps/app`, and the 17 shared `@growi/*` packages under `packages/*` all declare `"type": "module"`. `apps/app`'s Express server is built with `module: NodeNext` to native ESM under `dist/server/`, and **the runtime path contains no `ts-node` / `tsx`** — TypeScript runs via Node v24's built-in type stripping:

- **Production**: `node --import dotenv-flow/config.js dist/server/app.js` (`server:ci` adds `--ci` for load-only smoke)
- **Dev**: `nodemon` → Node v24 native TS + an in-thread resolve-only hook (`apps/app/bin/dev-esm-resolver.mjs`) that maps `~/`/`^/` aliases and `.js`→`.ts`

Node 24's `require(esm)` lets residual CommonJS consumers (e.g. third-party `@lykmapipo/common`) load ESM-only transitive deps, **but it returns a module *namespace* object, not the CJS default export**. Packages that read members off the default (e.g. `mime.getType`) still need a CJS pin; packages that use named members (e.g. `flat.flatten`) work natively. This is why `pnpm-workspace.yaml` keeps the `@lykmapipo/common>mime` pin but no longer needs the `flat` / `parse-json` pins (esm-migration Phase 5).

### Bundler Strategy (Project-Wide Decision)

GROWI uses **Turbopack** (Next.js 16 default) for **both development and production builds** (`next build` without flags). Webpack fallback is available via `USE_WEBPACK=1` environment variable for debugging only. All custom webpack loaders/plugins have been migrated to Turbopack equivalents (`turbopack.rules`, `turbopack.resolveAlias`). See `apps/app/.claude/skills/build-optimization/SKILL.md` for details.

`transpilePackages` is now **empty**: once `apps/app` became native ESM, Turbopack resolves the ESM-only unified/remark/rehype ecosystem (and superjson) natively, so the former 40 hardcoded + 6 prefix-group entries were all removed during the migration (Phase 4). See `apps/app/next.config.ts` for the rationale comment.

### Import Optimization Principles

To prevent module count regression across the monorepo:

- **Subpath imports over barrel imports** — e.g., `import { format } from 'date-fns/format'` instead of `from 'date-fns'`
- **Lightweight replacements** — prefer small single-purpose packages over large multi-feature libraries
- **Server-client boundary** — never import server-only code from client modules; extract client-safe utilities if needed

### Turbopack Externalisation Rule (`apps/app/package.json`)

**Any package that is reachable via a static `import` statement in SSR-executed code must be listed under `dependencies`, not `devDependencies`.**

Turbopack externalises such packages to `.next/node_modules/` (symlinks into the pnpm store). `pnpm deploy --prod` only includes `dependencies`; packages in `devDependencies` are absent from the deploy output, causing `ERR_MODULE_NOT_FOUND` at production server startup.

**SSR-executed code** = any module that Turbopack statically traces from a Pages Router page component, `_app.page.tsx`, or a server-side utility — without crossing a `dynamic(() => import(...), { ssr: false })` boundary.

**Making a package devDep-eligible:**
1. Wrap the consuming component with `dynamic(() => import('...'), { ssr: false })`, **or**
2. Replace the runtime dependency with a static asset (e.g., extract data to a committed JSON file), **or**
3. Change the import to a dynamic `import()` inside a `useEffect` (browser-only execution).

**Packages justified to stay in `dependencies`** (SSR-reachable static imports as of v8):
- `react-toastify` — `toastr.ts` static `{ toast }` import reachable from SSR pages; async refactor would break API surface
- `bootstrap` — still externalised despite `useEffect`-guarded `import()` in `_app.page.tsx`; Turbopack traces call sites statically
- `diff2html` — still externalised despite `ssr: false` on `RevisionDiff`; static import analysis reaches it
- `react-dnd`, `react-dnd-html5-backend` — still externalised despite DnD provider wrapped with `ssr: false`
- `@handsontable/react` — still externalised despite `useEffect` dynamic import in `HandsontableModal`
- `i18next-http-backend`, `i18next-localstorage-backend`, `react-dropzone` — no direct `src/` imports but appear via transitive imports
- `@codemirror/state`, `@headless-tree/*`, `@tanstack/react-virtual`, `downshift`, `fastest-levenshtein`, `pretty-bytes`, `react-copy-to-clipboard`, `react-hook-form`, `react-input-autosize`, `simplebar-react` — statically imported in SSR-rendered components

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

### Logging

The monorepo uses **pino** (via `@growi/logger`) as the standard logging library. Legacy bunyan usage has been migrated.

---
_Updated: 2026-06-16. Added Module System (native ESM) section + transpilePackages-empty note; refreshed broken skill reference, pnpm v11 / v8 annotations (esm-migration Phase 5.5)._
