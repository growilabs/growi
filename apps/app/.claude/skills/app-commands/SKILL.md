---
name: app-commands
description: GROWI main application (apps/app) specific commands and scripts. Auto-invoked when working in apps/app.
user-invocable: false
---

# App Commands (apps/app)

Commands specific to the main GROWI application. For global commands (turbo, pnpm), see the global `tech-stack` skill.

## Quick Reference

| Task | Command |
|------|---------|
| **Migration** | `pnpm run dev:migrate` |
| **OpenAPI generate** | `pnpm run openapi:generate-spec:apiv3` |
| **REPL console** | `pnpm run console` |
| **Visual regression** | `pnpm run reg:run` |
| **Version bump** | `pnpm run version:patch` |

## Database Migration

```bash
# Run pending migrations
pnpm run dev:migrate

# Check migration status
pnpm run dev:migrate:status

# Apply migrations
pnpm run dev:migrate:up

# Rollback last migration
pnpm run dev:migrate:down

# Production migration
pnpm run migrate
```

**Note**: Migrations use `migrate-mongo`. Files are in `config/migrate-mongo/`.

### Creating a New Migration

```bash
# Create migration file manually in config/migrate-mongo/
# Format: YYYYMMDDHHMMSS-migration-name.js

# Test migration cycle
pnpm run dev:migrate:up
pnpm run dev:migrate:down
pnpm run dev:migrate:up
```

## OpenAPI Commands

```bash
# Generate OpenAPI spec for API v3
pnpm run openapi:generate-spec:apiv3

# Validate API v3 spec
pnpm run lint:openapi:apiv3

# Generate operation IDs
pnpm run openapi:build:generate-operation-ids
```

Generated specs output to `tmp/openapi-spec-apiv3.json`.

## Style Pre-build (Vite)

```bash
# Development mode
pnpm run dev:pre:styles

# Production mode
pnpm run pre:styles
```

Pre-builds SCSS styles into CSS bundles using Vite.

## Debug & Utility

### REPL Console

```bash
pnpm run console
# or
pnpm run repl
```

Interactive Node.js REPL with Mongoose models loaded. Useful for debugging database queries.

### Visual Regression Testing

```bash
pnpm run reg:run
```

## Version Commands

```bash
# Bump patch version (e.g., 7.4.3 → 7.4.4)
pnpm run version:patch

# Create prerelease (e.g., 7.4.4 → 7.4.5-RC.0)
pnpm run version:prerelease

# Create preminor (e.g., 7.4.4 → 7.5.0-RC.0)
pnpm run version:preminor
```

## Production

```bash
# Start server (after build)
pnpm run server

# Start for CI environments
pnpm run server:ci
```

**Note**: `preserver` hook automatically runs migrations before starting.

## CI/CD

```bash
# Launch dev server for CI
pnpm run launch-dev:ci

# Start production server for CI
pnpm run server:ci
```

## Environment Variables

Development uses `dotenv-flow`:

- `.env` - Default values
- `.env.local` - Local overrides (not committed)
- `.env.development` - Development-specific
- `.env.production` - Production-specific

See `.env.example` for available variables.

## Troubleshooting

### Migration Issues

```bash
pnpm run dev:migrate:status   # Check status
pnpm run dev:migrate:down     # Rollback
pnpm run dev:migrate:up       # Re-apply
```

### Build Issues

```bash
pnpm run clean                # Clear artifacts
pnpm run build                # Rebuild
```
