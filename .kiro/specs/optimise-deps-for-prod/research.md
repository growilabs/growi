# Research & Design Decisions

---
**Purpose**: Capture discovery findings and rationale for the `optimise-deps-for-prod` specification.

**Usage**: Background investigation notes referenced by `design.md`.

---

## Summary

- **Feature**: `optimise-deps-for-prod`
- **Discovery Scope**: Extension — modifying `apps/app/package.json` and targeted source files
- **Key Findings**:
  - All 23 packages confirmed present in `apps/app/.next/node_modules/` after a Turbopack production build, verifying they are Turbopack SSR externals.
  - `pnpm deploy --prod --legacy` produces a pnpm-native isolated structure (`node_modules/.pnpm/` + symlinks), NOT a flat/hoisted layout; transitive deps are only in `.pnpm/`, not hoisted to top-level.
  - Three packages (`i18next-http-backend`, `i18next-localstorage-backend`, `react-dropzone`) have no direct imports in `apps/app/src/` and may be transitive phantom entries or unused.

---

## Research Log

### Turbopack SSR Externalisation Mechanism

- **Context**: Why does Turbopack create `.next/node_modules/` at all, and what determines which packages end up there?
- **Findings**:
  - Turbopack (Next.js 16) externalises packages for SSR when they are imported in code that runs server-side, instead of inlining them into the SSR bundle as webpack does.
  - In Next.js Pages Router, every page component is SSR'd for initial HTML regardless of `"use client"` directives. Only `dynamic(() => import('...'), { ssr: false })` prevents server-side execution.
  - The resulting symlinks in `.next/node_modules/` point to `../../../../node_modules/.pnpm/...` (workspace root) and must be redirected to `../../node_modules/.pnpm/...` (deploy output) via the `assemble-prod.sh` rewrite step.
- **Implications**: Any package imported at module-level in an SSR-rendered code path (component, hook, utility, server service) will be externalised and must be in `dependencies`.

### pnpm deploy --legacy output structure

- **Context**: Does `--legacy` produce a flat (hoisted) or pnpm-native node_modules?
- **Findings**:
  - `pnpm deploy --legacy` in pnpm v10 still produces a pnpm-native structure with `node_modules/.pnpm/` and symlinks. The `--legacy` flag only bypasses the `inject-workspace-packages` gate; it does NOT force hoisting.
  - Transitive deps (e.g., `use-sync-external-store`, `dequal` from `swr`) are in `.pnpm/` but NOT at the top-level. The `cp -rL` approach failed because physical copies in `.next/node_modules/` lose the `.pnpm/` sibling resolution context.
  - The correct fix is symlink rewriting in `assemble-prod.sh`: `../../../../node_modules/.pnpm/` → `../../node_modules/.pnpm/`.
- **Implications**: The symlink rewrite in `assemble-prod.sh` is essential and must not be replaced with `cp -rL`.

### @emoji-mart/data — server-side import analysis

- **Context**: Can the server-side import in `emoji.ts` be removed or replaced?
- **Sources Consulted**: `apps/app/src/services/renderer/remark-plugins/emoji.ts`
- **Findings**:
  - The plugin performs `import emojiData from '@emoji-mart/data/sets/15/native.json'` and accesses only `emojiData.emojis[$1]?.skins[0].native`.
  - The data structure needed is: `{ emojis: { [name: string]: { skins: [{ native: string }] } } }`.
  - This is a static JSON lookup — no runtime behaviour from the package, only data.
  - Alternative: A minimal bundled static file (`emoji-native-lookup.json`) containing only the `name → native emoji` mapping could replace the full `@emoji-mart/data` package.
  - Effort: moderate (requires a build-time extraction script or manual curation); risk: emoji data staleness.
- **Implications**: Technically feasible to replace with a static file, but adds maintenance overhead. Acceptable to keep as `dependencies` for Phase 1; defer decision to Phase 2 investigation.

### bootstrap — dynamic import analysis

- **Context**: Why does `bootstrap` appear in `.next/node_modules/` when the import appears to be dynamic?
- **Sources Consulted**: `apps/app/src/pages/_app.page.tsx:93`
- **Findings**:
  - `import('bootstrap/dist/js/bootstrap')` is a dynamic `import()` expression, not a static `import` statement.
  - If called inside a `useEffect`, it would be browser-only and Turbopack should not externalise it for SSR.
  - Needs verification: check whether Turbopack traces the `import()` call site (component level vs `useEffect`) and whether it appears in `.next/node_modules/` after a build without bootstrap in `dependencies`.
- **Implications**: Bootstrap may be safely reverted to `devDependencies` if the `import()` is confirmed to be inside a browser-only lifecycle hook. Flag for Phase 4 investigation.

### socket.io-client — mixed import pattern

- **Context**: `global-socket.ts` uses `await import('socket.io-client')` (dynamic, browser-safe); `features/admin/states/socket-io.ts` uses `import io from 'socket.io-client'` (static, externalised by Turbopack).
- **Findings**:
  - The admin socket's static import is the cause of externalisation.
  - Refactoring to `const { default: io } = await import('socket.io-client')` (matching `global-socket.ts` pattern) would remove the static import from the SSR code path.
  - Pattern precedent exists in `global-socket.ts` — low-risk refactor.
- **Implications**: After refactoring admin socket to dynamic import, `socket.io-client` should no longer appear in `.next/node_modules/` and can revert to `devDependencies`.

### react-toastify — partial ssr:false coverage

- **Context**: `ToastContainer` is guarded by `dynamic({ ssr: false })` in `RawLayout.tsx`, but `toastr.ts` imports `{ toast }` and type imports statically.
- **Findings**:
  - Even if `ToastContainer` is client-only, the `toast` function import in `toastr.ts` is a static module-level import, causing Turbopack to externalise `react-toastify`.
  - Refactoring `toast` calls to use `await import('react-toastify').then(m => m.toast(...))` would remove the static import. However, `toastr.ts` is a utility used broadly; async toast calls would change its API surface.
  - Alternative: Accept `react-toastify` as a `dependencies` entry given its small size.
- **Implications**: The type imports (`ToastContent`, `ToastOptions`) are erased at runtime and do not cause externalisation; only the value import `{ toast }` matters. Simplest path: keep in `dependencies`.

### Packages with no src/ imports

- **Context**: `i18next-http-backend`, `i18next-localstorage-backend`, `react-dropzone` — no imports found in `apps/app/src/`.
- **Findings**:
  - These may be imported in shared packages (`@growi/editor`, `@growi/core`) that are listed as workspace dependencies.
  - Alternatively, they may be historical entries added but never used in `apps/app` directly.
  - If they do NOT appear in `.next/node_modules/` after Phase 1 build, they are safe to remove from `devDependencies` entirely.
- **Implications**: Investigate post-Phase 1. If not in `.next/node_modules/` and not in prod `node_modules`, remove from `devDependencies`.

---

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks | Notes |
|--------|-------------|-----------|-------|-------|
| Move-all-to-deps (flat fix) | Move all 23 packages to `dependencies` and stop | Immediate fix, zero code changes | Large production artifact, wrong semantics | Acceptable as Phase 1 baseline only |
| Phased minimisation | Phase 1 fix + systematic revert via ssr:false / dynamic import / removal | Minimal production artifact, correct semantics | More effort, requires per-package verification | **Selected approach** |
| cp -rL (.next/node_modules) | Resolve symlinks to physical files | Self-contained | Breaks transitive dep resolution (use-sync-external-store issue) | Rejected — symlink rewrite is correct approach |

---

## Design Decisions

### Decision: Symlink Rewrite over cp -rL

- **Context**: `.next/node_modules/` symlinks point to workspace root `.pnpm/`; release image only has `apps/app/node_modules/.pnpm/`.
- **Alternatives Considered**:
  1. `cp -rL` — copy physical files, loses pnpm sibling resolution
  2. Symlink rewrite (`../../../../ → ../../`) — updates symlink targets to deployed `.pnpm/`
- **Selected Approach**: Symlink rewrite in `assemble-prod.sh`
- **Rationale**: Preserves pnpm's isolated structure; transitive deps (e.g., `use-sync-external-store` for `swr`) remain resolvable via `.pnpm/` sibling pattern.
- **Trade-offs**: Requires `find -maxdepth 2` to handle both depth-1 and depth-2 symlinks under `@scope/` directories.

### Decision: Phased Revert Strategy

- **Context**: Rather than leaving all 23 in `dependencies` permanently, systematically revert where safe.
- **Selected Approach**: Phase 1 (all to deps) → Phase 2 (server-side import removal) → Phase 3 (ssr:false) → Phase 4 (ambiguous) → Phase 5 (validate & document)
- **Rationale**: Each phase is independently verifiable; Phase 1 unblocks CI immediately.

### Decision: @emoji-mart/data — Accept as Production Dependency (Phase 1)

- **Context**: Static JSON import used for server-side emoji processing.
- **Selected Approach**: Move to `dependencies`; defer extraction of a static lookup file to Phase 2 investigation.
- **Rationale**: The data is genuinely needed server-side; extraction adds maintenance overhead that may not be worth the artifact size saving.

---

## Risks & Mitigations

- **Phase 3 ssr:false causes hydration mismatch** — Mitigation: test each wrapped component in browser before reverting the package; use React hydration warnings as signal.
- **Phase 4 admin socket refactor breaks admin panel** — Mitigation: existing `global-socket.ts` dynamic pattern serves as verified template; unit test admin socket atom.
- **Turbopack version change alters externalisation heuristics** — Mitigation: `assemble-prod.sh` includes a post-rewrite check via production server smoke test; Req 5.3 enforces no devDeps in `.next/node_modules/`.
- **Phantom packages (i18next-*, react-dropzone) are transitive** — Mitigation: verify by checking `.next/node_modules/` contents post-Phase-1; remove only after confirming absence.

---

## References

- pnpm deploy documentation — `pnpm deploy` flags and node-linker behaviour
- Next.js Pages Router SSR — all pages render server-side by default; `dynamic({ ssr: false })` is the only opt-out
- Turbopack externalisation — packages in `.next/node_modules/` are loaded at runtime, not bundled
