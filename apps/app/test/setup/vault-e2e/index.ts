/**
 * vitest setupFile entry for the vault E2E project.
 *
 * Provisions the fixture once per test run (afterAll tears it down). The
 * vitest workspace wires this in for the `app-integration-vault` project
 * only; other projects don't pay the provisioning cost.
 *
 * The provisioning sequence:
 *  1. Wait for the shared mongo setup to leave us with an active mongoose
 *     connection.
 *  2. Generate an internal secret shared between vault-manager and apps/app.
 *  3. Spawn vault-manager on an ephemeral port using that secret.
 *  4. Expose the endpoint+secret via env vars BEFORE configManager.loadConfigs
 *     runs — these two configs are read with ConfigSource.env (no DB fallback)
 *     by design, since they are security-sensitive.
 *  5. Seed users/PATs/pages and the vaultEnabled flag in the DB via mongoose.
 *  6. Load apps/app's configManager so the gateway sees the seeded vaultEnabled
 *     and the env-pinned endpoint/secret.
 *  7. Mount the vault gateway router on a local Express server (ephemeral port).
 *  8. Run the bootstrapper and wait for vault-manager to drain the outbox so
 *     the namespace tree is materialised before tests run.
 *  9. Set `VAULT_E2E_*` env vars consumed by fixture-contract.ts.
 * 10. afterAll: kill vault-manager, close Express, clear MONGO_URI so the next
 *     test file in the singleFork pool gets a fresh memory-server.
 *
 * Any failure during provisioning fails the beforeAll — there is no silent
 * skip. If the fixture can't come up, the contracts below it cannot be trusted.
 */

import crypto from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import mongoose from 'mongoose';
import { afterAll, beforeAll } from 'vitest';

import { createVaultGatewayRouter } from '~/features/growi-vault/server/routes/vault-gateway';
import type { VaultBootstrapper } from '~/features/growi-vault/server/services/vault-bootstrapper';
import type { VaultDispatcher } from '~/features/growi-vault/server/services/vault-dispatcher';

import { getTestDbConfig } from '../mongo/utils';
import { seedVaultE2eFixture } from './seed';
import { spawnVaultManager } from './spawn-vault-manager';

// ---------------------------------------------------------------------------
// Service handles — tests that need to drive the dispatcher / bootstrapper
// directly (coalesce, null-revision regression) import these via the barrel.
// ---------------------------------------------------------------------------

export interface VaultE2eHandle {
  readonly dispatcher: VaultDispatcher;
  readonly bootstrapper: VaultBootstrapper;
}

let handle: VaultE2eHandle | undefined;

export function getVaultE2eHandle(): VaultE2eHandle {
  if (handle == null) {
    throw new Error(
      'vault E2E handle not initialised. The vault E2E provisioning must run before this is called.',
    );
  }
  return handle;
}

// ---------------------------------------------------------------------------
// Wait helpers
// ---------------------------------------------------------------------------

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
 * The apps/app bootstrapper signals 'done' once it has WRITTEN all
 * instructions to vault_instructions; vault-manager processes them
 * asynchronously via a change-stream watcher. Tests must run AFTER
 * vault-manager drains the outbox, otherwise newly-bootstrapped namespaces
 * may not yet appear in compose-view results.
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

// ---------------------------------------------------------------------------
// Provisioning
// ---------------------------------------------------------------------------

let teardown: (() => Promise<void>) | undefined;

async function provisionVaultE2eFixture(): Promise<void> {
  if (process.env.VAULT_E2E_FIXTURE_READY === '1') return;

  if (mongoose.connection.readyState !== 1) {
    throw new Error(
      'vault E2E provisioning requires an active mongoose connection. ' +
        'Ensure ./test/setup/mongo/index.ts has run before this setup file.',
    );
  }
  // Re-derive the worker-suffixed URI from getTestDbConfig() so vault-manager
  // opens its change stream on the same per-worker DB mongoose is connected
  // to (growi_test_<workerId>), without mutating process.env.MONGO_URI to
  // do it. getTestDbConfig() returns null only when no MONGO_URI is set at
  // all — the MongoMemoryServer branch in mongo/index.ts sets MONGO_URI on
  // its uri, so this is null only if the mongo setup did not run.
  const { mongoUri } = getTestDbConfig();
  if (mongoUri == null || mongoUri === '') {
    throw new Error('MONGO_URI must be exported by the mongo setup');
  }

  // Drop the DB before anything connects so vault-manager opens its change
  // stream on a clean collection set. When CI uses a shared external MongoDB,
  // residual `pages` / `vault_instructions` / `vault_sync_state` documents
  // from prior runs cause the bootstrapper to emit one instruction per stale
  // page, blowing past the drain timeout. The vault E2E project doesn't run
  // migrate-mongo, so a full drop is safe.
  await mongoose.connection.dropDatabase();

  const internalSecret = crypto.randomBytes(32).toString('hex');
  const vm = await spawnVaultManager({ mongoUri, internalSecret });

  // `app:vaultManagerEndpoint` / `app:vaultManagerInternalSecret` are read
  // with ConfigSource.env (no DB fallback) — security-sensitive values that
  // must never be stored in the database. Pin them in env BEFORE loadConfigs.
  process.env.VAULT_MANAGER_ENDPOINT = vm.endpoint;
  process.env.VAULT_MANAGER_INTERNAL_SECRET = internalSecret;

  const seed = await seedVaultE2eFixture(vm.endpoint, internalSecret);

  const { configManager } = await import('~/server/service/config-manager');
  await configManager.loadConfigs();

  // Mount the gateway router on an ephemeral local port.
  const app = express();
  app.use('/_vault/repo.git', createVaultGatewayRouter({}));
  const server: Server = await new Promise((resolve, reject) => {
    const s = createServer(app);
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  // Build service handles before bootstrap so tests can read them safely.
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
  handle = { dispatcher, bootstrapper };

  await bootstrapper.start({ triggerSource: 'admin-ui' });
  await waitForBootstrapDone(60_000);
  await waitForInstructionsDrained(30_000);

  process.env.VAULT_E2E_BASE_URL = baseUrl;
  process.env.VAULT_E2E_ADMIN_PAT = seed.admin.pat;
  process.env.VAULT_E2E_ADMIN_USER_ID = seed.admin.userId;
  process.env.VAULT_E2E_ADMIN_USERNAME = seed.admin.username;
  process.env.VAULT_E2E_MEMBER_PAT = seed.member.pat;
  process.env.VAULT_E2E_MEMBER_USER_ID = seed.member.userId;
  process.env.VAULT_E2E_MEMBER_USERNAME = seed.member.username;
  process.env.VAULT_E2E_FIXTURE_READY = '1';

  teardown = async (): Promise<void> => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    await vm.kill();
  };
}

// ---------------------------------------------------------------------------
// vitest hooks
// ---------------------------------------------------------------------------

beforeAll(
  async () => {
    await provisionVaultE2eFixture();
  },
  5 * 60 * 1000,
);

afterAll(async () => {
  if (teardown != null) {
    await teardown();
    teardown = undefined;
  }
  handle = undefined;
  delete process.env.VAULT_E2E_FIXTURE_READY;
  // mongo/index.ts stops its memory server here too, but leaves MONGO_URI set.
  // With singleFork the next file would reuse it as an "external mongo" URI
  // and fail; clear it so the next file spawns a fresh memory server.
  delete process.env.MONGO_URI;
});
