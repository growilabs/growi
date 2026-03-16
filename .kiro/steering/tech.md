# Technology Stack

See: `.claude/skills/tech-stack/SKILL.md` (auto-loaded by Claude Code)

## cc-sdd Specific Notes

### Bundler Strategy (Project-Wide Decision)

GROWI uses **Turbopack** (Next.js 16 default) for development. Webpack fallback is available via `USE_WEBPACK=1` environment variable for debugging. Production builds still use `next build --webpack`. All custom webpack loaders/plugins have been migrated to Turbopack equivalents (`turbopack.rules`, `turbopack.resolveAlias`). See `apps/app/.claude/skills/build-optimization/SKILL.md` for details.

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

**Packages justified to stay in `dependencies`** (SSR-reachable static imports as of v7.5):
- `react-toastify` — `toastr.ts` static import reachable from client components in SSR pages
- `@codemirror/state`, `@headless-tree/*`, `@tanstack/react-virtual`, `downshift`, `fastest-levenshtein`, `pretty-bytes`, `react-copy-to-clipboard`, `react-hook-form`, `react-input-autosize`, `simplebar-react` — statically imported in SSR-rendered components

For apps/app-specific build optimization details (webpack config, null-loader rules, SuperJSON architecture, module count KPI), see `apps/app/.claude/skills/build-optimization/SKILL.md`.

---
_Updated: 2026-03-03. apps/app details moved to `apps/app/.claude/skills/build-optimization/SKILL.md`._
