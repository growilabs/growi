import { MongoMemoryReplSet } from 'mongodb-memory-server-core';
import mongoose from 'mongoose';
import { afterAll, beforeAll } from 'vitest';

import { mongoOptions } from '~/server/util/mongoose-utils';

import { getTestDbConfig, MONGOMS_BINARY_OPTS } from './utils';

let mongoServer: MongoMemoryReplSet | undefined;

beforeAll(async () => {
  // Skip if already connected (setupFiles run per test file, but connection persists per worker)
  if (mongoose.connection.readyState === 1) {
    return;
  }

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
});

afterAll(async () => {
  await mongoose.disconnect();

  // Stop MongoMemoryServer if it was created
  if (mongoServer) {
    await mongoServer.stop();
  }
});
