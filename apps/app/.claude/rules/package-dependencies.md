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
| `await import('pkg')` inside `useEffect` / event handler | Check `.next/node_modules/` — may still be externalised |
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

Use the lightest check that fits the situation.

### Level 1 — Externalisation check (30–60 s, incremental)

Just want to know if a package gets externalised by Turbopack? Only a build is needed.
`assemble-prod.sh` and server startup are not required.

```bash
turbo run build --filter @growi/app
ls apps/app/.next/node_modules/ | grep <package-name>
# Found → dependencies required
# Not found → devDependencies is safe
```

Turbopack build is incremental via cache, so subsequent runs after the first are fast.

### Level 2 — Symlink integrity check (adds ~30 s)

Want to confirm all `.next/node_modules/` symlinks resolve (no broken links)?

```bash
bash apps/app/bin/assemble-prod.sh

cd apps/app && find .next/node_modules -maxdepth 2 -type l | while read link; do
  linkdir=$(dirname "$link"); target=$(readlink "$link")
  resolved=$(cd "$linkdir" 2>/dev/null && realpath -m "$target" 2>/dev/null || echo "UNRESOLVABLE")
  { [ "$resolved" = "UNRESOLVABLE" ] || [ ! -e "$resolved" ]; } && echo "BROKEN: $link"
done
# Zero output (except fslightbox-react which is intentionally broken but harmless)

git show HEAD:apps/app/next.config.ts > apps/app/next.config.ts
```

### Level 3 — Full server smoke test (adds ~60 s, for release gate only)

```bash
# assemble-prod.sh already run in Level 2; do NOT restore next.config.ts yet
cd apps/app && pnpm run server > /tmp/server.log 2>&1 &
timeout 90 bash -c 'until grep -q "Express server is listening" /tmp/server.log; do sleep 2; done'

# Use / not /login — /login returns 200 even when SSR is broken
curl -s -o /tmp/res.html -w "%{http_code}" http://localhost:3000/
grep -c "ERR_MODULE_NOT_FOUND" /tmp/server.log  # must be 0

kill $(lsof -ti:3000)
git show HEAD:apps/app/next.config.ts > apps/app/next.config.ts
```
