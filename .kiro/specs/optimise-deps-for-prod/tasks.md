# Implementation Plan

## Task Overview

| Phase | Major Task | Sub-tasks | Requirements |
|-------|-----------|-----------|--------------|
| 1 | Baseline fix — move 23 packages | 1.1, 1.2 | 1.1–1.5 |
| 2 | Eliminate `@emoji-mart/data` server import | 2.1, 2.2 | 2.1–2.4 |
| 3 | Apply `ssr: false` to Group 1 components | 3.1–3.5 | 3.1–3.5 |
| 4 | Resolve ambiguous packages | 4.1–4.5 | 4.1–4.5 |
| 5 | Final validation and documentation | 5.1, 5.2 | 5.1–5.5 |

---

- [x] 1. Move all 23 Turbopack-externalised packages from `devDependencies` to `dependencies`

- [x] 1.1 Edit `apps/app/package.json` to reclassify all 23 packages
  - Move the following entries from the `devDependencies` section to the `dependencies` section, preserving alphabetical order within each section: `@codemirror/state`, `@emoji-mart/data`, `@handsontable/react`, `@headless-tree/core`, `@headless-tree/react`, `@tanstack/react-virtual`, `bootstrap`, `diff2html`, `downshift`, `fastest-levenshtein`, `fslightbox-react`, `i18next-http-backend`, `i18next-localstorage-backend`, `pretty-bytes`, `react-copy-to-clipboard`, `react-dnd`, `react-dnd-html5-backend`, `react-dropzone`, `react-hook-form`, `react-input-autosize`, `react-toastify`, `simplebar-react`, `socket.io-client`
  - Run `pnpm install --frozen-lockfile` from the monorepo root after editing to verify the lock file remains valid; if it fails (lock file mismatch), run `pnpm install` to regenerate it
  - _Requirements: 1.1_

- [x] 1.2 Verify the production server starts cleanly after the package reclassification
  - Run `bash apps/app/bin/assemble-prod.sh` from the monorepo root to produce the release artifact
  - Start the production server with `pnpm run server` and confirm no `ERR_MODULE_NOT_FOUND` or `Failed to load external module` errors appear in stdout
  - Send a GET request to `/login` and assert HTTP 200; confirm the server logs show no SSR errors for the login page
  - **Result**: HTTP 200 on `/login`, no `ERR_MODULE_NOT_FOUND` errors. Server starts cleanly.
  - **Note**: `assemble-prod.sh` deletes `next.config.ts`; restore it after with `git show HEAD:apps/app/next.config.ts > apps/app/next.config.ts`
  - _Requirements: 1.2, 1.3, 1.4, 1.5_

---

- [x] 2. Replace the `@emoji-mart/data` runtime dependency with a bundled static lookup file

- [x] 2.1 Extract the minimal emoji lookup data from `@emoji-mart/data` into a static JSON file
  - Confirmed: only fields consumed are `emojiData.emojis[name]?.skins[0].native`
  - Created `apps/app/bin/extract-emoji-data.cjs` extraction script
  - Generated `apps/app/src/services/renderer/remark-plugins/emoji-native-lookup.json` (1870 entries)
  - _Requirements: 2.1_

- [x] 2.2 Refactor `emoji.ts` to use the static lookup file and revert `@emoji-mart/data` to `devDependencies`
  - Replaced `import emojiData from '@emoji-mart/data/sets/15/native.json'` with `import emojiNativeLookup from './emoji-native-lookup.json'`
  - Moved `@emoji-mart/data` from `dependencies` back to `devDependencies`
  - Build confirmed green (TypeScript type cast fixed with `as unknown as Record<...>`)
  - _Requirements: 2.2, 2.3, 2.4_

---

- [x] 3. Apply `dynamic({ ssr: false })` to eligible Group 1 components

- [x] 3.1 (P) Wrap `LightBox.tsx` import with `dynamic({ ssr: false })` and verify `fslightbox-react` leaves `dependencies`
  - Applied `dynamic({ ssr: false })` in `apps/app/src/client/services/renderer/renderer.tsx`
  - Moved `fslightbox-react` from `dependencies` to `devDependencies`
  - Server test: HTTP 200 on `/login`, no `ERR_MODULE_NOT_FOUND`
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 3.2 (P) Wrap `RevisionDiff.tsx` import with `dynamic({ ssr: false })` and verify `diff2html` leaves `dependencies`
  - Applied `dynamic({ ssr: false })` in `apps/app/src/client/components/RevisionComparer/RevisionComparer.tsx`
  - Moved `diff2html` from `dependencies` to `devDependencies`
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 3.3 (P) Wrap the DnD provider in `PageTree` with `dynamic({ ssr: false })` and verify `react-dnd` / `react-dnd-html5-backend` leave `dependencies`
  - Created `apps/app/src/client/components/Sidebar/PageTree/PageTreeWithDnD.tsx` wrapper
  - Updated `PageTree.tsx` to load `PageTreeWithDnD` via `dynamic({ ssr: false })`
  - Moved `react-dnd` and `react-dnd-html5-backend` from `dependencies` to `devDependencies`
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 3.4 (P) Confirm `HandsontableModal` already uses a `dynamic` import and verify `@handsontable/react` leave `dependencies`
  - Confirmed: `HandsontableModal.tsx` is loaded via `useLazyLoader` with `import('./HandsontableModal')` inside `useEffect` — browser-only dynamic import
  - Moved `@handsontable/react` from `dependencies` to `devDependencies`
  - _Requirements: 3.1, 3.2, 3.4, 3.5_

- [x] 3.5 Run a consolidated production build verification after all Group 1 wrapping changes
  - Ran `assemble-prod.sh` + `pnpm run server`: HTTP 200 on `/login`, no `ERR_MODULE_NOT_FOUND` errors
  - _Requirements: 3.3, 3.4, 3.5_

---

- [x] 4. Resolve ambiguous and phantom package classifications

- [x] 4.1 (P) Confirm `react-toastify` must remain in `dependencies`
  - `toastr.ts` has static import `import { toast } from 'react-toastify'`; reachable from SSR client components (e.g., `features/page-tree/hooks/use-page-rename.tsx`)
  - `react-toastify` justified as production dependency; documented in `.kiro/steering/tech.md`
  - _Requirements: 4.1_

- [x] 4.2 (P) Refactor `admin/states/socket-io.ts` to use a dynamic import and verify `socket.io-client` leaves `dependencies`
  - Replaced static `import io from 'socket.io-client'` with `const { default: io } = await import('socket.io-client')` inside `useEffect`
  - Adopted `atom<Socket | null>(null)` + `useSetupAdminSocket` hook pattern (matching `global-socket.ts`)
  - Added `useSetupAdminSocket()` call to `AdminLayout.tsx`
  - Moved `socket.io-client` from `dependencies` to `devDependencies`
  - All consumers already guard for `null` socket (no breaking changes)
  - _Requirements: 4.2_

- [x] 4.3 (P) Verify whether `bootstrap` JS `import()` is browser-only and classify accordingly
  - Confirmed: `import('bootstrap/dist/js/bootstrap')` is inside `useEffect` in `_app.page.tsx` — browser-only
  - Moved `bootstrap` from `dependencies` to `devDependencies`
  - _Requirements: 4.3_

- [x] 4.4 (P) Investigate phantom packages and remove or reclassify them
  - `i18next-http-backend`, `i18next-localstorage-backend`, `react-dropzone`: no direct imports in `apps/app/src/`
  - All three moved from `dependencies` to `devDependencies`
  - _Requirements: 4.4_

- [x] 4.5 Apply all Phase 4 package.json classification changes and run consolidated verification
  - All Phase 4 changes applied to `apps/app/package.json`
  - `pnpm install` run to verify lock file integrity
  - `assemble-prod.sh` + server start: HTTP 200 on `/login`, no `ERR_MODULE_NOT_FOUND`
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

---

- [ ] 5. Final validation and documentation

- [ ] 5.1 Verify that every `.next/node_modules/` symlink resolves correctly in the release artifact
  - Run `bash apps/app/bin/assemble-prod.sh` to produce the final artifact
  - Enumerate every symlink under `apps/app/.next/node_modules/` with `find apps/app/.next/node_modules -maxdepth 2 -type l` and assert that each target path exists under `apps/app/node_modules/.pnpm/` (no broken symlinks)
  - Assert that no package listed in `devDependencies` in `apps/app/package.json` appears in `apps/app/.next/node_modules/` (no classification regression)
  - Start `pnpm run server` and confirm HTTP 200 on `/login` with no SSR errors in the server log
  - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [x] 5.2 Add Turbopack externalisation rule documentation
  - Added "Turbopack Externalisation Rule" section to `.kiro/steering/tech.md` under "Import Optimization Principles"
  - Documents: which packages must be in `dependencies`, how to make a package devDep-eligible, list of justified production dependencies
  - _Requirements: 5.5_
