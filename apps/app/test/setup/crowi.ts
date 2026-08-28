import { Server } from 'node:http';

import Crowi from '~/server/crowi';
import { setupModelsDependentOnCrowi } from '~/server/crowi/setup-models';

let _instance: Crowi | null = null;

/**
 * Initialize a Crowi instance with minimal required services for integration testing.
 * This is the Vitest equivalent of test/integration/setup-crowi.ts
 */
const initCrowi = async (crowi: Crowi): Promise<void> => {
  // Setup models that depend on Crowi instance
  crowi.models = await setupModelsDependentOnCrowi(crowi);

  // Setup config manager
  await crowi.setupConfigManager();

  // Setup Socket.IO service with dummy server
  await crowi.setupSocketIoService();
  await crowi.socketIoService.attachServer(new Server());

  // Setup application
  await crowi.setUpApp();

  // Setup services required for most integration tests
  await Promise.all([
    crowi.setupPassport(),
    crowi.setupAttachmentService(),
    crowi.setUpAcl(),
    crowi.setupPageService(),
    crowi.setupInAppNotificationService(),
    crowi.setupActivityService(),
    crowi.setupUserGroupService(),
  ]);
};

/**
 * Get a Crowi instance for integration testing.
 * Memoizes `_instance` at module scope, but Vitest's `forks` pool resets the
 * module registry per test file under the default `isolate: true` — so in
 * practice this cold-inits on (almost) every file, not once per worker. See
 * `apps/app/vitest.workspace.mts`'s `app-integration` project comment for
 * why this project cannot set `isolate: false` to make it a real per-worker
 * singleton.
 *
 * @returns Promise resolving to a Crowi instance
 */
export async function getInstance(): Promise<Crowi> {
  // Initialize singleton instance
  if (_instance == null) {
    _instance = new Crowi();
    await initCrowi(_instance);
  }
  return _instance;
}

/**
 * Reset the singleton instance.
 * Useful for test isolation when needed.
 */
export function resetInstance(): void {
  _instance = null;
}
