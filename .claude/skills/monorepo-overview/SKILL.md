---
name: monorepo-overview
description: GROWI monorepo structure, workspace organization, and architectural principles. Auto-invoked for all GROWI development work.
user-invocable: false
---

# GROWI Monorepo Overview

GROWI is a team collaboration wiki platform built as a monorepo using **pnpm workspace + Turborepo**.

## Monorepo Structure

```
growi/
├── apps/                    # Applications
│   ├── app/                # Main GROWI application (Next.js + Express + MongoDB)
│   ├── pdf-converter/      # PDF conversion microservice (Ts.ED + Puppeteer)
│   └── slackbot-proxy/     # Slack integration proxy (Ts.ED + TypeORM + MySQL)
├── packages/               # Shared libraries
│   ├── core/              # Core utilities and shared logic
│   ├── core-styles/       # Common styles (SCSS)
│   ├── editor/            # Markdown editor components
│   ├── ui/                # UI component library
│   ├── pluginkit/         # Plugin framework
│   ├── slack/             # Slack integration utilities
│   ├── presentation/      # Presentation mode
│   ├── pdf-converter-client/ # PDF converter client library
│   └── remark-*/          # Markdown plugins (remark-lsx, remark-drawio, etc.)
└── Configuration files
    ├── pnpm-workspace.yaml
    ├── turbo.json
    ├── package.json
    └── .changeset/
```

## Workspace Management

### pnpm Workspace

All packages are managed via **pnpm workspace**. Package references use the `workspace:` protocol:

```json
{
  "dependencies": {
    "@growi/core": "workspace:^",
    "@growi/ui": "workspace:^"
  }
}
```

### Turborepo Orchestration

Turborepo handles task orchestration with caching and parallelization:

```bash
# Run tasks across all workspaces
turbo run dev
turbo run test
turbo run lint
turbo run build

# Filter to specific package
turbo run test --filter @growi/app
turbo run lint --filter @growi/core
```

## Architectural Principles

### 1. Feature-Based Architecture (Recommended)

**All packages should prefer feature-based organization**:

```
{package}/src/
├── features/              # Feature modules
│   ├── {feature-name}/
│   │   ├── index.ts      # Main export
│   │   ├── interfaces/   # TypeScript types
│   │   ├── server/       # Server-side logic (if applicable)
│   │   ├── client/       # Client-side logic (if applicable)
│   │   └── utils/        # Shared utilities
```

**Benefits**:
- Clear boundaries between features
- Easy to locate related code
- Facilitates gradual migration from legacy structure

### 2. Server-Client Separation

For full-stack packages (like apps/app), separate server and client logic:

- **Server code**: Node.js runtime, database access, API routes
- **Client code**: Browser runtime, React components, UI state

This enables better code splitting and prevents server-only code from being bundled into client.

### 3. Shared Libraries in packages/

Common code should be extracted to `packages/`:

- **core**: Utilities, constants, type definitions
- **ui**: Reusable React components
- **editor**: Markdown editor
- **pluginkit**: Plugin system framework

## Version Management with Changeset

GROWI uses **Changesets** for version management and release notes:

```bash
# Add a changeset (after making changes)
npx changeset

# Version bump (generates CHANGELOGs and updates versions)
pnpm run version-subpackages

# Publish packages to npm (for @growi/core, @growi/pluginkit)
pnpm run release-subpackages
```

### Changeset Workflow

1. Make code changes
2. Run `npx changeset` and describe the change
3. Commit both code and `.changeset/*.md` file
4. On release, run `pnpm run version-subpackages`
5. Changesets automatically updates `CHANGELOG.md` and `package.json` versions

### Version Schemes

- **Main app** (`apps/app`): Manual versioning with RC prereleases
  - `pnpm run version:patch`, `pnpm run version:prerelease`
- **Shared libraries** (`packages/core`, `packages/pluginkit`): Changeset-managed
- **Microservices** (`apps/pdf-converter`, `apps/slackbot-proxy`): Independent versioning

## Package Categories

### Applications (apps/)

| Package | Description | Tech Stack |
|---------|-------------|------------|
| **@growi/app** | Main wiki application | Next.js (Pages Router), Express, MongoDB, Jotai, SWR |
| **@growi/pdf-converter** | PDF export service | Ts.ED, Puppeteer |
| **@growi/slackbot-proxy** | Slack bot proxy | Ts.ED, TypeORM, MySQL |

### Core Libraries (packages/)

| Package | Description | Published to npm |
|---------|-------------|------------------|
| **@growi/core** | Core utilities | ✅ |
| **@growi/pluginkit** | Plugin framework | ✅ |
| **@growi/ui** | UI components | ❌ (internal) |
| **@growi/editor** | Markdown editor | ❌ (internal) |
| **@growi/core-styles** | Common styles | ❌ (internal) |

## Development Workflow

### Initial Setup

```bash
# Install dependencies for all packages
pnpm install

# Bootstrap (install + build dependencies)
turbo run bootstrap
```

### Daily Development

```bash
# Start all dev servers (apps/app + dependencies)
turbo run dev

# Run a specific test file (from package directory)
pnpm vitest run yjs.integ

# Run ALL tests / lint for a package
turbo run test --filter @growi/app
turbo run lint --filter @growi/core
```

### Cross-Package Development

When modifying shared libraries (packages/*), ensure dependent apps reflect changes:

1. Make changes to `packages/core`
2. Turborepo automatically detects changes and rebuilds dependents
3. Test in `apps/app` to verify

## Key Configuration Files

- **pnpm-workspace.yaml**: Defines workspace packages
- **turbo.json**: Turborepo pipeline configuration
- **.changeset/config.json**: Changeset configuration
- **tsconfig.base.json**: Base TypeScript config for all packages
- **vitest.workspace.mts**: Vitest workspace config
- **biome.json**: Biome linter/formatter config

## Design Principles Summary

1. **Feature Isolation**: Use feature-based architecture for new code
2. **Server-Client Separation**: Keep server and client code separate
3. **Shared Libraries**: Extract common code to packages/
4. **Type-Driven Development**: Define interfaces before implementation
5. **Progressive Enhancement**: Migrate legacy code gradually
6. **Version Control**: Use Changesets for release management
