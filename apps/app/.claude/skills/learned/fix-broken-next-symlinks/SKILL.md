---
name: fix-broken-next-symlinks
description: Fix broken symlinks in .next/node_modules/ — diagnose, decide allowlist vs dependencies, and verify
---

## IMPORTANT

This document is a **mandatory step-by-step procedure**. When fixing broken symlinks, execute every step in order. In particular, verification **always** requires the full 3-command sequence: `build` → `assemble-prod.sh` → `check-next-symlinks.sh`. Never skip `assemble-prod.sh` — the symlink check is only meaningful after production assembly.

## Problem

Turbopack externalizes packages into `.next/node_modules/` as symlinks, even for packages imported only via dynamic `import()` inside `useEffect`. After `assemble-prod.sh` runs `pnpm deploy --prod`, `devDependencies` are excluded, breaking those symlinks. `check-next-symlinks.sh` detects these and fails the build.

## Diagnosis

### Step 1 — Reproduce locally

```bash
turbo run build --filter @growi/app
bash apps/app/bin/assemble-prod.sh
bash apps/app/bin/check-next-symlinks.sh
```

If the check reports `BROKEN: apps/app/.next/node_modules/<package>-<hash>`, proceed to Step 2.

### Step 2 — Determine the fix

**First, check whether the package is already in `dependencies`:**

```bash
grep -nE '"<package-name>"' apps/app/package.json   # which section?
```

- **It is in `devDependencies` (or absent)** → ordinary classification problem; apply the decision tree below.
- **It is already in `dependencies`** → this is NOT a classification problem. The package
  is present in the prod tarball, but under a *different* pnpm virtual-store directory than
  the build-time symlink expects. This is **peer-hash drift** → go to Step 3c. **Do NOT add
  it to ALLOWED_BROKEN** — if the package is used during SSR (most are), the broken symlink
  is dereferenced at render time (`require("<pkg>-<hash>/…")`) and the prod server crashes
  with `ERR_MODULE_NOT_FOUND`. ALLOWED_BROKEN would make CI green while breaking production.

Search all import sites of the broken package:

```bash
grep -rn "from ['\"]<package-name>['\"]" apps/app/src/
grep -rn "import(['\"]<package-name>['\"])" apps/app/src/
```

Apply the decision tree (only for packages NOT already in `dependencies`):

```
Is the package imported ONLY via:
  - `import type { ... } from 'pkg'`  (erased at compile time)
  - `await import('pkg')` inside useEffect / event handler  (client-side only, never SSR)

  YES → Add to ALLOWED_BROKEN in check-next-symlinks.sh  (Step 3a)
  NO  → Move from devDependencies to dependencies          (Step 3b)
```

### Step 3a — Add to allowlist

Edit `apps/app/bin/check-next-symlinks.sh`:

```bash
ALLOWED_BROKEN=(
  fslightbox-react
  @emoji-mart/data
  @emoji-mart/react
  socket.io-client
  <new-package>          # <-- add here
)
```

Use the bare package name (e.g., `socket.io-client`), not the hashed symlink name (`socket.io-client-46e5ba4d4c848156`).

### Step 3b — Move to dependencies

In `apps/app/package.json`, move the package from `devDependencies` to `dependencies`, then run `pnpm install`.

### Step 3c — Fix peer-hash drift (package already in `dependencies`)

The symlink name embeds pnpm's peer-resolution hash, e.g.

```
.next/node_modules/next-0db9878bdddd4b66
  -> ../../../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.7_…_e219871081…/node_modules/next
```

`pnpm deploy --prod --legacy` (run by `assemble-prod.sh`) **re-resolves** the production-only
graph, so a package whose peer set/versions differ between the full install and the prod
deploy lands in a *differently-hashed* `.pnpm` directory. The Turbopack-baked symlink, frozen
with the build-time hash, then dangles even though the package itself is in the prod tarball.

**Diagnose** — compare the build-time hash against the prod deploy (non-destructive):

```bash
# 1. build-time target (what the symlink expects)
readlink "apps/app/.next/node_modules/<pkg>-<hash>"

# 2. what `pnpm deploy --prod` actually produces
pnpm deploy /tmp/prod-out --prod --legacy --filter @growi/app
ls -d /tmp/prod-out/node_modules/.pnpm/<pkg>@*
```

The differing token between the two `.pnpm` dir names is the drifting peer (commonly an
**optional** peer such as `next`'s `@babel/core` — present in dev, re-resolved to another
patch in prod).

**Fix** — pin the drifting peer to a single version in `pnpm-workspace.yaml` → `overrides:`
so dev and prod resolve identically (pick the version the full install already uses, to keep
the build hash unchanged). Add a comment explaining why, then `pnpm install`. Example:

```yaml
# pnpm-workspace.yaml
overrides:
  '@babel/core': 7.29.7   # keep next's peer-hash stable across `pnpm deploy --prod`
```

> GROWI's overrides live in `pnpm-workspace.yaml`, **not** `package.json` `pnpm.overrides`
> (pnpm v11 ignores the latter when a workspace file is present).

> **Do not run `assemble-prod.sh` locally just to verify** — its step [2/4] `rm -rf node_modules`
> guts the workspace-root store (and in a sandboxed devcontainer the dir removal is denied
> *after* the contents are already deleted, leaving every `.next/node_modules` symlink broken —
> a false alarm). Prefer the non-destructive temp-deploy check above; if you must run the full
> sequence, restore afterward with `pnpm install`.

### Step 4 — Verify the fix

Re-run the full sequence:

```bash
turbo run build --filter @growi/app
bash apps/app/bin/assemble-prod.sh
bash apps/app/bin/check-next-symlinks.sh
```

Expected output: `OK: All apps/app/.next/node_modules symlinks resolve correctly.`

## Example

`socket.io-client` is used in two files:
- `src/states/socket-io/global-socket.ts` — `import type` + `await import()` inside `useEffect`
- `src/features/admin/states/socket-io.ts` — `import type` + `import()` inside `useEffect`

Both are client-only dynamic imports → added to `ALLOWED_BROKEN`, stays as `devDependencies`.

## When to Apply

- CI fails at "Check for broken symlinks in .next/node_modules" step
- `check-next-symlinks.sh` reports `BROKEN: apps/app/.next/node_modules/<package>-<hash>`
- After adding a new package or changing import patterns in apps/app
