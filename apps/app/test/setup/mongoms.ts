import { MongoMemoryServer } from 'mongodb-memory-server-core';
import mongoose from 'mongoose';

import { mongoOptions } from '~/server/util/mongoose-utils';

let mongoServer: MongoMemoryServer | undefined;

beforeAll(async () => {
  // Use external MongoDB if MONGO_URI is provided (e.g., in CI with GitHub Actions services)
  if (process.env.MONGO_URI) {
    // Generate unique database name for each test worker to avoid conflicts in parallel execution
    // VITEST_WORKER_ID is provided by Vitest (e.g., "1", "2", "3"...)
    const workerId = process.env.VITEST_WORKER_ID || '1';
    const dbName = `growi_test_${workerId}`;
    
    // Parse base URI and append database name
    // Extract base URI (protocol + host + port) and query parameters
    const [uriWithoutQuery, queryString] = process.env.MONGO_URI.split('?');
    
    // Find the last slash after the protocol (mongodb://)
    // and replace everything after it with the new database name
    let baseUri: string;
    const protocolMatch = uriWithoutQuery.match(/^mongodb:\/\/[^/]+/);
    if (protocolMatch) {
      baseUri = protocolMatch[0];
    } else {
      // Fallback: if no match, use the whole URI
      baseUri = uriWithoutQuery;
    }
    
    const mongoUri = `${baseUri}/${dbName}${queryString ? '?' + queryString : ''}`;
    
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
