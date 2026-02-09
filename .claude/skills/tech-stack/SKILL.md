---
name: tech-stack
description: GROWI technology stack, build tools, and global commands. Auto-invoked for all GROWI development work.
user-invocable: false
---

# GROWI Tech Stack

## Core Technologies

- **TypeScript** ~5.0.0
- **Node.js** ^18 || ^20
- **MongoDB** with **Mongoose** ^6.13.6 (apps/app)
- **MySQL** with **TypeORM** 0.2.x (apps/slackbot-proxy)

## Frontend Framework

- **React** 18.x
- **Next.js** (Pages Router) - Full-stack framework for apps/app

## State Management & Data Fetching (Global Standard)

- **Jotai** - Atomic state management (recommended for all packages with UI state)
  - Use for UI state, form state, modal state, etc.
  - Lightweight, TypeScript-first, minimal boilerplate

- **SWR** ^2.3.2 - Data fetching with caching
  - Use for API data fetching with automatic revalidation
  - Works seamlessly with RESTful APIs

### Why Jotai + SWR?

- **Separation of concerns**: Jotai for UI state, SWR for server state
- **Performance**: Fine-grained reactivity (Jotai) + intelligent caching (SWR)
- **Type safety**: Both libraries have excellent TypeScript support
- **Simplicity**: Minimal API surface, easy to learn

## Build & Development Tools

### Package Management
- **pnpm** 10.4.1 - Package manager (faster, more efficient than npm/yarn)

### Monorepo Orchestration
- **Turborepo** ^2.1.3 - Build system with caching and parallelization

### Linter & Formatter
- **Biome** ^2.2.6 - Unified linter and formatter (recommended)
  - Replaces ESLint + Prettier
  - Significantly faster (10-100x)
  - Configuration: `biome.json`

```bash
# Lint and format check
biome check <files>

# Auto-fix issues
biome check --write <files>
```

- **Stylelint** ^16.5.0 - SCSS/CSS linter
  - Configuration: `.stylelintrc.js`

```bash
# Lint styles
stylelint "src/**/*.scss"
```

### Testing
- **Vitest** ^2.1.1 - Unit and integration testing (recommended)
  - Fast, Vite-powered
  - Jest-compatible API
  - Configuration: `vitest.workspace.mts`

- **React Testing Library** ^16.0.1 - Component testing
  - User-centric testing approach

- **vitest-mock-extended** ^2.0.2 - Type-safe mocking
  - TypeScript autocomplete for mocks

- **Playwright** ^1.49.1 - E2E testing
  - Cross-browser testing

## Essential Commands (Global)

### Development

```bash
# Start all dev servers (apps/app + dependencies)
turbo run dev

# Start dev server for specific package
turbo run dev --filter @growi/app

# Install dependencies for all packages
pnpm install

# Bootstrap (install + build dependencies)
turbo run bootstrap
```

### Testing & Quality

```bash
# Run a specific test file (from package directory, e.g. apps/app)
pnpm vitest run yjs.integ          # Partial file name match
pnpm vitest run helper.spec        # Works for any test file
pnpm vitest run yjs.integ --repeat=10  # Repeat for flaky test detection

# Run ALL tests for a package (uses Turborepo caching)
turbo run test --filter @growi/app

# Run linters for specific package
turbo run lint --filter @growi/app
```

### Building

```bash
# Build all packages
turbo run build

# Build specific package
turbo run build --filter @growi/core
```

## Turborepo Task Filtering

Turborepo uses `--filter` to target specific packages:

```bash
# Run task for single package
turbo run test --filter @growi/app

# Run task for multiple packages
turbo run build --filter @growi/core --filter @growi/ui

# Run task for package and its dependencies
turbo run build --filter @growi/app...
```

## Important Configuration Files

### Workspace Configuration
- **pnpm-workspace.yaml** - Defines workspace packages
  ```yaml
  packages:
    - 'apps/*'
    - 'packages/*'
  ```

### Build Configuration
- **turbo.json** - Turborepo pipeline configuration
  - Defines task dependencies, caching, and outputs

### TypeScript Configuration
- **tsconfig.base.json** - Base TypeScript config extended by all packages
  - **Target**: ESNext
  - **Module**: ESNext
  - **Strict Mode**: Enabled (`strict: true`)
  - **Module Resolution**: Bundler
  - **Allow JS**: true (for gradual migration)
  - **Isolated Modules**: true (required for Vite, SWC)

Package-specific tsconfig.json example:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.spec.ts"]
}
```

### Testing Configuration
- **vitest.workspace.mts** - Vitest workspace config
  - Defines test environments (Node.js, happy-dom)
  - Configures coverage

### Linter Configuration
- **biome.json** - Biome linter/formatter config
  - Rules, ignore patterns, formatting options

## Development Best Practices

### Command Usage

1. **Use Turborepo for full-package tasks** (all tests, lint, build):
   - ✅ `turbo run test --filter @growi/app`
   - ❌ `cd apps/app && pnpm test` (bypasses Turborepo caching)
2. **Use vitest directly for individual test files** (from package directory):
   - ✅ `pnpm vitest run yjs.integ` (simple, fast)
   - ❌ `turbo run test --filter @growi/app -- yjs.integ` (unnecessary overhead)

2. **Use pnpm for package management**:
   - ✅ `pnpm install`
   - ❌ `npm install` or `yarn install`

3. **Run tasks from workspace root**:
   - Turborepo handles cross-package dependencies
   - Caching works best from root

### State Management Guidelines

1. **Use Jotai for UI state**:
   ```typescript
   // Example: Modal state
   import { atom } from 'jotai';

   export const isModalOpenAtom = atom(false);
   ```

2. **Use SWR for server state**:
   ```typescript
   // Example: Fetching pages
   import useSWR from 'swr';

   const { data, error, isLoading } = useSWR('/api/pages', fetcher);
   ```

3. **Avoid mixing concerns**:
   - Don't store server data in Jotai atoms
   - Don't manage UI state with SWR

## Migration Notes

- **New packages**: Use Biome + Vitest from the start
- **Legacy packages**: Can continue using existing tools during migration
- **Gradual migration**: Prefer updating to Biome + Vitest when modifying existing files

## Technology Decisions

### Why Next.js Pages Router (not App Router)?

- GROWI started before App Router was stable
- Pages Router is well-established and stable
- Migration to App Router is being considered for future versions

### Why Jotai (not Redux/Zustand)?

- **Atomic approach**: More flexible than Redux, simpler than Recoil
- **TypeScript-first**: Excellent type inference
- **Performance**: Fine-grained reactivity, no unnecessary re-renders
- **Minimal boilerplate**: Less code than Redux

### Why SWR (not React Query)?

- **Simplicity**: Smaller API surface
- **Vercel integration**: Built by Vercel (same as Next.js)
- **Performance**: Optimized for Next.js SSR/SSG

### Why Biome (not ESLint + Prettier)?

- **Speed**: 10-100x faster than ESLint
- **Single tool**: Replaces both ESLint and Prettier
- **Consistency**: No conflicts between linter and formatter
- **Growing ecosystem**: Active development, Rust-based

## Package-Specific Tech Stacks

Different apps in the monorepo may use different tech stacks:

- **apps/app**: Next.js + Express + MongoDB + Jotai + SWR
- **apps/pdf-converter**: Ts.ED + Puppeteer
- **apps/slackbot-proxy**: Ts.ED + TypeORM + MySQL

See package-specific CLAUDE.md or skills for details.
