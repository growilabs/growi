import { MongoMemoryReplSet } from 'mongodb-memory-server-core';
import mongoose from 'mongoose';
import { afterAll, beforeAll } from 'vitest';

import { mongoOptions } from '~/server/util/mongoose-utils';

import { getTestDbConfig } from './test-db-config';
import { MONGOMS_BINARY_OPTS } from './utils';

let mongoServer: MongoMemoryReplSet | undefined;

// Connecting makes Mongoose build any index missing from the database (a stale
// template DB, or an empty MongoMemoryServer one) in the background. A build
// that commits mid-transaction aborts it with WriteConflict / LockTimeout
// (Prisma P2034 / P2010), so tests must not start until the builds finish.
// Only models registered by the time this hook runs (i.e. at test-file import
// time) are awaited; a model first registered later, inside a test's own
// beforeAll, is not.
// allSettled: this only waits; an index build error stays as non-fatal as it
// is without the wait, but is logged so it does not go unnoticed.
const waitForModelInit = async (): Promise<void> => {
  const models = Object.values(mongoose.models);
  const results = await Promise.allSettled(models.map((model) => model.init()));
  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      // biome-ignore lint/suspicious/noConsole: Allow logging
      console.warn(
        `Mongoose model init failed for ${models[i].modelName}:`,
        result.reason,
      );
    }
  });
};

// Spawning MongoMemoryReplSet and waiting for index builds can exceed
// vitest's default 10s hookTimeout under a full parallel run.
beforeAll(async () => {
  // Skip if already connected (setupFiles run per test file, but connection persists per worker)
  if (mongoose.connection.readyState === 1) {
    await waitForModelInit();
    return;
  }

  const { workerId, dbName, mongoUri } = getTestDbConfig();

  // Use external MongoDB if MONGO_URI is provided (e.g., in CI with GitHub Actions services)
  if (mongoUri != null) {
    // biome-ignore lint/suspicious/noConsole: Allow logging
    console.log(`Using external MongoDB at ${mongoUri} (worker: ${workerId})`);

    // Migrations are run by migrate-mongo.ts setup file
    await mongoose.connect(mongoUri, mongoOptions);
    await waitForModelInit();
    return;
  }

  // Use MongoMemoryServer for local development
  process.env.MONGOMS_DEBUG = process.env.VITE_MONGOMS_DEBUG;

  mongoServer = await MongoMemoryReplSet.create({
    binary: MONGOMS_BINARY_OPTS,
    replSet: {
      dbName,
      count: 1,
    },
    instanceOpts: [
      {
        storageEngine: 'wiredTiger',
      },
    ],
  });
  const uri = mongoServer.getUri(dbName);
  process.env.MONGO_URI = uri;

  // biome-ignore lint/suspicious/noConsole: Allow logging
  console.log(`MongoMemoryServer is running on ${uri} (worker: ${workerId})`);

  await mongoose.connect(uri, mongoOptions);
  await waitForModelInit();
}, 60_000);

afterAll(async () => {
  await mongoose.disconnect();

  // Stop MongoMemoryServer if it was created
  if (mongoServer) {
    await mongoServer.stop();
  }
});
