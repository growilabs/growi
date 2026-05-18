/**
 * Vitest setupFile entry for the vault E2E project. Registers the
 * `beforeAll`/`afterAll` hooks that provision and tear down the shared
 * vault fixture for every test file in the project.
 *
 * Wired into apps/app/vitest.workspace.mts as a setupFile of the
 * `app-integration-vault` project. NOT loaded by other projects.
 */

import { afterAll, beforeAll } from 'vitest';

import { provisionVaultE2eFixture, teardownVaultE2eFixture } from './provision';

beforeAll(
  async () => {
    await provisionVaultE2eFixture();
  },
  5 * 60 * 1000,
);

afterAll(async () => {
  await teardownVaultE2eFixture();
  // mongo/index.ts stops the memory server here as well, but leaves MONGO_URI
  // pointing at the now-dead port. With singleFork the next test file would
  // try to reuse it as an "external mongo" URI and fail. Clear it so the
  // next file's mongo beforeAll spawns a fresh memory server.
  delete process.env.MONGO_URI;
});
