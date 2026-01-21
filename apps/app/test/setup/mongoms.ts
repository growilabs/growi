import { MongoMemoryServer } from 'mongodb-memory-server-core';
import mongoose from 'mongoose';

import { mongoOptions } from '~/server/util/mongoose-utils';

let mongoServer: MongoMemoryServer | undefined;

beforeAll(async () => {
  // Use external MongoDB if MONGO_URI is provided (e.g., in CI with GitHub Actions services)
  if (process.env.MONGO_URI) {
    // biome-ignore lint/suspicious/noConsole: Allow logging
    console.log(`Using external MongoDB at ${process.env.MONGO_URI}`);
    await mongoose.connect(process.env.MONGO_URI, mongoOptions);
    return;
  }

  // Use MongoMemoryServer for local development
  // set debug flag
  process.env.MONGOMS_DEBUG = process.env.VITE_MONGOMS_DEBUG;

  // set version
  mongoServer = await MongoMemoryServer.create({
    instance: {
      dbName: 'growi_test',
    },
    binary: {
      version: process.env.VITE_MONGOMS_VERSION,
      downloadDir: 'node_modules/.cache/mongodb-binaries',
    },
  });

  // biome-ignore lint/suspicious/noConsole: Allow logging
  console.log(`MongoMemoryServer is running on ${mongoServer.getUri()}`);

  await mongoose.connect(mongoServer.getUri(), mongoOptions);
});

afterAll(async () => {
  await mongoose.disconnect();
  
  // Stop MongoMemoryServer if it was created
  if (mongoServer) {
    await mongoServer.stop();
  }
});
