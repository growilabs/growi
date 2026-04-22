# Project Structure

## Monorepo Layout

```
growi/
├── apps/
│   ├── app/           # Main GROWI application (Next.js + Express + MongoDB)
│   ├── pdf-converter/ # PDF conversion microservice (Ts.ED + Puppeteer)
│   └── slackbot-proxy/# Slack integration proxy (Ts.ED + TypeORM + MySQL)
├── packages/          # Shared libraries
│   ├── core/          # Domain types & utilities hub (see below)
│   ├── ui/            # React component library
│   ├── editor/        # Markdown editor
│   └── pluginkit/     # Plugin framework
└── .claude/
    ├── rules/         # Always loaded into every session
    ├── skills/        # Load on demand via Skill tool
    └── agents/        # Specialized subagents
```

## @growi/core — Shared Domain Hub

`@growi/core` is the single source of truth for cross-package types and utilities, depended on by all other packages (10+ consumers).

- **Shared interfaces go here** — `IPage`, `IUser`, `IRevision`, `Ref<T>`, `HasObjectId`, etc.
- **Cross-cutting pure utilities** — page path validation, ObjectId checks, `serializeUserSecurely()`
- **Global type augmentations** — `declare global` in `index.ts` propagates to all consumers
- Minimal runtime deps (only `bson-objectid`); safe to import from both server and client

> When adding a new interface used by multiple packages, put it in `@growi/core`, not in the consuming package.

## Build Order Management

Turborepo build dependencies are declared **explicitly**, not auto-detected from `pnpm-workspace.yaml`.

When a package gains a new workspace dependency on another buildable package (one that produces `dist/`), declare it in a per-package `turbo.json`:

```json
// packages/my-package/turbo.json
{
  "extends": ["//"],
  "tasks": {
    "build": { "dependsOn": ["@growi/some-dep#build"] },
    "dev":   { "dependsOn": ["@growi/some-dep#dev"] }
  }
}
```

- `"extends": ["//"]` inherits root task definitions; only add the extra `dependsOn`
- Omitting this causes Turborepo to build in the wrong order → missing `dist/` → type errors

## Adding Workspace Dependencies

When referencing another package in the monorepo, use the `workspace:` protocol — never a hardcoded version:

```json
{ "@growi/core": "workspace:^" }
```

After editing `package.json`, run `pnpm install` from the repo root to update the lockfile.

## New Package Defaults

When creating a new package, use **Biome + Vitest** from the start (not ESLint/Prettier/Jest):

```bash
biome check <files>          # lint + format check
biome check --write <files>  # auto-fix
```

Configuration lives in the root `biome.json` (inherited by all packages). Legacy packages may still use ESLint during migration — don't add ESLint to new packages.

## Changeset Workflow

```bash
# 1. After making changes that affect published packages:
npx changeset          # Describe the change, select bump type

# 2. Commit both code and the generated .changeset/*.md file

# 3. On release:
pnpm run version-subpackages   # Updates CHANGELOG.md + package.json versions
pnpm run release-subpackages   # Publishes @growi/core, @growi/pluginkit to npm
```

Published packages: `@growi/core`, `@growi/pluginkit`. Internal packages do not need changesets.
