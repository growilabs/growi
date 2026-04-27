---
name: vendor-styles-components
description: Vendor CSS precompilation system for Turbopack compatibility. How to add third-party CSS to components without violating Pages Router global CSS restriction. Auto-invoked when working in apps/app.
---

# Vendor CSS Precompilation (apps/app)

## Problem

Turbopack (Pages Router) strictly enforces: **global CSS can only be imported from `_app.page.tsx`**. Components cannot `import 'package/style.css'` directly — Turbopack rejects these at compile time.

Centralizing all vendor CSS in `_app` would degrade FCP for pages that don't need those styles.

## Solution: Two-Track Vendor CSS System

### Commons Track (globally shared CSS)

- **File**: `src/styles/vendor.scss`
- **For**: CSS needed on most pages (e.g., `simplebar-react`)
- **Mechanism**: Compiled via `vite.vendor-styles-commons.ts` into `src/styles/prebuilt/`
- **Imported from**: `_app.page.tsx`

### Components Track (component-specific CSS)

- **For**: CSS needed only by specific components
- **Mechanism**: Vite precompiles `*.vendor-styles.ts` entry points into `*.vendor-styles.prebuilt.ts` using `?inline` CSS import suffix
- **Output**: Pure JS modules (no CSS imports) — Turbopack sees them as regular JS

## How It Works

1. **Entry point** (`ComponentName.vendor-styles.ts`): imports CSS via Vite `?inline` suffix, which inlines CSS as a string
2. **Runtime injection**: the entry point creates a `<style>` tag and appends CSS to `document.head`
3. **Vite prebuild** (`pre:styles-components` Turborepo task): compiles entry points into `*.vendor-styles.prebuilt.ts`
4. **Component import**: imports the `.prebuilt.ts` file instead of raw CSS

### Entry Point Template

```typescript
// @ts-nocheck -- Processed by Vite only; ?inline is a Vite-specific import suffix
import css from 'some-package/dist/style.css?inline';

const s = document.createElement('style');
s.textContent = css;
document.head.appendChild(s);
```

For multiple CSS sources in one component:

```typescript
// @ts-nocheck
import css1 from 'package-a/style.css?inline';
import css2 from 'package-b/style.css?inline';

const s = document.createElement('style');
s.textContent = css1 + css2;
document.head.appendChild(s);
```

## Current Entry Points

| Entry Point | CSS Sources | Consuming Components |
|---|---|---|
| `Renderer.vendor-styles.ts` | `@growi/remark-lsx`, `@growi/remark-attachment-refs`, `katex` | renderer.tsx |
| `GrowiEditor.vendor-styles.ts` | `@growi/editor` | PageEditor, CommentEditor |
| `HandsontableModal.vendor-styles.ts` | `handsontable` (non-full variant) | HandsontableModal |
| `DateRangePicker.vendor-styles.ts` | `react-datepicker` | DateRangePicker |
| `RevisionDiff.vendor-styles.ts` | `diff2html` | RevisionDiff |
| `DrawioViewerWithEditButton.vendor-styles.ts` | `@growi/remark-drawio` | DrawioViewerWithEditButton |
| `ImageCropModal.vendor-styles.ts` | `react-image-crop` | ImageCropModal |
| `Presentation.vendor-styles.ts` | `@growi/presentation` | Presentation, Slides |

## Adding New Vendor CSS

1. Create `{ComponentName}.vendor-styles.ts` next to the consuming component:
   ```typescript
   // @ts-nocheck
   import css from 'new-package/dist/style.css?inline';
   const s = document.createElement('style');
   s.textContent = css;
   document.head.appendChild(s);
   ```
2. In the component, replace `import 'new-package/dist/style.css'` with:
   ```typescript
   import './ComponentName.vendor-styles.prebuilt';
   ```
3. Run `pnpm run pre:styles-components` (or let Turborepo handle it during `dev`/`build`)
4. The `.prebuilt.js` file is git-ignored and auto-generated

**Decision guide**: If the CSS is needed on nearly every page, add it to the commons track (`vendor.scss`) instead.

## Font/Asset Handling

When vendor CSS references external assets (e.g., KaTeX `@font-face` with `url(fonts/KaTeX_*.woff2)`):

- Vite emits asset files to `src/assets/` during build
- The `moveAssetsToPublic` plugin (in `vite.vendor-styles-components.ts`) relocates them to `public/static/fonts/`
- URL references in prebuilt JS are rewritten from `/assets/` to `/static/fonts/`
- Fonts are served by the existing `express.static(crowi.publicDir)` middleware
- Both `public/static/fonts/` and `src/**/*.vendor-styles.prebuilt.ts` are git-ignored

## Build Pipeline Integration

```
turbo.json tasks:
  pre:styles-components  →  build (dependency)
  dev:pre:styles-components  →  dev (dependency)

Inputs:  vite.vendor-styles-components.ts, src/**/*.vendor-styles.ts, package.json
Outputs: src/**/*.vendor-styles.prebuilt.ts, public/static/fonts/**
```

## Important Caveats

- **SSR**: CSS is injected via `<style>` tags at runtime — not available during SSR. Most consuming components use `next/dynamic({ ssr: false })`, so FOUC is not a practical concern
- **`@ts-nocheck`**: Required because `?inline` is a Vite-specific import suffix not understood by TypeScript
- **handsontable**: Must use `handsontable/dist/handsontable.css` (non-full, non-minified). The "full" variant (`handsontable.full.min.css`) contains IE CSS hacks (`*zoom:1`, `filter:alpha()`) that Turbopack's CSS parser (lightningcss) cannot parse. The "full" variant also includes Pikaday which is unused.
