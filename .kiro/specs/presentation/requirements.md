# Presentation Feature — Requirements Overview

## Introduction

The GROWI presentation feature (`@growi/presentation` package) provides slide rendering for wiki pages using frontmatter flags. It supports two rendering modes:

- **GrowiSlides** (`slide: true`): Lightweight slide rendering using ReactMarkdown with Marp container styling applied via pre-extracted CSS constants. Does not load Marp runtime dependencies.
- **MarpSlides** (`marp: true`): Full Marp-powered slide rendering using `@marp-team/marp-core`, loaded dynamically only when needed.

## Key Requirements

### 1. Module Separation

GrowiSlides renders without loading `@marp-team/marp-core` or `@marp-team/marpit`. Marp dependencies are isolated behind a dynamic import boundary (`React.lazy`) and only loaded for pages with `marp: true`.

### 2. Build-Time CSS Extraction

Marp base CSS is pre-extracted at build time via `extract-marpit-css.mjs`. The generated constants file (`consts/marpit-base-css.ts`) is committed to the repository so that dev mode works without running the extraction script first. The extraction runs automatically before source compilation via the `pre:build:src` script.

### 3. Functional Equivalence

Both Marp and non-Marp slide pages render correctly in inline view and presentation modal. No behavioral differences from the user's perspective.

### 4. Build Integrity

Both `@growi/presentation` and `@growi/app` build successfully. The GrowiSlides build output contains no Marp module references, and the Slides build output contains a dynamic `import()` for MarpSlides.
