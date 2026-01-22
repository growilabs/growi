import path from 'node:path';
import { beforeAll } from 'vitest';

import { mongoOptions } from '~/server/util/mongoose-utils';

import { getTestDbConfig } from './mongo';

// Track if migrations have been run for this worker
let migrationsRun = false;

/**
 * Run database migrations using migrate-mongo API.
 * This is necessary when using external MongoDB in CI to ensure each worker's
 * database has the required schema and indexes.
 */
async function runMigrations(mongoUri: string, dbName: string): Promise<void> {
  // Dynamic import for migrate-mongo (CommonJS module)
  // @ts-expect-error migrate-mongo does not have type definitions
  const { config, up, database } = await import('migrate-mongo');

  // Set custom config for this worker's database
  config.set({
    mongodb: {
      url: mongoUri,
      databaseName: dbName,
      options: mongoOptions,
    },
    // Use process.cwd() for reliability in Vitest environment
    // In CI, tests run from apps/app directory
    migrationsDir: path.resolve(process.cwd(), 'src/migrations'),
    changelogCollectionName: 'migrations',
  });

  // Connect and run migrations
  const { db, client } = await database.connect();
  try {
    const migrated = await up(db, client);
    if (migrated.length > 0) {
      // biome-ignore lint/suspicious/noConsole: Allow logging
      console.log(`Migrations applied: ${migrated.join(', ')}`);
    }
  } finally {
    await client.close();
  }
}

beforeAll(async () => {
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

  await runMigrations(mongoUri, dbName);
  migrationsRun = true;
});
