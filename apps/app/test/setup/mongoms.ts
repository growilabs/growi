import { MongoMemoryServer } from 'mongodb-memory-server-core';
import mongoose from 'mongoose';

import { mongoOptions } from '~/server/util/mongoose-utils';

let mongoServer: MongoMemoryServer | undefined;

/**
 * Replace the database name in a MongoDB connection URI.
 * Supports various URI formats including authentication, replica sets, and query parameters.
 * Uses a simple string-based approach that handles most MongoDB URI formats correctly.
 * 
 * @param uri - MongoDB connection URI
 * @param newDbName - New database name to use
 * @returns Modified URI with the new database name
 */
function replaceMongoDbName(uri: string, newDbName: string): string {
  try {
    // For standard single-host URIs, use URL API for robust parsing
    // Format: mongodb://[username:password@]host[:port][/database][?options]
    if (!uri.includes(',')) {
      const url = new URL(uri);
      url.pathname = `/${newDbName}`;
      return url.toString();
    }
    
    // For replica set URIs with multiple hosts (contains comma)
    // Format: mongodb://host1:port1,host2:port2[/database][?options]
    // URL API doesn't support multiple hosts, so use string manipulation
    const [beforeDb, afterDb] = uri.split('?');
    const queryString = afterDb ? `?${afterDb}` : '';
    
    // Find the last slash before the database name (after all hosts)
    const lastSlashIndex = beforeDb.lastIndexOf('/');
    if (lastSlashIndex > 'mongodb://'.length) {
      // URI has a database name, replace it
      const baseUri = beforeDb.substring(0, lastSlashIndex);
      return `${baseUri}/${newDbName}${queryString}`;
    }
    
    // URI has no database name, append it
    return `${beforeDb}/${newDbName}${queryString}`;
  } catch (error) {
    // If parsing fails, throw an error with helpful message
    throw new Error(`Failed to parse MongoDB URI: ${error instanceof Error ? error.message : String(error)}`);
  }
}

beforeAll(async () => {
  // Generate unique database name for each test worker to avoid conflicts in parallel execution
  // VITEST_WORKER_ID is provided by Vitest (e.g., "1", "2", "3"...)
  const workerId = process.env.VITEST_WORKER_ID || '1';
  const dbName = `growi_test_${workerId}`;

  // Use external MongoDB if MONGO_URI is provided (e.g., in CI with GitHub Actions services)
  if (process.env.MONGO_URI) {
    const mongoUri = replaceMongoDbName(process.env.MONGO_URI, dbName);
    
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
      // Use unique database name per worker to avoid conflicts in parallel execution
      dbName,
    },
    binary: {
      version: process.env.VITE_MONGOMS_VERSION,
      downloadDir: 'node_modules/.cache/mongodb-binaries',
    },
  });

  // biome-ignore lint/suspicious/noConsole: Allow logging
  console.log(`MongoMemoryServer is running on ${mongoServer.getUri()} (worker: ${workerId})`);

  await mongoose.connect(mongoServer.getUri(), mongoOptions);
});

afterAll(async () => {
  await mongoose.disconnect();
  
  // Stop MongoMemoryServer if it was created
  if (mongoServer) {
    await mongoServer.stop();
  }
});
