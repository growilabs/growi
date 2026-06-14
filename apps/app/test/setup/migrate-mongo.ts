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

// 120s timeout: this hook spawns `dev:migrate:up`, which runs every migration
// through tsx (cold-transpiling the 48 migrations + their `~/server/**` import
// graph) once per Vitest worker. Under the parallel integration run (many
// workers transpiling at once against one Mongo) this routinely exceeds the
// default 10s hook timeout — bumped so a slow-but-successful migration pass
// does not flake the suite.
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
}, 120_000);
