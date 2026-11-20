import { MongoBinary } from 'mongodb-memory-server-core';

import { runMigrations, TEMPLATE_DB_NAME } from './template-db';
import { MONGOMS_BINARY_OPTS, replaceMongoDbName } from './utils';

/**
 * Global setup, run once before any worker starts.
 *
 * - External MongoDB (CI): migrate a single template database
 *   (TEMPLATE_DB_NAME) once. Each test file then clones it instead of
 *   running migrate-mongo itself (#11752 -- migrate-mongo ran once per file,
 *   ~150 times in CI, saturating the runner).
 * - MongoMemoryServer (local dev): unchanged -- pre-download the binary to
 *   avoid concurrent workers racing the download on first run. Each worker
 *   still starts its own server and skips migrations entirely, as before.
 */
export async function setup(): Promise<void> {
  const mongoUri = process.env.MONGO_URI;

  if (mongoUri == null) {
    await MongoBinary.getPath(MONGOMS_BINARY_OPTS);
    return;
  }

  const templateUri = replaceMongoDbName(mongoUri, TEMPLATE_DB_NAME);
  runMigrations(templateUri);
}
