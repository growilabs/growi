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

- [ ] 1. Move all 23 Turbopack-externalised packages from `devDependencies` to `dependencies`

- [ ] 1.1 Edit `apps/app/package.json` to reclassify all 23 packages
  - Move the following entries from the `devDependencies` section to the `dependencies` section, preserving alphabetical order within each section: `@codemirror/state`, `@emoji-mart/data`, `@handsontable/react`, `@headless-tree/core`, `@headless-tree/react`, `@tanstack/react-virtual`, `bootstrap`, `diff2html`, `downshift`, `fastest-levenshtein`, `fslightbox-react`, `i18next-http-backend`, `i18next-localstorage-backend`, `pretty-bytes`, `react-copy-to-clipboard`, `react-dnd`, `react-dnd-html5-backend`, `react-dropzone`, `react-hook-form`, `react-input-autosize`, `react-toastify`, `simplebar-react`, `socket.io-client`
  - Run `pnpm install --frozen-lockfile` from the monorepo root after editing to verify the lock file remains valid; if it fails (lock file mismatch), run `pnpm install` to regenerate it
  - _Requirements: 1.1_

- [ ] 1.2 Verify the production server starts cleanly after the package reclassification
  - Run `bash apps/app/bin/assemble-prod.sh` from the monorepo root to produce the release artifact
  - Start the production server with `pnpm run server` and confirm no `ERR_MODULE_NOT_FOUND` or `Failed to load external module` errors appear in stdout
  - Send a GET request to `/login` and assert HTTP 200; confirm the server logs show no SSR errors for the login page
  - _Requirements: 1.2, 1.3, 1.4, 1.5_

---

- [ ] 2. Replace the `@emoji-mart/data` runtime dependency with a bundled static lookup file

- [ ] 2.1 Extract the minimal emoji lookup data from `@emoji-mart/data` into a static JSON file
  - Inspect `apps/app/src/services/renderer/remark-plugins/emoji.ts` to confirm the only fields consumed are `emojiData.emojis[name]?.skins[0].native`
  - Write a one-off extraction script (run from `apps/app/`) that reads `node_modules/@emoji-mart/data/sets/15/native.json`, extracts a `Record<string, { skins: [{ native: string }] }>` map, and writes it to `apps/app/src/services/renderer/remark-plugins/emoji-native-lookup.json`
  - Run the extraction script and commit the generated JSON file alongside the script
  - Document in a comment above the script that it must be re-run whenever `@emoji-mart/data` is upgraded (Req 2.1 investigation outcome)
  - _Requirements: 2.1_

- [ ] 2.2 Refactor `emoji.ts` to use the static lookup file and revert `@emoji-mart/data` to `devDependencies`
  - Replace the `import emojiData from '@emoji-mart/data/sets/15/native.json'` statement in `emoji.ts` with an import of the newly created `./emoji-native-lookup.json`
  - Run `turbo run build --filter @growi/app` and confirm no build errors
  - Run `bash apps/app/bin/assemble-prod.sh` and confirm `@emoji-mart/data` no longer appears in `apps/app/.next/node_modules/`
  - Verify emoji rendering is intact: start the production server and render a page containing `:+1:`, `:tada:`, and `:rocket:` shortcodes; assert native emoji characters appear in the HTML output
  - Move `@emoji-mart/data` from `dependencies` back to `devDependencies` in `apps/app/package.json`; if removal is not viable, document the reason as a comment in `package.json` and leave it in `dependencies` per Req 2.4
  - _Requirements: 2.2, 2.3, 2.4_

---

- [ ] 3. Apply `dynamic({ ssr: false })` to eligible Group 1 components

- [ ] 3.1 (P) Wrap `LightBox.tsx` import with `dynamic({ ssr: false })` and verify `fslightbox-react` leaves `dependencies`
  - Locate the consuming component file that imports from `fslightbox-react` and wrap the import using `const LightBox = dynamic(() => import('path/to/LightBox'), { ssr: false })`
  - Run a production build and confirm `fslightbox-react` no longer appears in `apps/app/.next/node_modules/`
  - Test in the browser: open a page with an image lightbox; confirm the lightbox opens normally with no React hydration warnings in the browser console
  - Move `fslightbox-react` from `dependencies` to `devDependencies`; if hydration errors appear, revert and document as justified production dependency per Req 3.5
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [ ] 3.2 (P) Wrap `RevisionDiff.tsx` import with `dynamic({ ssr: false })` and verify `diff2html` leaves `dependencies`
  - Locate the consuming component for `diff2html` and wrap the import using `dynamic(() => import('...'), { ssr: false })`
  - Run a production build and confirm `diff2html` no longer appears in `apps/app/.next/node_modules/`
  - Test in the browser: navigate to a page revision diff view; confirm diff output renders correctly with no hydration warnings
  - Move `diff2html` from `dependencies` to `devDependencies`; if hydration errors appear, revert and document per Req 3.5
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [ ] 3.3 (P) Wrap the DnD provider in `PageTree` with `dynamic({ ssr: false })` and verify `react-dnd` / `react-dnd-html5-backend` leave `dependencies`
  - Identify the component that wraps the page tree in a `DndProvider`; apply `dynamic(() => import('...'), { ssr: false })` to that provider wrapper only, not to the tree content itself (preserving SSR for page titles)
  - Run a production build and confirm neither `react-dnd` nor `react-dnd-html5-backend` appears in `apps/app/.next/node_modules/`
  - Test in the browser: verify page tree drag-and-drop reordering works with no hydration warnings or layout shift
  - Move `react-dnd` and `react-dnd-html5-backend` from `dependencies` to `devDependencies`; if issues arise, revert and document per Req 3.5
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [ ] 3.4 (P) Confirm `HandsontableModal` already uses a `dynamic` import and verify `@handsontable/react` leave `dependencies`
  - Inspect the `HandsontableModal.tsx` import chain to confirm whether `@handsontable/react` is already loaded via `dynamic()` with `ssr: false`
  - Run a production build and check whether `@handsontable/react` appears in `apps/app/.next/node_modules/`
  - If it is absent: move `@handsontable/react` from `dependencies` to `devDependencies`
  - If it still appears: apply `dynamic({ ssr: false })` wrapping, retest, then move to `devDependencies` if cleared; otherwise document as justified production dependency per Req 3.5
  - _Requirements: 3.1, 3.2, 3.4, 3.5_

- [ ] 3.5 Run a consolidated production build verification after all Group 1 wrapping changes
  - Run `bash apps/app/bin/assemble-prod.sh` and start `pnpm run server`; confirm the server starts without errors and `/login` returns HTTP 200
  - Check the browser console on pages that contain the wrapped components (lightbox, diff viewer, page tree, Handsontable modal) and assert zero React hydration warnings
  - Confirm each successfully wrapped package no longer appears in `apps/app/.next/node_modules/` (see design for per-package revert conditions)
  - _Requirements: 3.3, 3.4, 3.5_

---

- [ ] 4. Resolve ambiguous and phantom package classifications

- [ ] 4.1 (P) Confirm `react-toastify` must remain in `dependencies`
  - Inspect `apps/app/src/client/util/toastr.ts` and verify it uses a static module-level `import { toast } from 'react-toastify'`
  - Determine whether this file is reachable from any SSR code path (Pages Router page, `_app.page.tsx`, or a server utility); if yes, document `react-toastify` as a justified production dependency
  - Note the result in a comment in `apps/app/package.json` next to the `react-toastify` entry
  - _Requirements: 4.1_

- [ ] 4.2 (P) Refactor `admin/states/socket-io.ts` to use a dynamic import and verify `socket.io-client` leaves `dependencies`
  - Replace the static `import io from 'socket.io-client'` with a dynamic import expression inside the Jotai atom initialiser, matching the pattern already used in `states/socket-io/global-socket.ts`
  - Run a production build and confirm `socket.io-client` no longer appears in `apps/app/.next/node_modules/`
  - Test in the browser: open the admin panel and confirm the admin Socket.IO connection establishes successfully (WebSocket upgrade visible in browser DevTools Network tab)
  - If the refactor is successful and the package is absent from `.next/node_modules/`, move `socket.io-client` from `dependencies` to `devDependencies`; if admin socket consumers require synchronous access at page load, document as justified production dependency per Req 4.2
  - _Requirements: 4.2_

- [ ] 4.3 (P) Verify whether `bootstrap` JS `import()` is browser-only and classify accordingly
  - Inspect `apps/app/src/pages/_app.page.tsx` to find the `import('bootstrap/dist/js/bootstrap')` expression and confirm whether it is inside a `useEffect` hook (browser-only) or at module level (SSR path)
  - Run a production build and note whether `bootstrap` appears in `apps/app/.next/node_modules/`
  - If the import is inside `useEffect` and `bootstrap` does not appear in `.next/node_modules/`: move `bootstrap` from `dependencies` to `devDependencies`
  - If `bootstrap` still appears in `.next/node_modules/`: leave in `dependencies` and document the reason per Req 4.3
  - _Requirements: 4.3_

- [ ] 4.4 (P) Investigate phantom packages and remove or reclassify them
  - After completing Phase 1 (Task 1), run `bash apps/app/bin/assemble-prod.sh`, then list `apps/app/.next/node_modules/` and check whether `i18next-http-backend`, `i18next-localstorage-backend`, and `react-dropzone` are present
  - Search `apps/app/src/` for any direct imports of these three packages to determine whether they are genuinely unused
  - If a package is absent from `.next/node_modules/` and has no direct imports: remove it from `devDependencies` entirely (it is an unused dependency)
  - If a package appears in `.next/node_modules/` via a transitive chain: leave it in `dependencies` (moved there in Task 1.1) and document the transitive source per Req 4.4
  - _Requirements: 4.4_

- [ ] 4.5 Apply all Phase 4 package.json classification changes and run consolidated verification
  - Apply all `devDependencies` / `dependencies` moves identified in tasks 4.1–4.4
  - Run `pnpm install --frozen-lockfile` to verify lock file integrity
  - Run `bash apps/app/bin/assemble-prod.sh` and start `pnpm run server`; confirm the server starts without errors and `/login` returns HTTP 200
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

---

- [ ] 5. Final validation and documentation

- [ ] 5.1 Verify that every `.next/node_modules/` symlink resolves correctly in the release artifact
  - Run `bash apps/app/bin/assemble-prod.sh` to produce the final artifact
  - Enumerate every symlink under `apps/app/.next/node_modules/` with `find apps/app/.next/node_modules -maxdepth 2 -type l` and assert that each target path exists under `apps/app/node_modules/.pnpm/` (no broken symlinks)
  - Assert that no package listed in `devDependencies` in `apps/app/package.json` appears in `apps/app/.next/node_modules/` (no classification regression)
  - Start `pnpm run server` and confirm HTTP 200 on `/login` with no SSR errors in the server log
  - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [ ] 5.2 Add Turbopack externalisation rule documentation
  - Add a comment block in `apps/app/package.json` above the `dependencies` section (or in a neighbouring `ARCHITECTURE.md` / steering document) explaining: any package that is imported in SSR-rendered code (Pages Router components, `_app.page.tsx`, server-side utilities) must be in `dependencies`, not `devDependencies`, because Turbopack externalises such packages to `.next/node_modules/` which are not present in the `pnpm deploy --prod` output if the package is listed under `devDependencies`
  - Update `.kiro/steering/tech.md` to reference this rule under the "Import Optimization Principles" section
  - _Requirements: 5.5_
