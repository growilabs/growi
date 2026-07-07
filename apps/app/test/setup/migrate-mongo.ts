import { execSync } from 'node:child_process';
import { beforeAll } from 'vitest';

import { getTestDbConfig } from './mongo/utils';

// Track if migrations have been run for this worker
let migrationsRun = false;

/**
 * Run database migrations using external process.
 * This uses the existing dev:migrate:up script (migrate-mongo via plain node +
 * umzug via Node's native TS runner — Node 24 strip-only type stripping (no
 * --experimental-transform-types) + the resolve-only hook in
 * bin/runtime/dev-esm-resolver.mjs, no tsx).
 */
function runMigrations(mongoUri: string): void {
  // Run migrations using the existing script with custom MONGO_URI
  execSync('pnpm run dev:migrate:up', {
    cwd: process.cwd(),
    env: {
      ...process.env,
      MONGO_URI: mongoUri,
    },
    stdio: 'inherit',
  });
}

// 20s timeout (2x the 10s default): this hook spawns `dev:migrate:up`, which
// runs every migration through the dev TS runner once per Vitest worker. The
// dev runner is now Node-native (strip-only type stripping + a synchronous
// resolve-only hook), ~2x faster to load the graph than the former tsx, so per-file
// resolve/load is no longer the bottleneck — the residual time is mostly DB
// I/O under the parallel integration run. 20s is a modest margin over that;
// any further reduction should follow a measured baseline (Phase 3.8.e ±20%
// gate on the devcontainer), not a guess.
beforeAll(() => {
  // Skip if already run (setupFiles run per test file, but we only need to migrate once per worker)
  if (migrationsRun) {
    return;
  }

  const { dbName, mongoUri } = getTestDbConfig();

  // Only run migrations when using external MongoDB (CI environment)
  if (mongoUri == null) {
    return;
  }

  // biome-ignore lint/suspicious/noConsole: Allow logging
  console.log(`Running migrations for ${dbName}...`);

  runMigrations(mongoUri);
  migrationsRun = true;
}, 20_000);
