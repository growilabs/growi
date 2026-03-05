---
name: build-optimization
description: GROWI apps/app Turbopack configuration, module optimization, and build measurement tooling. Auto-invoked when working in apps/app.
user-invokable: false
---

# Build Optimization (apps/app)

## Next.js Version & Bundler

- **Next.js 16** (`^16.0.0`) with **Turbopack** bundler (default)
- Build: `next build`; Dev: Express server calls `next({ dev })` which uses Turbopack by default
- React stays at `^18.2.0` — Pages Router has full React 18 support in v16
- Webpack has been fully removed (no `webpack()` hook, no `--webpack` flag)

## Turbopack Configuration

### Custom Loader Rules (`turbopack.rules`)

| Rule | Pattern | Condition | Purpose |
|------|---------|-----------|---------|
| superjson-ssr-loader | `*.page.ts`, `*.page.tsx` | `{ not: 'browser' }` (server-only) | Auto-wraps `getServerSideProps` with SuperJSON serialization |

- Loaders are registered in `next.config.ts` under `turbopack.rules`
- `condition: { not: 'browser' }` restricts the loader to server-side compilation only
- `as: '*.ts'` / `as: '*.tsx'` tells Turbopack to continue processing the transformed output as TypeScript

### Resolve Aliases (`turbopack.resolveAlias`)

7 server-only packages + `fs` are aliased to `./src/lib/empty-module.ts` in browser context:

| Package | Reason |
|---------|--------|
| `fs` | Node.js built-in, not available in browser |
| `dtrace-provider` | Native module, server-only |
| `mongoose` | MongoDB driver, server-only |
| `i18next-fs-backend` | File-system i18n loader, server-only |
| `bunyan` | Server-side logger |
| `bunyan-format` | Server-side logger formatter |
| `core-js` | Server-side polyfills |

- Uses conditional `{ browser: './src/lib/empty-module.ts' }` syntax so server-side resolution is unaffected
- `resolveAlias` requires **relative paths** (e.g., `./src/lib/empty-module.ts`), not absolute paths — absolute paths cause "server relative imports are not implemented yet" errors
- If a new server-only package leaks into the client bundle, add it to `resolveAlias` with the same pattern

## SuperJSON Serialization Architecture

The `next-superjson` SWC plugin was replaced by a custom loader:

- **Build time**: `superjson-ssr-loader.ts` auto-wraps `getServerSideProps` in `.page.{ts,tsx}` files with `withSuperJSONProps()` via Turbopack `rules`
- **Runtime (server)**: `withSuperJSONProps()` in `src/pages/utils/superjson-ssr.ts` serializes props via superjson
- **Runtime (client)**: `_app.page.tsx` calls `deserializeSuperJSONProps()` for centralized deserialization
- **No per-page changes needed** — new pages automatically get superjson serialization
- Custom serializers registered in `_app.page.tsx` (ObjectId, PageRevisionWithMeta)

## CSS Modules Turbopack Compatibility

### `:global` Syntax

Turbopack only supports the **function form** `:global(...)`. The block form `:global { ... }` is NOT supported:

```scss
// WRONG — Turbopack rejects this
.parent :global {
  .child { color: red; }
}

// CORRECT — function form
.parent {
  :global(.child) { color: red; }
}
```

Nested blocks must also use function form:

```scss
// WRONG
.parent :global {
  .child {
    .grandchild { }
  }
}

// CORRECT
.parent {
  :global(.child) {
    :global(.grandchild) { }
  }
}
```

### Other Turbopack CSS Restrictions

- **Standalone `:local` / `&:local`**: Not supported. Inside `:global(...)`, properties are locally scoped by default — remove `&:local` wrappers
- **`@extend` with `:global()`**: `@extend .class` fails when target is wrapped in `:global(.class)` — Sass doesn't match them as the same selector. Use shared selector groups (comma-separated selectors) instead
- **IE CSS hacks**: `*zoom:1`, `*display:inline`, `filter:alpha()` cannot be parsed by Turbopack's CSS parser (lightningcss). Avoid CSS files containing these hacks

### Vendor CSS Imports

Global CSS cannot be imported from files other than `_app.page.tsx` under Turbopack Pages Router. See the `vendor-styles-components` skill for the precompilation system that handles per-component vendor CSS.

## Module Optimization Configuration

- `bundlePagesRouterDependencies: true` — bundles server-side dependencies for Pages Router
- `serverExternalPackages: ['handsontable']` — packages excluded from server-side bundling
- `optimizePackageImports` — 11 `@growi/*` packages configured (expansion to third-party packages was tested and reverted — it increased dev module count)

## Effective Module Reduction Techniques

Techniques that have proven effective for reducing module count, ordered by typical impact:

| Technique | When to Use |
|-----------|-------------|
| `next/dynamic({ ssr: true })` | Heavy rendering pipelines (markdown, code highlighting) that can be deferred to async chunks while preserving SSR |
| `next/dynamic({ ssr: false })` | Client-only heavy components (e.g., Mermaid diagrams, interactive editors) |
| Subpath imports | Packages with large barrel exports (e.g., `date-fns/format` instead of `date-fns`) |
| Deep ESM imports | Packages that re-export multiple engines via barrel (e.g., `react-syntax-highlighter/dist/esm/prism-async-light`) |
| resolveAlias | Server-only packages leaking into client bundle via transitive imports |
| Lightweight replacements | Replace large libraries used for a single feature (e.g., `tinykeys` instead of `react-hotkeys`, regex instead of `validator`) |

### Techniques That Did NOT Work

- **Expanding `optimizePackageImports` to third-party packages** — In dev mode, this resolves individual sub-module files instead of barrel, resulting in MORE module entries. Reverted.
- **Refactoring internal barrel exports** — Internal barrels (`states/`, `features/`) are small and well-scoped; refactoring had no measurable impact.

## i18n HMR

`I18NextHMRPlugin` was removed during the Turbopack migration. Translation file changes require a manual browser refresh. The performance gain from Turbopack (faster Fast Refresh overall) outweighs the loss of i18n-specific HMR. Monitor if `i18next-hmr` adds Turbopack support in the future.
