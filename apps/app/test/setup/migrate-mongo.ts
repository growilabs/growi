import { execSync } from 'node:child_process';
import { beforeAll } from 'vitest';

import { getTestDbConfig } from './mongo/utils';

// Track if migrations have been run for this worker
let migrationsRun = false;

/**
 * Run database migrations using external process.
 * This uses the existing dev:migrate:up script (migrate-mongo via plain node + umzug via tsx).
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
// default 10s is borderline under the parallel integration run; 20s gives a
// modest margin without normalizing a runaway threshold. NOTE: if this keeps
// flaking, the real cause is the dev runner's per-file resolve/load cost over
// the migration import fan-out (see esm-migration research.md §"dev runner
// bake-off") — fix the runner perf (Phase 3.8.e ±20% gate), not this number.
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
