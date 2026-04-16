import { MongoBinary } from 'mongodb-memory-server-core';

import { MONGOMS_BINARY_OPTS } from './utils';

/**
 * Global setup: pre-download the MongoDB binary before any workers start.
 * This prevents lock-file race conditions when multiple Vitest workers try to
 * download the binary concurrently on the first run.
 */
export async function setup(): Promise<void> {
  // Skip if using an external MongoDB (e.g. CI with GitHub Actions services)
  if (process.env.MONGO_URI != null) {
    return;
  }

  await MongoBinary.getPath(MONGOMS_BINARY_OPTS);
}
