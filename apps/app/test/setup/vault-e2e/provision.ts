/**
 * One-shot provisioning of the vault E2E fixture.
 *
 * Sequence:
 *  1. Wait for the shared mongo setup to have a connected mongoose instance.
 *  2. Generate an internal-secret shared between apps/app side and vault-manager.
 *  3. Spawn vault-manager on an ephemeral port using that secret.
 *  4. Seed configs, users, PATs and pages directly via mongoose. The configs
 *     pin the same vault-manager endpoint + secret used to spawn the process.
 *  5. Load apps/app config-manager (reads from the configs collection just
 *     written).
 *  6. Mount the vault gateway router on an Express server on a local port.
 *  7. Run the vault bootstrapper to materialise the namespace tree.
 *  8. Export `VAULT_E2E_*` env vars so the test files see a ready fixture.
 *  9. Return a teardown that closes the Express server and kills vault-manager.
 *
 * Any failure during provisioning surfaces as a failed beforeAll — there is
 * no silent skip. This is by design: if the fixture can't come up, the
 * regression checks below it cannot be trusted.
 */

import crypto from 'node:crypto';
import mongoose from 'mongoose';

import { mountVaultGatewayForTests } from './express-mount';
import { setVaultE2eHandle } from './fixture-handle';
import { seedVaultE2eFixture } from './seed';
import { spawnVaultManager } from './spawn-vault-manager';

let teardown: (() => Promise<void>) | undefined;

async function waitForBootstrapDone(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastState = '';
  while (Date.now() < deadline) {
    // biome-ignore lint: poll-and-back-off pattern
    const doc = await mongoose.connection.db
      .collection('vault_sync_state')
      .findOne({ _id: 'singleton' as unknown as never });
    lastState = (doc?.bootstrapState as string | undefined) ?? '';
    if (lastState === 'done') return;
    if (lastState === 'failed') {
      throw new Error(
        `vault E2E: bootstrap reached state=failed (lastError=${doc?.bootstrapLastError ?? '?'})`,
      );
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(
    `vault E2E: bootstrap did not reach 'done' within ${timeoutMs}ms (last state: ${lastState})`,
  );
}

/**
 * apps/app's bootstrapper signals 'done' once it has WRITTEN all instructions
 * to vault_instructions; vault-manager processes them asynchronously via a
 * change-stream watcher. The clone tests must run only AFTER vault-manager has
 * drained the outbox, otherwise newly-bootstrapped namespaces may not yet
 * appear in compose-view results.
 *
 * We poll the outbox until every instruction has been marked processedAt.
 */
async function waitForInstructionsDrained(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let pending = -1;
  while (Date.now() < deadline) {
    // biome-ignore lint: poll-and-back-off pattern
    pending = await mongoose.connection.db
      .collection('vault_instructions')
      .countDocuments({ processedAt: null });
    if (pending === 0) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(
    `vault E2E: vault-manager did not drain vault_instructions within ${timeoutMs}ms (${pending} still pending)`,
  );
}

export async function provisionVaultE2eFixture(): Promise<void> {
  if (process.env.VAULT_E2E_FIXTURE_READY === '1') return;

  if (mongoose.connection.readyState !== 1) {
    throw new Error(
      'vault E2E provisioning requires an active mongoose connection. ' +
        'Ensure ./test/setup/mongo/index.ts has run before this setup file.',
    );
  }
  const mongoUri = process.env.MONGO_URI;
  if (mongoUri == null || mongoUri === '') {
    throw new Error('MONGO_URI must be exported by the mongo setup');
  }

  // ---------------------------------------------------------------
  // 1. Shared secret between vault-manager process and apps/app side.
  // ---------------------------------------------------------------
  const internalSecret = crypto.randomBytes(32).toString('hex');

  // ---------------------------------------------------------------
  // 2. Spawn vault-manager (chooses its own port).
  // ---------------------------------------------------------------
  const vm = await spawnVaultManager({ mongoUri, internalSecret });

  // ---------------------------------------------------------------
  // 3. Expose the endpoint + secret via env vars BEFORE loadConfigs.
  //    `app:vaultManagerEndpoint` and `app:vaultManagerInternalSecret`
  //    are read with `ConfigSource.env` (no DB fallback) by design —
  //    these are security-sensitive values that must never be stored
  //    in the database.
  // ---------------------------------------------------------------
  process.env.VAULT_MANAGER_ENDPOINT = vm.endpoint;
  process.env.VAULT_MANAGER_INTERNAL_SECRET = internalSecret;

  // ---------------------------------------------------------------
  // 4. Seed users/PATs/pages and the vaultEnabled flag in the DB.
  //    (The endpoint/secret pinned via env above are NOT written to
  //    the DB — seed only records vaultEnabled=true.)
  // ---------------------------------------------------------------
  const seed = await seedVaultE2eFixture(vm.endpoint, internalSecret);

  // ---------------------------------------------------------------
  // 5. apps/app config-manager: load AFTER env vars are set and the
  //    configs collection has been seeded.
  // ---------------------------------------------------------------
  const { configManager } = await import('~/server/service/config-manager');
  await configManager.loadConfigs();

  // ---------------------------------------------------------------
  // 5. Mount the gateway router on a test Express server.
  // ---------------------------------------------------------------
  const mounted = await mountVaultGatewayForTests();

  // ---------------------------------------------------------------
  // 6. Build service handles. Tests import these from fixture-handle.ts
  //    when they need to drive the dispatcher / bootstrapper directly.
  // ---------------------------------------------------------------
  const { vaultNamespaceMapper } = await import(
    '~/features/growi-vault/server/services/vault-namespace-mapper'
  );
  const { createVaultBootstrapper } = await import(
    '~/features/growi-vault/server/services/vault-bootstrapper'
  );
  const { createVaultDispatcher } = await import(
    '~/features/growi-vault/server/services/vault-dispatcher'
  );
  const bootstrapper = createVaultBootstrapper(vaultNamespaceMapper);
  const dispatcher = createVaultDispatcher(vaultNamespaceMapper);

  setVaultE2eHandle({ dispatcher, bootstrapper });

  // ---------------------------------------------------------------
  // 7. Materialise the namespace tree.
  // ---------------------------------------------------------------
  await bootstrapper.start({ triggerSource: 'admin-ui' });
  await waitForBootstrapDone(60_000);
  await waitForInstructionsDrained(30_000);

  // ---------------------------------------------------------------
  // 8. Export everything the tests need.
  // ---------------------------------------------------------------
  process.env.VAULT_E2E_BASE_URL = mounted.baseUrl;
  process.env.VAULT_E2E_ADMIN_PAT = seed.admin.pat;
  process.env.VAULT_E2E_ADMIN_USER_ID = seed.admin.userId;
  process.env.VAULT_E2E_ADMIN_USERNAME = seed.admin.username;
  process.env.VAULT_E2E_MEMBER_PAT = seed.member.pat;
  process.env.VAULT_E2E_MEMBER_USER_ID = seed.member.userId;
  process.env.VAULT_E2E_MEMBER_USERNAME = seed.member.username;
  process.env.VAULT_E2E_FIXTURE_READY = '1';

  teardown = async (): Promise<void> => {
    await mounted.close();
    await vm.kill();
  };
}

export async function teardownVaultE2eFixture(): Promise<void> {
  if (teardown != null) {
    await teardown();
    teardown = undefined;
  }
  delete process.env.VAULT_E2E_FIXTURE_READY;
}
