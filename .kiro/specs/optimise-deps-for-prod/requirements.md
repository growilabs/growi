# Requirements Document

## Introduction

GROWI migrated its production bundler from webpack to Turbopack. Unlike webpack, which inlines all imported modules into self-contained bundle chunks, Turbopack externalises certain packages at SSR runtime via `.next/node_modules/` symlinks. This means packages that were historically classified as `devDependencies` (on the assumption that they were only needed at build time) are now required at production runtime.

The current `pnpm deploy --prod` step excludes `devDependencies`, causing missing modules when the production server starts. This specification defines a phased approach: first restore a working production build by moving all affected packages to `dependencies`, then systematically minimise the `dependencies` set by eliminating unnecessary runtime exposure where technically feasible.

---

## Requirements

### Requirement 1: Production Build Baseline Restoration

**Objective:** As a release engineer, I want `pnpm deploy --prod` to produce a complete, self-contained production artifact, so that the production server starts without missing-module errors.

#### Acceptance Criteria

1. The build system shall move all 23 packages currently appearing in `.next/node_modules/` but classified as `devDependencies` into `dependencies` in `apps/app/package.json`.
2. When `pnpm deploy out --prod --legacy --filter @growi/app` is executed, the output `node_modules` shall contain every package referenced by `.next/node_modules/` symlinks.
3. When the production server is started with `pnpm run server`, the build system shall not throw `ERR_MODULE_NOT_FOUND` or `Failed to load external module` errors on any page request.
4. When a browser accesses the `/login` page, the GROWI server shall respond with HTTP 200 and render the login page without SSR errors in the server log.
5. The GROWI server shall pass existing CI smoke tests (`launch-prod` job) after this change.

---

### Requirement 2: Elimination of Server-Side Imports for Group 2 Packages

**Objective:** As a developer, I want to remove direct server-side imports of packages that do not need to run on the server, so that those packages can revert to `devDependencies` and be excluded from the production artifact.

#### Acceptance Criteria

1. When `@emoji-mart/data` is investigated, the build system shall determine whether its import in `services/renderer/remark-plugins/emoji.ts` can be replaced with a server-safe alternative (e.g., a bundled subset of emoji data, or a lazy `require()` that avoids Turbopack externalisation).
2. If a viable server-side import removal is identified for a Group 2 package, the GROWI server shall continue to render emoji correctly in Markdown output after the refactor.
3. If a Group 2 package's server-side import is successfully removed and it no longer appears in `.next/node_modules/` after a production build, the build system shall move that package back to `devDependencies`.
4. If removal of a server-side import is not viable without breaking functionality, the package shall remain in `dependencies` and be documented as a justified production dependency.

---

### Requirement 3: SSR Opt-out for Group 1 Client-Only Components

**Objective:** As a developer, I want to wrap client-only UI components with `dynamic(() => import(...), { ssr: false })` where appropriate, so that their dependencies are excluded from Turbopack's SSR externalisation and can revert to `devDependencies`.

#### Acceptance Criteria

1. When a Group 1 package is evaluated, the build system shall determine whether its consuming component(s) can be safely rendered client-side only (no meaningful content lost from initial HTML, no SEO impact, no hydration mismatch risk).
2. Where a component is safe for `ssr: false`, the GROWI app shall wrap the component import with `dynamic(() => import('...'), { ssr: false })` and the package shall no longer appear in `.next/node_modules/` after a production build.
3. When `ssr: false` is applied to a component, the GROWI app shall not exhibit hydration errors or visible layout shift in the browser.
4. If a Group 1 package's component is successfully converted to `ssr: false` and no longer appears in `.next/node_modules/`, the build system shall move that package back to `devDependencies`.
5. If a component cannot be wrapped with `ssr: false` without breaking functionality or user experience, the package shall remain in `dependencies` and be documented as a justified production dependency.

---

### Requirement 4: Classification of Unresolved Packages

**Objective:** As a developer, I want to determine the correct final classification for packages with unclear or mixed usage patterns, so that every entry in `dependencies` and `devDependencies` has a documented and verified rationale.

#### Acceptance Criteria

1. When `react-toastify` is investigated, the build system shall determine whether the direct import in `client/util/toastr.ts` causes Turbopack to externalise it independently of the `ssr: false`-guarded `ToastContainer`, and classify accordingly.
2. When `socket.io-client` is investigated, the build system shall determine whether the direct import in `features/admin/states/socket-io.ts` requires the package at SSR runtime, and either refactor it to a dynamic import or document it as a justified production dependency.
3. When `bootstrap` is investigated, the build system shall determine whether a JavaScript import (beyond SCSS) causes it to appear in `.next/node_modules/`, and classify accordingly.
4. When `i18next-http-backend`, `i18next-localstorage-backend`, and `react-dropzone` are investigated and found to have no direct imports in `src/`, the build system shall determine whether they appear in `.next/node_modules/` via transitive dependencies and remove them from `devDependencies` entirely if they are unused.
5. The GROWI server shall pass existing CI smoke tests after all reclassifications in this requirement are applied.

---

### Requirement 5: Final State Validation and Documentation

**Objective:** As a release engineer, I want a verified and documented final state of `dependencies` vs `devDependencies`, so that future package additions follow the correct classification rules.

#### Acceptance Criteria

1. The GROWI build system shall produce a production artifact where every package in `.next/node_modules/` is resolvable from `apps/app/node_modules/` (i.e., no broken symlinks in the release image).
2. The GROWI server shall start and serve the login page without errors after a full `pnpm deploy --prod` cycle.
3. The `apps/app/package.json` shall contain no packages in `devDependencies` that appear in `.next/node_modules/` after a production build.
4. The build system shall pass the full `launch-prod` CI job including MongoDB connectivity checks.
5. The GROWI codebase shall include a comment or documentation entry explaining the Turbopack externalisation rule: any package imported in SSR-rendered code (including Pages Router components and server-side utilities) must be in `dependencies`, not `devDependencies`.
