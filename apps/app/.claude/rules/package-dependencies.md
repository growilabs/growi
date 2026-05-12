# Package Dependency Classification (Turbopack)

## The Rule

> Any package that appears in `apps/app/.next/node_modules/` after a production build MUST be listed under `dependencies`, not `devDependencies`.

Turbopack externalises packages by generating runtime symlinks in `.next/node_modules/`. `pnpm deploy --prod` excludes `devDependencies`, so any externalised package missing from `dependencies` causes `ERR_MODULE_NOT_FOUND` in production.

## How to Classify a New Package

**Step 1 — Build and check:**

```bash
turbo run build --filter @growi/app
ls apps/app/.next/node_modules/ | grep <package-name>
```

- **Found** → `dependencies`
- **Not found** → `devDependencies` (if runtime code) or `devDependencies` (if build/test only)

**Step 2 — If unsure, check the import site:**

| Import pattern | Classification |
|---|---|
| `import foo from 'pkg'` at module level in SSR-executed code | `dependencies` |
| `import type { Foo } from 'pkg'` only | `devDependencies` (type-erased at build) |
| `await import('pkg')` inside `useEffect` / event handler | Check `.next/node_modules/` — may still be externalised (see `fix-broken-next-symlinks` skill) |
| Used only in `*.spec.ts`, build scripts, or CI | `devDependencies` |

## Common Misconceptions

**`dynamic({ ssr: false })` does NOT prevent Turbopack externalisation.**
It skips HTML rendering for that component but Turbopack still externalises packages found via static import analysis inside the dynamically-loaded file.

**`useEffect`-guarded `import()` does NOT guarantee devDependencies.**
Bootstrap and i18next backends are loaded this way yet still appear in `.next/node_modules/` due to transitive imports.

## Packages Confirmed as devDependencies (Verified)

These were successfully removed from production artifact by eliminating their SSR import path:

| Package | Technique |
|---|---|
| `fslightbox-react` | Replaced static import with `import()` inside `useEffect` in `LightBox.tsx` |
| `socket.io-client` | Replaced static import with `await import()` inside `useEffect` in `admin/states/socket-io.ts` |
| `@emoji-mart/data` | Replaced runtime import with bundled static JSON (`emoji-native-lookup.json`) |

## Verifying the Production Artifact

### Level 1 — Externalisation check (30–60 s, local, incremental)

Just want to know if a package gets externalised by Turbopack?

```bash
turbo run build --filter @growi/app
ls apps/app/.next/node_modules/ | grep <package-name>
# Found → dependencies required
# Not found → devDependencies is safe
```

Turbopack build is incremental via cache, so subsequent runs after the first are fast.

### Level 2 — CI (`reusable-app-prod.yml`, authoritative)

Trigger via `workflow_dispatch` before merging. Runs two jobs:

1. **`build-prod`**: `turbo run build` → `assemble-prod.sh` → **`check-next-symlinks.sh`** → archives production tarball
2. **`launch-prod`**: extracts the tarball into a clean isolated directory (no workspace-root `node_modules`), runs `pnpm run server:ci`

`check-next-symlinks.sh` scans every symlink in `.next/node_modules/` and fails the build if any are broken (except `fslightbox-react` which is intentionally broken but harmless). This catches classification errors regardless of which code paths are exercised at runtime.

`server:ci` = `node dist/server/app.js --ci`: the server starts fully (loading all modules), then immediately exits with code 0. If any module fails to load (`ERR_MODULE_NOT_FOUND`), the process exits with code 1, failing the CI job.

This exactly matches Docker production (no workspace fallback). A `build-prod` or `launch-prod` failure definitively means a missing `dependencies` entry.
