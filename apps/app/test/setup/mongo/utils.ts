import ConnectionString from 'mongodb-connection-string-url';
import type { MongoBinary } from 'mongodb-memory-server-core';

export const MONGOMS_BINARY_OPTS: Parameters<typeof MongoBinary.getPath>[0] = {
  version: process.env.VITE_MONGOMS_VERSION,
  downloadDir: 'node_modules/.cache/mongodb-binaries',
};

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
