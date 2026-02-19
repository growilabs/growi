import ConnectionString from 'mongodb-connection-string-url';

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
