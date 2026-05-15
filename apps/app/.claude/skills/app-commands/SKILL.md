---
name: app-commands
description: GROWI main application (apps/app) specific commands and scripts. Auto-invoked when working in apps/app.
user-invocable: false
---

# App Commands (apps/app)

Commands specific to the main GROWI application. For global commands (turbo, pnpm), see the global `tech-stack` skill.

## Quality Check Commands

**IMPORTANT**: Distinguish between Turborepo tasks and package-specific scripts.

### Turbo Tasks vs Package Scripts

| Task | Turborepo (turbo.json) | Package Script (package.json) |
|------|------------------------|-------------------------------|
| `lint` | ✅ Yes | ✅ Yes (runs all lint:\*) |
| `test` | ✅ Yes | ✅ Yes |
| `build` | ✅ Yes | ✅ Yes |
| `lint:typecheck` | ❌ No | ✅ Yes |
| `lint:biome` | ❌ No | ✅ Yes |
| `lint:styles` | ❌ No | ✅ Yes |

### Recommended Commands

```bash
# Run ALL quality checks (uses Turborepo caching)
turbo run lint --filter @growi/app
turbo run test --filter @growi/app
turbo run build --filter @growi/app

# Run INDIVIDUAL lint checks (package-specific scripts, from apps/app directory)
pnpm run lint:typecheck   # TypeScript only
pnpm run lint:biome       # Biome only
pnpm run lint:styles      # Stylelint only
```

> **Running individual test files**: See the `testing` rule (`.claude/rules/testing.md`).

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
pnpm run dev:pre:styles-commons
pnpm run dev:pre:styles-components

# Production mode
pnpm run pre:styles-commons
pnpm run pre:styles-commons-components
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

## Build Measurement

```bash
# Measure module count KPI (cleans .next, starts next dev, triggers compilation)
./bin/measure-chunk-stats.sh           # default port 3099
./bin/measure-chunk-stats.sh 3001      # custom port
```

Output: `[ChunkModuleStats] initial: N, async-only: N, total: N`

For details on module optimization and baselines, see the `build-optimization` skill.

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

## Smoke Testing

The devcontainer always has MongoDB and other services running (see `.claude/rules/devcontainer.md`). The dev server **can and should** be started for smoke verification — never claim the runtime environment is unavailable.

### Workflow

**Step 1 — Override env vars without touching committed files**

Create `apps/app/.env.development.local` (highest dotenv-flow priority; gitignored):

```bash
# Example: disable vault feature to test 404 behaviour
cat > apps/app/.env.development.local << 'EOF'
VAULT_ENABLED=false
EOF
```

dotenv-flow load order (first definition wins):
1. `.env.development.local` ← your override
2. `.env.local`
3. `.env.development` ← committed defaults
4. `.env`

> **Note:** nodemon watches `*.*` but does **not** reliably pick up dotfile changes (files starting with `.`). After editing `.env.development.local`, kill the ts-node process manually so nodemon restarts it with the new env:
> ```bash
> kill $(ss -tlnp | grep ':3000' | grep -o 'pid=[0-9]*' | cut -d= -f2)
> ```

**Step 2 — Start the dev server in background**

```bash
turbo run dev --filter @growi/app &
```

Wait for the ready message:
```bash
until curl -s http://localhost:3000/ > /dev/null 2>&1; do sleep 1; done
echo "Server ready"
```

Or watch the log for `Express server is listening on port 3000`.

**Step 3 — Curl the endpoints**

```bash
# Feature disabled → 404 (no Retry-After)
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/_vault/repo.git/info/refs?service=git-upload-pack

# Push attempt → always 403
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/_vault/repo.git/git-receive-pack

# Check response body
curl -s http://localhost:3000/_vault/repo.git/info/refs?service=git-upload-pack

# Check specific headers
curl -sI http://localhost:3000/_vault/repo.git/info/refs?service=git-upload-pack | grep -i retry-after
```

**Step 4 — Switch env and retest**

Edit `.env.development.local`, then kill and wait for nodemon to restart:

```bash
echo "VAULT_ENABLED=true" > apps/app/.env.development.local
kill $(ss -tlnp | grep ':3000' | grep -o 'pid=[0-9]*' | cut -d= -f2)
until curl -s http://localhost:3000/ > /dev/null 2>&1; do sleep 1; done
```

**Step 5 — Manipulate MongoDB state if needed**

```bash
node -e "
const { MongoClient } = require('/workspace/growi-vault/node_modules/.pnpm/mongodb@6.8.0_@aws-sdk+credential-providers@3.600.0_@aws-sdk+client-sso-oidc@3.600.0__socks@2.8.3/node_modules/mongodb');
async function main() {
  const client = new MongoClient('mongodb://mongo:27017/growi?replicaSet=rs0');
  await client.connect();
  // e.g. reset bootstrap state
  await client.db('growi').collection('vault_sync_state').updateOne(
    { _id: 'singleton' },
    { \$set: { bootstrapState: 'pending' } },
    { upsert: true }
  );
  await client.close();
}
main().catch(console.error);
"
```

**Step 6 — Stop the server**

```bash
kill $(pgrep -f "nodemon|src/server/app.ts") 2>/dev/null
```

### What counts as a passing smoke test

- The Express server starts without throwing on import (`Express server is listening on port 3000` in logs)
- Feature-flag–gated endpoints return the correct status code for each flag state (404 when disabled, 503 with the right message when bootstrap incomplete, 403 for read-only enforcement)
- No unhandled exception in server startup logs

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
