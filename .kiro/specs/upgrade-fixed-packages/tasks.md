# Implementation Plan

- [ ] 1. Pre-implementation verification
- [ ] 1.1 Verify RegExp.escape() availability and TypeScript support
  - Confirm `RegExp.escape()` is available at runtime in the project's Node.js 24 target
  - Check whether TypeScript recognizes `RegExp.escape()` — may need `lib` config update or `@types/node` update
  - If unavailable, fall back to upgrading `escape-string-regexp` to v5 with `require(esm)` instead
  - _Requirements: 2.2_

- [ ] 1.2 Review next-themes v0.3.0 and v0.4.0 breaking API changes
  - Read changelogs for v0.3.0 and v0.4.0 releases to identify breaking changes
  - Map breaking changes to the 12 consuming files in apps/app
  - Determine migration effort and document required code changes
  - Confirm GROWI's Pages Router usage is unaffected by the cacheComponents bug (issue #375)
  - _Requirements: 1.2_

- [ ] 2. Low-risk package upgrades
- [ ] 2.1 (P) Relax @aws-sdk version range
  - Change `@aws-sdk/client-s3` from `3.454.0` to `^3.454.0` in apps/app/package.json
  - Change `@aws-sdk/s3-request-presigner` from `3.454.0` to `^3.454.0`
  - Update the misleading `"@aws-skd/*"` comment to reflect the actual reason or remove it
  - Run `pnpm install` and verify build with `turbo run build --filter @growi/app`
  - Run `turbo run test --filter @growi/app` to confirm no regressions
  - _Requirements: 1.3, 4.1, 4.2, 4.4_

- [ ] 2.2 (P) Upgrade string-width in @growi/editor
  - Update `string-width` from `=4.2.2` to `^7.0.0` in packages/editor/package.json
  - Verify @growi/editor builds successfully (Vite, ESM context)
  - Run `turbo run build --filter @growi/app` to confirm downstream build passes
  - Run `turbo run test --filter @growi/app` to confirm no regressions
  - Remove the `string-width` comment from apps/app/package.json `// comments for dependencies`
  - _Requirements: 2.1, 2.3, 4.1, 4.2, 4.4_

- [ ] 3. Upgrade bootstrap to ^5.3.4
  - Change `bootstrap` from `=5.3.2` to `^5.3.4` in apps/app/package.json
  - Run `pnpm install` to resolve the new version
  - Run `pnpm run pre:styles-commons` and `pnpm run pre:styles-components` to verify SCSS compilation
  - Run `turbo run build --filter @growi/app` to confirm Turbopack build passes
  - Run `turbo run lint --filter @growi/app` to check for type or lint errors
  - Run `turbo run test --filter @growi/app` to confirm no regressions
  - Visually inspect modal headers if a dev server is available (original bug was modal header layout)
  - Remove the `bootstrap` comment from `// comments for dependencies`
  - If build or SCSS fails, revert and document the failure reason
  - _Requirements: 1.1, 4.1, 4.2, 4.3, 4.4, 4.5_

- [ ] 4. Replace escape-string-regexp with native RegExp.escape()
- [ ] 4.1 Migrate all source files from escape-string-regexp to RegExp.escape()
  - Replace `import escapeStringRegexp from 'escape-string-regexp'` and corresponding calls with `RegExp.escape()` in each file
  - Files in apps/app/src: page.ts, page/index.ts, page-grant.ts, users.js, obsolete-page.js, openai.ts (6 files)
  - Files in packages: core/src/utils/page-path-utils (2 files), remark-lsx/src/server/routes/list-pages/index.ts (1 file)
  - Ensure each replacement preserves the exact same escaping behavior
  - _Requirements: 4.1_

- [ ] 4.2 Remove escape-string-regexp dependency and verify
  - Remove `escape-string-regexp` from apps/app/package.json dependencies
  - Remove from packages/core and packages/remark-lsx package.json if listed
  - Remove the `escape-string-regexp` comment from `// comments for dependencies`
  - Remove `escape-string-regexp` entry from `transpilePackages` in next.config.ts
  - Run `pnpm install` to update lockfile
  - Run `turbo run build --filter @growi/app` to verify build
  - Run `turbo run lint --filter @growi/app` to verify no type errors
  - Run `turbo run test --filter @growi/app` to verify no regressions
  - If RegExp.escape() has TypeScript issues, add type declaration or adjust lib config
  - _Requirements: 2.1, 2.2, 4.1, 4.2, 4.3, 4.4, 4.5_

- [ ] 5. Upgrade next-themes to ^0.4.x
- [ ] 5.1 Update next-themes and adapt consuming code
  - Change `next-themes` from `^0.2.1` to `^0.4.4` in apps/app/package.json
  - Apply required API migration changes across the 12 consuming files identified in design
  - Pay attention to any renamed exports, changed hook signatures, or provider prop changes
  - Ensure `useTheme()` and `ThemeProvider` usage is compatible with v0.4.x API
  - _Requirements: 1.2, 4.1_

- [ ] 5.2 Verify next-themes upgrade
  - Run `turbo run build --filter @growi/app` to confirm build passes
  - Run `turbo run lint --filter @growi/app` to check for type errors (original pinning was about types)
  - Run `turbo run test --filter @growi/app` to confirm no regressions
  - Remove the `next-themes` comment from `// comments for dependencies`
  - If build or type errors occur, investigate whether the issue is the same as #122 or a new problem
  - If upgrade fails, revert and document the reason; keep the pin with an updated comment
  - _Requirements: 4.2, 4.3, 4.4, 4.5, 4.6_

- [ ] 6. Finalize audit documentation and comment blocks
  - Verify `// comments for dependencies` block contains only packages that remain pinned (@keycloak if unchanged)
  - Verify `// comments for defDependencies` block is accurate (handsontable entries unchanged)
  - Update comment text to reflect current reasons where applicable
  - Produce a final summary table in research.md documenting: package name, previous version, new version or "unchanged", and rationale
  - Confirm all requirements are satisfied by reviewing the checklist against actual changes made
  - _Requirements: 3.1, 3.2, 4.6, 5.1, 5.2, 5.3_
