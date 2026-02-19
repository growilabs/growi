# Requirements Document

## Introduction

When running `turbo run dev` for `apps/app` and accessing a page, Next.js compiles the `[[...path]]` catch-all route with over 10,000 modules (`Compiled /[[...path]] in 51.5s (10066 modules)`). This is excessive and likely caused by unnecessary server-side modules being pulled into the client bundle, barrel export patterns causing full module tree traversal, and suboptimal tree-shaking. The goal is to investigate root causes, identify effective Next.js configuration options from official documentation, reduce the module count significantly, and improve developer experience (DX) by reducing compilation time. If a Next.js major upgrade is needed to achieve these goals, it should be pursued.

## Requirements

### Requirement 1: Next.js Official Configuration Research

**Objective:** As a developer, I want to research and identify effective Next.js configuration options from official documentation that can reduce the module count and compilation time, so that I can apply proven optimization strategies.

#### Acceptance Criteria

1. The research shall evaluate the following Next.js configuration options for applicability to the GROWI Pages Router architecture:
   - `optimizePackageImports` — barrel file optimization for packages with hundreds of re-exports (documented to reduce modules by up to 90% for libraries like `@material-ui/icons`: 11,738 → 632 modules)
   - `bundlePagesRouterDependencies` — automatic server-side dependency bundling for Pages Router (matches App Router default behavior)
   - `serverExternalPackages` — opt-out specific heavy/native dependencies from server-side bundling to use native Node.js `require`
   - Turbopack adoption — automatic import optimization without manual `optimizePackageImports` config, with 14x faster cold starts and 28x faster HMR vs Webpack
2. The research shall document which options are applicable to the current GROWI setup (Pages Router, Next.js 14, Webpack) and which require a version upgrade.
3. The research shall produce a prioritized list of configuration changes with estimated impact, based on official Next.js benchmarks and the GROWI-specific module analysis.
4. Where Next.js provides built-in bundle analysis tools (`@next/bundle-analyzer`, `next experimental-analyze`), the research shall evaluate their use for identifying the top module contributors in the `[[...path]]` page.

### Requirement 2: Module Count Root Cause Analysis

**Objective:** As a developer, I want to understand why the `[[...path]]` page loads 10,000+ modules during compilation, so that I can identify actionable optimization targets.

#### Acceptance Criteria

1. When the developer runs a Next.js bundle analysis on the `[[...path]]` page, the GROWI build system shall produce a report identifying the top module contributors by count and size.
2. The GROWI build system shall identify server-side-only modules (e.g., mongoose, Express models, migration scripts) that are incorrectly included in the client-side compilation of the `[[...path]]` page.
3. When barrel export files (index.ts with `export *`) are analyzed, the build analysis shall identify which barrel exports cause unnecessary module traversal and quantify the additional modules pulled in by each.

### Requirement 3: Server-Side Module Leakage Prevention

**Objective:** As a developer, I want server-side modules to be excluded from client-side compilation, so that the module count is reduced and compilation time improves.

#### Acceptance Criteria

1. The GROWI application shall ensure that server-side modules (Mongoose models, Express routes, migration scripts, server services) are not included in the client-side module graph of any Next.js page.
2. When `getServerSideProps` or server-side utility functions import server-only modules, the Next.js build system shall tree-shake those imports from the client bundle.
3. If a shared module inadvertently imports server-side code, the build system shall detect and report the import chain that causes the leakage.
4. Where `serverExternalPackages` is available (Next.js 15+), the GROWI build system shall use it to exclude heavy server-only packages (e.g., mongoose, sharp) from server-side bundling.

### Requirement 4: Barrel Export and Package Import Optimization

**Objective:** As a developer, I want to reduce the impact of barrel exports on module resolution, so that importing a single hook or component does not pull in the entire module subtree.

#### Acceptance Criteria

1. When a single export is imported from a state module (e.g., `~/states/page`), the build system shall resolve only the necessary module and its direct dependencies, not the entire barrel export tree.
2. The GROWI application shall avoid `export * from` patterns in high-traffic import paths (states, stores, features) where tree-shaking is ineffective.
3. Where `optimizePackageImports` is configured in `next.config.js`, the GROWI build system shall include all internal `@growi/*` packages and high-impact third-party packages that use barrel exports.
4. The GROWI build system shall expand the existing `optimizePackageImports` list beyond the current 11 `@growi/*` packages to cover additional barrel-heavy dependencies identified in the module analysis.

### Requirement 5: Next.js Version Evaluation and Upgrade

**Objective:** As a developer, I want to evaluate whether upgrading Next.js (from v14 to v15 or later) provides meaningful module optimization improvements, so that I can make an informed upgrade decision.

#### Acceptance Criteria

1. The evaluation shall document which Next.js 15+ features are relevant to reducing module count, specifically:
   - Turbopack as stable/default bundler (automatic import optimization, no `optimizePackageImports` config needed)
   - `bundlePagesRouterDependencies` option (automatic server-side dependency bundling for Pages Router)
   - `serverExternalPackages` (stable rename of `serverComponentsExternalPackages`)
   - Improved tree-shaking and module resolution
2. If the Next.js upgrade is determined to be beneficial, the GROWI application shall be upgraded with all breaking changes addressed.
3. When the upgrade is performed, the GROWI application shall pass all existing tests and build successfully.
4. If the upgrade is determined to be not beneficial or too risky, the evaluation shall document the reasoning and alternative approaches achievable on the current version.

### Requirement 6: Compilation Time and Module Count Reduction

**Objective:** As a developer, I want the `[[...path]]` page compilation to be significantly faster with fewer modules, so that the development feedback loop is improved.

#### Acceptance Criteria

1. After optimizations, the `[[...path]]` page shall compile with significantly fewer modules than the current 10,066 (target: measurable reduction documented with before/after metrics).
2. The GROWI application shall maintain full functional correctness after module reduction — no features shall be broken or missing.
3. While in development mode, the GROWI application shall not show any new runtime errors or warnings introduced by the module optimization changes.

### Requirement 7: Lazy Loading and Dynamic Import Verification

**Objective:** As a developer, I want lazy-loaded components to be truly excluded from the initial compilation, so that they do not contribute to the module count until actually needed.

#### Acceptance Criteria

1. When a component is declared as "lazy loaded" (e.g., `*LazyLoaded` components), the GROWI build system shall not include that component's full dependency tree in the initial page compilation.
2. The GROWI application shall use `next/dynamic` with `{ ssr: false }` for all heavy modal components that are not needed on initial page render.
3. Where a lazy-loaded component wrapper (`index.ts`) re-exports the actual component statically, the GROWI application shall restructure the export to prevent static resolution of the full component tree.
