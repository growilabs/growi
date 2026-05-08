import { $log } from '@tsed/common';
import { PlatformExpress } from '@tsed/platform-express';
import dotenvFlow from 'dotenv-flow';

import { checkMongoConnection, checkRequiredEnvVars } from './preflight.js';
import { Server } from './server.js';
import { createVaultInstructionWatcher } from './services/vault-instruction-watcher.js';
import { getSchedulerInstance } from './services/vault-maintenance-scheduler-instance.js';
import { init as initRepo } from './services/vault-repo-storage.js';

function hasProcessFlag(flag: string): boolean {
  return process.argv.join('').indexOf(flag) > -1;
}

async function bootstrap() {
  try {
    $log.debug('Start server...');
    const platform = await PlatformExpress.bootstrap(Server);

    await platform.listen();
    $log.debug('Server initialized');

    if (hasProcessFlag('ci')) {
      $log.info('"--ci" flag is detected. Exit process.');
      process.exit();
    }
  } catch (error) {
    $log.error(error);
  }
}

dotenvFlow.config();

// Preflight: validate required env vars before attempting any connection
try {
  checkRequiredEnvVars();
} catch (err) {
  $log.error(`Preflight failed: ${(err as Error).message}`);
  process.exit(1);
}

const mongoUri = process.env.MONGO_URI ?? 'mongodb://localhost:27017/growi';

// Preflight: verify MongoDB connectivity before starting the server
checkMongoConnection(mongoUri)
  .then(async () => {
    $log.info(`MongoDB connected: ${mongoUri}`);
    await initRepo();
    $log.info(`Bare repository ready: ${process.env.VAULT_REPO_PATH}`);
    const watcher = createVaultInstructionWatcher();
    await watcher.start();

    const scheduler = getSchedulerInstance();
    scheduler.start();
    $log.info('Maintenance scheduler started');

    // Graceful shutdown: stop scheduler before exiting.
    const shutdown = (signal: string): void => {
      $log.info(`Received ${signal}; shutting down...`);
      scheduler.stop();
      process.exit(0);
    };
    process.once('SIGTERM', () => shutdown('SIGTERM'));
    process.once('SIGINT', () => shutdown('SIGINT'));

    bootstrap();
  })
  .catch((err: Error) => {
    $log.error(`Startup failed: ${err.message}`);
    process.exit(1);
  });
