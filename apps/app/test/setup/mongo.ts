import ConnectionString from 'mongodb-connection-string-url';
import { MongoMemoryServer } from 'mongodb-memory-server-core';
import mongoose from 'mongoose';
import { afterAll, beforeAll } from 'vitest';

import { mongoOptions } from '~/server/util/mongoose-utils';

let mongoServer: MongoMemoryServer | undefined;

/**
 * Replace the database name in a MongoDB connection URI.
 * Uses mongodb-connection-string-url package for robust parsing.
 * Supports various URI formats including authentication, replica sets, and query parameters.
 *
 * @param uri - MongoDB connection URI
 * @param newDbName - New database name to use
 * @returns Modified URI with the new database name
 */
export function replaceMongoDbName(uri: string, newDbName: string): string {
  const cs = new ConnectionString(uri);
  cs.pathname = `/${newDbName}`;
  return cs.href;
}

/**
 * Get test database configuration for the current Vitest worker.
 * Each worker gets a unique database name to avoid conflicts in parallel execution.
 */
export function getTestDbConfig(): {
  workerId: string;
  dbName: string;
  mongoUri: string | null;
} {
  // VITEST_WORKER_ID is provided by Vitest (e.g., "1", "2", "3"...)
  const workerId = process.env.VITEST_WORKER_ID || '1';
  const dbName = `growi_test_${workerId}`;
  const mongoUri = process.env.MONGO_URI
    ? replaceMongoDbName(process.env.MONGO_URI, dbName)
    : null;

  return { workerId, dbName, mongoUri };
}

beforeAll(async () => {
  const { workerId, dbName, mongoUri } = getTestDbConfig();

  // Use external MongoDB if MONGO_URI is provided (e.g., in CI with GitHub Actions services)
  if (mongoUri != null) {
    // biome-ignore lint/suspicious/noConsole: Allow logging
    console.log(`Using external MongoDB at ${mongoUri} (worker: ${workerId})`);

    // Migrations are run by migrate-mongo.ts setup file
    await mongoose.connect(mongoUri, mongoOptions);
    return;
  }

  // Use MongoMemoryServer for local development
  // set debug flag
  process.env.MONGOMS_DEBUG = process.env.VITE_MONGOMS_DEBUG;

  // set version
  mongoServer = await MongoMemoryServer.create({
    instance: {
      dbName,
    },
    binary: {
      version: process.env.VITE_MONGOMS_VERSION,
      downloadDir: 'node_modules/.cache/mongodb-binaries',
    },
  });

  // biome-ignore lint/suspicious/noConsole: Allow logging
  console.log(
    `MongoMemoryServer is running on ${mongoServer.getUri()} (worker: ${workerId})`,
  );

  await mongoose.connect(mongoServer.getUri(), mongoOptions);
});

afterAll(async () => {
  await mongoose.disconnect();

  // Stop MongoMemoryServer if it was created
  if (mongoServer) {
    await mongoServer.stop();
  }
});
