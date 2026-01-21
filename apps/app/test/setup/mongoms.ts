import { MongoMemoryServer } from 'mongodb-memory-server-core';
import mongoose from 'mongoose';

import { mongoOptions } from '~/server/util/mongoose-utils';

let mongoServer: MongoMemoryServer | undefined;

beforeAll(async () => {
  // Use external MongoDB if MONGO_URI is provided (e.g., in CI with GitHub Actions services)
  if (process.env.MONGO_URI) {
    // Generate unique database name for each test worker to avoid conflicts in parallel execution
    // VITEST_POOL_ID is provided by Vitest (e.g., "1", "2", "3"...)
    const workerId = process.env.VITEST_POOL_ID || '1';
    const dbName = `growi_test_${workerId}`;
    
    // Parse base URI and append database name
    // Handle both cases: with and without existing database name in URI
    let mongoUri: string;
    if (process.env.MONGO_URI.includes('?')) {
      // URI has query parameters: mongodb://host:port/dbname?params
      mongoUri = process.env.MONGO_URI.replace(/\/[^/?]*(\?|$)/, `/${dbName}$1`);
    } else if (process.env.MONGO_URI.match(/\/[^/]+$/)) {
      // URI has database name: mongodb://host:port/dbname
      mongoUri = process.env.MONGO_URI.replace(/\/[^/]+$/, `/${dbName}`);
    } else {
      // URI has no database name: mongodb://host:port or mongodb://host:port/
      mongoUri = process.env.MONGO_URI.replace(/\/?$/, `/${dbName}`);
    }
    
    // biome-ignore lint/suspicious/noConsole: Allow logging
    console.log(`Using external MongoDB at ${mongoUri} (worker: ${workerId})`);
    await mongoose.connect(mongoUri, mongoOptions);
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
