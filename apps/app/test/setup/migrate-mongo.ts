import { execSync } from 'node:child_process';
import { beforeAll } from 'vitest';

import { getTestDbConfig } from './mongo/utils';

// Track if migrations have been run for this worker
let migrationsRun = false;

/**
 * Run database migrations using external process.
 * This uses the existing dev:migrate:up script which has ts-node and tsconfig-paths configured.
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
});
