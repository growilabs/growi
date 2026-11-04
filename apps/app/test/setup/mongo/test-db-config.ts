import { inject } from 'vitest';

import { replaceMongoDbName } from './utils';

declare module 'vitest' {
  interface ProvidedContext {
    /**
     * Declared by a vitest project (via `test.provide`) whose tests must not share a
     * database with any other project. See {@link getTestDbConfig}.
     */
    testDbNamespace?: string;
  }
}

/**
 * Get test database configuration for the current Vitest worker.
 * Each worker gets a unique database name to avoid conflicts in parallel execution.
 *
 * The worker id alone is not unique across the whole run: Vitest numbers each pool
 * (threads / forks) from 1 independently, and pools execute concurrently, so a forks-pool
 * worker and a threads-pool worker can both be worker 1 — and, when MONGO_URI points at an
 * external MongoDB (CI), land on the same database. A project whose tests empty whole
 * collections must therefore also declare `provide: { testDbNamespace }`, which keeps its
 * database name out of reach of every other project.
 *
 * This lives apart from ./utils because reading the provided context requires the vitest
 * worker state, which `globalSetup` (another importer of that file) does not have.
 */
export function getTestDbConfig(): {
  workerId: string;
  dbName: string;
  mongoUri: string | null;
} {
  // VITEST_WORKER_ID is provided by Vitest (e.g., "1", "2", "3"...)
  const workerId = process.env.VITEST_WORKER_ID || '1';
  const namespace = inject('testDbNamespace');
  const dbName =
    namespace == null
      ? `growi_test_${workerId}`
      : `growi_test_${namespace}_${workerId}`;
  const mongoUri = process.env.MONGO_URI
    ? replaceMongoDbName(process.env.MONGO_URI, dbName)
    : null;

  return { workerId, dbName, mongoUri };
}
