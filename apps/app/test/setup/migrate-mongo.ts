import { execSync } from 'node:child_process';
import { beforeAll } from 'vitest';

import { getTestDbConfig } from './mongo/test-db-config';

// Track if migrations have been run for this worker
let migrationsRun = false;

/**
 * Run database migrations using external process.
 * This uses the existing dev:migrate:up script (migrate-mongo via plain node +
 * umzug via Node's native TS runner — Node 24 strip-only type stripping (no
 * --experimental-transform-types) + the resolve-only hook in
 * bin/runtime/dev-esm-resolver.mjs, no tsx).
 */
function runMigrations(mongoUri: string): void {
  // Run migrations using the existing script with custom MONGO_URI
  execSync('pnpm run dev:migrate:up', {
    cwd: process.cwd(),
    env: {
      ...process.env,
      MONGO_URI: mongoUri,
    },
    stdio: 'inherit',
  });
}

// This hook spawns `dev:migrate:up`, which runs every migration through the dev
// TS runner once per test file (VITEST_WORKER_ID — used by getTestDbConfig() to
// name each file's database — is a per-file dispatch counter, not a bounded
// physical-worker id, so this genuinely runs once per file, not once per
// worker despite the `migrationsRun` guard below).
//
// #11752: without a concurrency cap, Vitest sizes its fork pool off the
// runner's reported CPU count, which can be far higher than what the runner
// can actually sustain running this workload in parallel — CI logs showed
// 100+ concurrent `dev:migrate:up` invocations, saturating the runner and
// blowing this hook's budget almost every run. `test:integ`'s
// `--poolOptions.forks.maxForks=4` flag is the actual fix (matches
// GitHub-hosted `ubuntu-latest` runners' advertised 4 vCPUs) and cut local
// reproduction of this failure from ~80% of files to roughly 1%.
//
// 30s (was 20s) is a modest margin layered on top of that fix, not a
// substitute for it: even 4 truly-concurrent `dev:migrate:up` chains (each a
// nested pnpm -> node -> migrate-mongo -> umzug spawn) can occasionally still
// exceed 20s under host contention outside the pool's control (a busy CI
// runner, a slow migration added later). If this still times out with the
// pool capped, that is a real regression to investigate, not a signal to
// raise the number further.
beforeAll(() => {
  // Skip if already run (setupFiles run per test file, but we only need to migrate once per worker)
  if (migrationsRun) {
    return;
  }

  const { dbName, mongoUri } = getTestDbConfig();

  // Only run migrations when using external MongoDB (CI environment)
  if (mongoUri == null) {
    return;
  }

  // biome-ignore lint/suspicious/noConsole: Allow logging
  console.log(`Running migrations for ${dbName}...`);

  runMigrations(mongoUri);
  migrationsRun = true;
}, 30_000);
