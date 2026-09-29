import mongoose from 'mongoose';

import loggerFactory from '~/utils/logger';

import { runPasswordHashCleanup } from '../service/password-hash-cleanup';
import {
  exitAfterLogFlush,
  isEntryPoint,
  withMongoConnection,
} from './script-runner';

const logger = loggerFactory('growi:scripts:password-hash-cleanup');

/**
 * CLI entry point for the password-hash cleanup.
 *
 * The operation itself lives in `service/password-hash-cleanup` because it has two
 * entry points: this script (for an operator with container shell access) and the
 * admin API (for a GROWI administrator who has no shell). Keep this file limited to
 * the CLI concerns — connecting, translating the result into an exit code, and
 * draining the logger before exiting.
 *
 * Run manually by an admin:
 *   - development: `pnpm run password-hash:cleanup:dev`
 *   - production (Docker, built output): `pnpm run password-hash:cleanup`
 *     Always go through the npm script: it sets NODE_ENV=production and preloads
 *     `bin/runtime/env-preload.mjs` before `dist/server/scripts/…`.
 */

// ─── Thin CLI wrapper (only runs when executed as the entry point) ───────────

async function main(): Promise<void> {
  await withMongoConnection(async () => {
    const result = await runPasswordHashCleanup(
      mongoose.connection.collection('users'),
    );
    process.exitCode = result.aborted ? 1 : 0;
  });
}

if (isEntryPoint(import.meta.url)) {
  main()
    .catch((err) => {
      logger.error({ err }, 'password-hash cleanup script failed');
      process.exitCode = 1;
    })
    // This script drains the event loop on its own (no Crowi bootstrap), but a
    // natural exit races pino's transport worker: the abort / completion lines —
    // the ONLY report an admin gets — were being dropped. Exit through the
    // flush helper so the outcome is always printed. Entry-point branch ONLY.
    .finally(() => {
      exitAfterLogFlush(
        logger,
        process.exitCode == null ? 0 : Number(process.exitCode),
      );
    });
}
