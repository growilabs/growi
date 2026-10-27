import { beforeAll } from 'vitest';

import { cloneDatabase, TEMPLATE_DB_NAME } from './mongo/template-db';
import { getTestDbConfig } from './mongo/test-db-config';

// Track if the template DB has been cloned for this file
let cloned = false;

// This hook used to spawn `dev:migrate:up` once per test file (VITEST_WORKER_ID
// -- used by getTestDbConfig() to name each file's database -- is a per-file
// dispatch counter, not a bounded physical-worker id, so it ran once per
// file, not once per worker despite an equivalent guard). #11752: without a
// concurrency cap, Vitest sizes its fork pool off the runner's reported CPU
// count, which can be far higher than what the runner can actually sustain
// running this workload in parallel -- CI logs showed 100+ concurrent
// `dev:migrate:up` invocations, saturating the runner.
//
// The fix (see mongo/template-db.ts and mongo/global-setup.ts): migrations
// run exactly once, against a template database, in global-setup. Every test
// file clones that template into its own database instead of migrating --
// migrate-mongo stays the single source of truth for schema/config/indexes,
// but only runs once per whole test run instead of once per file.
//
// Runs before mongo/index.ts in setupFiles (see vitest.workspace.mts) --
// deliberately, not incidentally: see cloneDatabase's own comment for why
// mongoose must not be connected yet when this runs.
//
// Cloning is expected to be much cheaper than a full migration run, but the
// budget is kept unchanged (20s, not raised) for the same reason the
// pre-fix budget was deliberately not raised: a clone that grows slow
// enough to need more is a real regression worth seeing fail here, not
// something to give more room to quietly pass.
beforeAll(async () => {
  // Skip if already cloned (setupFiles run per test file, but we only need to clone once per file)
  if (cloned) {
    return;
  }

  const { dbName, mongoUri } = getTestDbConfig();

  // Only clone when using external MongoDB (CI environment); MongoMemoryServer
  // (local dev) skips migrations entirely, as before.
  if (mongoUri == null) {
    return;
  }

  // biome-ignore lint/suspicious/noConsole: Allow logging
  console.log(`Cloning template DB into ${dbName}...`);

  await cloneDatabase(mongoUri, TEMPLATE_DB_NAME, dbName);
  cloned = true;
}, 20_000);
