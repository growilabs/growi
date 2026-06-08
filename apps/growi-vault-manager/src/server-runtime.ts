import { PlatformExpress } from '@tsed/platform-express';
import mongoose from 'mongoose';

import { checkMongoConnection } from './preflight.js';
import { Server } from './server.js';
import { createVaultInstructionWatcher } from './services/vault-instruction-watcher.js';
import { getSchedulerInstance } from './services/vault-maintenance-scheduler-instance.js';
import { init as initRepo } from './services/vault-repo-storage.js';

/**
 * Handle for a running vault-manager runtime. `stop()` tears everything down
 * in reverse startup order so the process (or a Vitest worker) can exit cleanly.
 */
export interface VaultManagerServer {
  stop(): Promise<void>;
}

/**
 * Boots the full vault-manager runtime in the current process:
 * MongoDB connection, bare repo, instruction watcher, maintenance scheduler,
 * and the Ts.ED HTTP server.
 *
 * All configuration (MONGO_URI, VAULT_REPO_PATH, PORT) is read from the
 * environment — identical to production. The same function backs both the
 * production entrypoint (index.ts) and the in-process integration-test setup,
 * so tests exercise the real boot path without spawning a child process.
 */
export async function startServer(): Promise<VaultManagerServer> {
  const mongoUri = process.env.MONGO_URI ?? 'mongodb://localhost:27017/growi';

  // Connects the global mongoose connection and verifies connectivity.
  await checkMongoConnection(mongoUri);

  // Bare repo path is derived from VAULT_REPO_PATH at first call.
  await initRepo();

  const watcher = createVaultInstructionWatcher();
  await watcher.start();

  const scheduler = getSchedulerInstance();
  scheduler.start();

  // PORT is resolved by server.ts at module load (process.env.PORT || 3001).
  const platform = await PlatformExpress.bootstrap(Server);
  await platform.listen();

  return {
    async stop(): Promise<void> {
      // Reverse order: stop producing work, drain, close HTTP, close DB.
      scheduler.stop();
      await watcher.stop();
      await platform.stop();
      await mongoose.disconnect();
    },
  };
}
