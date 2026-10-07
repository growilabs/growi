# Research & Design Decisions

## Summary
- **Feature**: `optimize-presentation`
- **Discovery Scope**: Extension
- **Key Findings**:
  - `GrowiSlides` imports `growi-marpit.ts` only for CSS extraction (`marpit.render('')`) and a string constant — no Marp rendering is performed
  - `growi-marpit.ts` instantiates `new Marp(...)` at module scope, pulling in `@marp-team/marp-core` (~524KB) and `@marp-team/marpit` (~372KB) unconditionally
  - All consumers of `Slides.tsx` are already behind SSR-disabled dynamic boundaries (`next/dynamic`, `useLazyLoader`), making `React.lazy` safe to use within the package

## Research Log

### GrowiSlides dependency on growi-marpit.ts
- **Context**: Investigating why GrowiSlides requires Marp at all
- **Sources Consulted**: `packages/presentation/src/client/components/GrowiSlides.tsx`, `packages/presentation/src/client/services/growi-marpit.ts`
- **Findings**:
  - `GrowiSlides` imports `MARP_CONTAINER_CLASS_NAME` (string `'marpit'`), `presentationMarpit`, `slideMarpit`
  - Usage: `const { css } = marpit.render('');` — renders empty string to extract base theme CSS
  - The CSS output is deterministic (same Marp config → same CSS every time)
  - `MARP_CONTAINER_CLASS_NAME` is a plain string constant co-located with heavy Marp code
- **Implications**: GrowiSlides can be fully decoupled by pre-extracting the CSS and moving the constant

### Vite build with preserveModules and React.lazy
- **Context**: Verifying that React.lazy dynamic import works correctly in the package's Vite build output
- **Sources Consulted**: `packages/presentation/vite.config.ts`
- **Findings**:
  - Build uses `preserveModules: true` with `preserveModulesRoot: 'src'` — each source file → separate output module
  - `nodeExternals({ devDeps: true })` externalizes `@marp-team/marp-core` and `@marp-team/marpit`
  - Dynamic `import('./MarpSlides')` in source will produce dynamic `import('./MarpSlides.js')` in output
  - Next.js (app bundler) handles code-splitting of the externalized Marp packages into async chunks
- **Implications**: React.lazy in Slides.tsx will produce the correct dynamic import boundary in the build output

### SSR safety of React.lazy
- **Context**: React.lazy does not support SSR in React 18; need to verify all render paths are client-only
- **Sources Consulted**: Consumer components in apps/app
- **Findings**:
  - `PagePresentationModal`: `useLazyLoader` → client-only
  - `Presentation` wrapper: `next/dynamic({ ssr: false })`
  - `SlideRenderer`: `next/dynamic({ ssr: false })` in PageView.tsx
  - No SSR path exists for `Slides.tsx`
- **Implications**: React.lazy is safe; no need for `next/dynamic` in the shared package

### CSS extraction approach
- **Context**: Evaluating how to pre-extract the Marp base CSS
- **Sources Consulted**: `growi-marpit.ts`, package.json scripts, existing `build:vendor-styles` pattern
- **Findings**:
  - `slideMarpit.render('')` and `presentationMarpit.render('')` produce deterministic CSS strings
  - CSS only changes when `@marp-team/marp-core` is upgraded or Marp options change
  - The package already has a `build:vendor-styles` script pattern for pre-building CSS assets
  - `tsx` is not available in the workspace; extraction script must use plain Node.js (.mjs)
- **Implications**: An .mjs extraction script with dynamic imports from the built package or direct Marp usage is the simplest approach

## Design Decisions

### Decision: Pre-extracted CSS constants vs runtime generation
- **Context**: GrowiSlides needs Marp theme CSS but should not load Marp runtime
- **Alternatives Considered**:
  1. Dynamic import of growi-marpit in GrowiSlides — adds async complexity for a static value
  2. Pre-extract CSS at build time as string constants — zero runtime cost
  3. CSS file extracted to dist — requires additional CSS import handling
- **Selected Approach**: Pre-extract CSS as TypeScript string constants in `consts/marpit-base-css.ts`
- **Rationale**: The CSS is deterministic; generating it at build time eliminates runtime overhead entirely. TypeScript constants integrate seamlessly with existing import patterns.
- **Trade-offs**: Requires regeneration on Marp version upgrade (mitigated by `pre:build:src` script)
- **Follow-up**: Verify CSS output matches runtime generation; commit generated file for dev mode

### Decision: React.lazy vs next/dynamic for MarpSlides
- **Context**: Need dynamic import boundary for MarpSlides within the shared `@growi/presentation` package
- **Alternatives Considered**:
  1. `next/dynamic` — Next.js-specific, couples package to framework
  2. `React.lazy + Suspense` — standard React, works with any bundler
- **Selected Approach**: `React.lazy + Suspense`
- **Rationale**: Although the package already uses `next/head`, `React.lazy` is the standard React pattern for code-splitting and avoids further Next.js coupling. All consumer paths already disable SSR, so React.lazy's SSR limitation is irrelevant.
- **Trade-offs**: Requires `<Suspense>` wrapper; fallback UI is visible during chunk load
- **Follow-up**: Verify chunk splitting in Next.js production build

### Decision: Shared constants module for MARP_CONTAINER_CLASS_NAME
- **Context**: `MARP_CONTAINER_CLASS_NAME` is defined in `growi-marpit.ts` but needed by GrowiSlides without Marp dependency
- **Selected Approach**: Move to `consts/index.ts` (existing shared constants module)
- **Rationale**: The constant has no dependency on Marp; co-locating it with Marp code creates an unnecessary transitive import

## Risks & Mitigations
- **CSS drift on Marp upgrade**: Pre-extracted CSS may become stale → `pre:build:src` script auto-regenerates before every build
- **Suspense flash on Marp load**: Brief loading indicator when MarpSlides loads → Masked by parent `next/dynamic` loading spinner in most paths
- **Build script compatibility**: `.mjs` script must work in CI and local dev → Use standard Node.js ESM with no external tooling dependencies
