import { $log } from '@tsed/common';
import { PlatformExpress } from '@tsed/platform-express';
import dotenvFlow from 'dotenv-flow';
import mongoose from 'mongoose';

import Server from './server.js';
import { createVaultInstructionWatcher } from './services/vault-instruction-watcher.js';
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

const mongoUri = process.env.MONGO_URI ?? 'mongodb://localhost:27017/growi';
mongoose
  .connect(mongoUri)
  .then(async () => {
    $log.info(`MongoDB connected: ${mongoUri}`);
    await initRepo();
    $log.info(`Bare repository ready: ${process.env.VAULT_REPO_PATH}`);
    const watcher = createVaultInstructionWatcher();
    await watcher.start();
    bootstrap();
  })
  .catch((err) => {
    $log.error(`Startup failed: ${err.message}`);
    process.exit(1);
  });
