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

Search all import sites of the broken package:

```bash
grep -rn "from ['\"]<package-name>['\"]" apps/app/src/
grep -rn "import(['\"]<package-name>['\"])" apps/app/src/
```

Apply the decision tree:

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
