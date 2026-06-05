import { $log } from '@tsed/common';
import dotenvFlow from 'dotenv-flow';

import { checkRequiredEnvVars } from './preflight.js';
import { startServer } from './server-runtime.js';

function hasProcessFlag(flag: string): boolean {
  return process.argv.join('').indexOf(flag) > -1;
}

dotenvFlow.config();

// Preflight: validate required env vars before attempting any connection
try {
  checkRequiredEnvVars();
} catch (err) {
  $log.error(`Preflight failed: ${(err as Error).message}`);
  process.exit(1);
}

startServer()
  .then((server) => {
    $log.info('vault-manager started');

    if (hasProcessFlag('ci')) {
      $log.info('"--ci" flag is detected. Exit process.');
      process.exit();
    }

    // Graceful shutdown: tear down the runtime before exiting.
    const shutdown = (signal: string): void => {
      $log.info(`Received ${signal}; shutting down...`);
      server
        .stop()
        .catch((err: unknown) => {
          $log.error(err);
        })
        .finally(() => process.exit(0));
    };
    process.once('SIGTERM', () => shutdown('SIGTERM'));
    process.once('SIGINT', () => shutdown('SIGINT'));
  })
  .catch((err: Error) => {
    $log.error(`Startup failed: ${err.message}`);
    process.exit(1);
  });
