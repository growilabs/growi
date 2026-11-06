import { MongoMemoryServer } from 'mongodb-memory-server-core';
import mongoose from 'mongoose';

import { replaceMongoDbName } from './utils';

/**
 * Connect a self-contained test file — one that manages its own connection
 * lifecycle from beforeAll to afterAll, as opposed to relying on the
 * app-integration project's shared per-worker connection (test/setup/mongo/index.ts) —
 * to a real MongoDB.
 *
 * Prefers the already-running MongoDB CI provides via MONGO_URI; only spawns
 * an embedded MongoMemoryServer when it's unset. See
 * apps/app/.claude/rules/mongo-test-setup.md for why this check matters.
 */
export async function connectSelfContainedMongo(
  dbName: string,
): Promise<{ mongod?: MongoMemoryServer }> {
  const mongoUri = process.env.MONGO_URI
    ? replaceMongoDbName(process.env.MONGO_URI, dbName)
    : null;

  if (mongoUri != null) {
    await mongoose.connect(mongoUri);
    return {};
  }

  const mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  return { mongod };
}

/** Counterpart to {@link connectSelfContainedMongo}; call from afterAll. */
export async function disconnectSelfContainedMongo(
  mongod?: MongoMemoryServer,
): Promise<void> {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await mongod?.stop();
}
