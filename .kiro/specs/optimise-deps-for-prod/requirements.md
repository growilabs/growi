# Requirements Document

## Introduction

GROWI migrated its production bundler from webpack to Turbopack. Unlike webpack, which inlines all imported modules into self-contained bundle chunks, Turbopack externalises certain packages at SSR runtime via `.next/node_modules/` symlinks. This means packages that were historically classified as `devDependencies` (on the assumption that they were only needed at build time) are now required at production runtime.

The current `pnpm deploy --prod` step excludes `devDependencies`, causing missing modules when the production server starts. This specification defines a phased approach: first restore a working production build by moving all affected packages to `dependencies`, then systematically minimise the `dependencies` set by eliminating unnecessary runtime exposure where technically feasible.

---

## Requirements

### Requirement 1: Production Build Baseline Restoration

**Objective:** As a release engineer, I want `pnpm deploy --prod` to produce a complete, self-contained production artifact, so that the production server starts without missing-module errors.

**Summary**: All packages appearing in `.next/node_modules/` after a Turbopack production build must be in `dependencies`. The production server must start without `ERR_MODULE_NOT_FOUND` errors and pass the `launch-prod` CI job against MongoDB 6.0 and 8.0.

---

### Requirement 2: Elimination of Server-Side Imports for Group 2 Packages

**Objective:** As a developer, I want to remove direct server-side imports of packages that do not need to run on the server, so that those packages can revert to `devDependencies` and be excluded from the production artifact.

**Summary**: Investigate whether `@emoji-mart/data`'s server-side import in `emoji.ts` can be replaced with a server-safe alternative. If successful, emoji rendering must produce identical output and the package must revert to `devDependencies`. If removal is not viable, document as a justified production dependency.

---

### Requirement 3: SSR Opt-out for Group 1 Client-Only Components

**Objective:** As a developer, I want to wrap client-only UI components with `dynamic(() => import(...), { ssr: false })` where appropriate, so that their dependencies are excluded from Turbopack's SSR externalisation and can revert to `devDependencies`.

**Summary**: Evaluate Group 1 components for `ssr: false` safety (no SEO impact, no hydration mismatch, no visible layout shift). Successfully converted components must no longer appear in `.next/node_modules/`; otherwise, the package stays in `dependencies` with documentation.

---

### Requirement 4: Classification of Unresolved Packages

**Objective:** As a developer, I want to determine the correct final classification for packages with unclear or mixed usage patterns, so that every entry in `dependencies` and `devDependencies` has a documented and verified rationale.

**Summary**: Resolve `react-toastify`, `socket.io-client`, `bootstrap`, and phantom packages (`i18next-http-backend`, `i18next-localstorage-backend`, `react-dropzone`) through code analysis and build verification. Refactor to dynamic imports where feasible; otherwise document as justified production dependencies. CI must pass after all reclassifications.

---

### Requirement 5: Final State Validation and Documentation

**Objective:** As a release engineer, I want a verified and documented final state of `dependencies` vs `devDependencies`, so that future package additions follow the correct classification rules.

**Summary**: Every symlink in `.next/node_modules/` must resolve correctly in the release artifact (no broken symlinks). No `devDependencies` package may appear in `.next/node_modules/` after a production build. The codebase must include documentation of the Turbopack externalisation rule to prevent future misclassification.
