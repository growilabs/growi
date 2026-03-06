import { MongoMemoryServer } from 'mongodb-memory-server-core';
import mongoose from 'mongoose';
import { afterAll, beforeAll } from 'vitest';

import { mongoOptions } from '~/server/util/mongoose-utils';

import { getTestDbConfig } from './utils';

let mongoServer: MongoMemoryServer | undefined;

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
