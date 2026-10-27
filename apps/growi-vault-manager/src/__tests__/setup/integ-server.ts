/**
 * Integration-test setup: boot one vault-manager runtime per Vitest worker.
 *
 * Vitest runs test FILES in parallel (pool: 'forks' → one process per worker,
 * isolated module graph per file). The vault-manager watcher applies every
 * instruction through a single global serialized pipeline, so a SHARED server
 * would force all files' instructions through one queue and starve the
 * tightest-deadline test. Instead, each worker boots its OWN in-process server
 * bound to its OWN database / bare repo / port — mirroring how apps/app
 * isolates per worker via a per-worker database name (see
 * apps/app/test/setup/mongo/index.ts).
 *
 * Because the runtime is booted in-process (not spawned), teardown is plain JS
 * (`server.stop()`), with no child-process lifecycle to manage.
 *
 * This file is a no-op unless RUN_VAULT_INTEG=true, so it does not affect the
 * unit (*.spec.ts) suite.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll } from 'vitest';

import type { VaultManagerServer } from '../../server-runtime.js';

/**
 * Replace the database name in a MongoDB connection URI while preserving the
 * host, port, and query parameters (e.g. ?replicaSet=rs0). The integration
 * URIs are single-host, so the WHATWG URL parser is sufficient.
 */
function withDbName(uri: string, dbName: string): string {
  const url = new URL(uri);
  url.pathname = `/${dbName}`;
  return url.toString();
}

if (process.env.RUN_VAULT_INTEG === 'true') {
  const workerId = process.env.VITEST_WORKER_ID ?? '1';
  const port = 3001 + Number(workerId);
  const baseMongoUri =
    process.env.MONGO_URI ??
    'mongodb://localhost:27017/growi-vault-integ?replicaSet=rs0';
  const mongoUri = withDbName(baseMongoUri, `growi-vault-integ-${workerId}`);
  const repoPath = path.join(
    os.tmpdir(),
    `vault-repo-integ-${workerId}-${process.pid}`,
  );

  // The runtime reads all of these from the environment. Set them synchronously
  // here (setupFiles run before the test module loads) so server.ts resolves
  // the per-worker PORT and the test files' top-level `const BASE_URL/MONGO_URL`
  // observe the per-worker values.
  process.env.PORT = String(port);
  process.env.MONGO_URI = mongoUri;
  process.env.VAULT_REPO_PATH = repoPath;
  process.env.VAULT_MANAGER_INTERNAL_SECRET ??= 'test-secret-for-integration';
  process.env.VAULT_MAINTENANCE_TICK_MS ??= '5000';
  process.env.VAULT_MANAGER_BASE_URL = `http://localhost:${port}`;
  process.env.MONGO_URL = mongoUri;

  let server: VaultManagerServer | undefined;

  beforeAll(async () => {
    // Dynamic import so the env above is applied before server.ts is evaluated.
    const { startServer } = await import('../../server-runtime.js');
    server = await startServer();
  });

  afterAll(async () => {
    await server?.stop();

    // Drop this worker's database so re-runs against a persistent MongoDB
    // (e.g. the devcontainer) start clean. CI uses a fresh MongoDB per run.
    const mongoose = (await import('mongoose')).default;
    try {
      await mongoose.connect(mongoUri);
      await mongoose.connection.dropDatabase();
    } finally {
      await mongoose.disconnect();
    }

    fs.rmSync(repoPath, { recursive: true, force: true });
  });
}
