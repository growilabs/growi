// Task 2.1's acceptance criterion, against a real PostgreSQL: 「保存して読み直
// すと同じ値が返り、暗号化した列が保存の上では読めない」.
//
// This cannot be answered by a mocked Prisma client. "The same value comes
// back" is a claim about a real column with a real type, and "the encrypted
// column is unreadable in storage" is a claim about the bytes PostgreSQL
// actually holds -- which is why the assertions below read those two columns
// back with `$queryRaw`, going around the repositories entirely.
//
// The connection string is read from the environment the same way (and for the
// same reason) `src/postgres-connectivity.integ.ts` reads it: `runtime/config.ts`
// is the only file in the *application* allowed to read env vars, and this is a
// test rather than application code. The default mirrors `.env.development`, so
// this runs for a developer who has not sourced that file.
import { generateKeyPairSync, randomUUID, sign, verify } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';

import type { InstallationCredentials, Invocation } from '../../types/index.js';
import { createPrismaClient, type PrismaClient } from '../prisma-client.js';
import { createChannelPermissionRepository } from './channel-permission-repository.js';
import { createInstallationChannelRepository } from './installation-channel-repository.js';
import { createInstallationRepository } from './installation-repository.js';
import { createOwnKeyRepository } from './own-key-repository.js';
import { createPairingOrderRepository } from './pairing-order-repository.js';
import { createPeerKeyRepository } from './peer-key-repository.js';
import { createPendingCollectionRepository } from './pending-collection-repository.js';
import { createProcessedNotificationRepository } from './processed-notification-repository.js';
import { createRelationRepository } from './relation-repository.js';
import { createRequestNonceRepository } from './request-nonce-repository.js';
import { testCipher } from './test-cipher.js';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://chat_integration_proxy:chat_integration_proxy_dev@postgres:5432/chat_integration_proxy';

const BOT_TOKEN = `xoxb-${randomUUID()}`;
const CREDENTIALS: InstallationCredentials = { slack: { botToken: BOT_TOKEN } };

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const PRIVATE_PEM = privateKey
  .export({ type: 'pkcs8', format: 'pem' })
  .toString();
const PUBLIC_JWK = publicKey.export({ format: 'jwk' }) as JsonWebKey;

// A workspace id unique to this run, so repeated runs (and parallel workers)
// never collide on `(platform, workspace_id)`.
const WORKSPACE_ID = `T-${randomUUID()}`;
const VALID_FROM = new Date('2026-01-01T00:00:00.000Z');

/**
 * Connecting and creating the installation every test hangs off, done once and
 * shared. Deliberately NOT a `beforeAll`: a failing `beforeAll` *skips* the
 * test bodies, so while `postgres` is unreachable not one assertion below would
 * ever be parsed and run, and a mistake in one of them would stay hidden until
 * long after this task closed. Called from inside each test instead, the same
 * shape `postgres-connectivity.integ.ts` uses -- every test then fails on its
 * own with the real connection error.
 */
let shared: Promise<{ prisma: PrismaClient; installationId: string }> | null =
  null;

const context = (): Promise<{
  prisma: PrismaClient;
  installationId: string;
}> => {
  shared ??= (async () => {
    const prisma = createPrismaClient(DATABASE_URL);
    const installations = createInstallationRepository(prisma, testCipher);
    const installationId = await installations.save(
      'slack',
      WORKSPACE_ID,
      'Acme',
      CREDENTIALS,
    );
    return { prisma, installationId };
  })();
  return shared;
};

// A single, file-level `afterAll` -- NOT nested inside either `describe`
// block below. `shared` is one module-scoped installation reused by BOTH
// `describe` blocks on purpose (the comment on `context()` above says so), so
// cleanup has to run once, after every test in the file is done, not after
// just the first `describe`'s tests finish. Nesting this inside the first
// `describe` was a real bug, caught only once this file could actually reach
// a live PostgreSQL: Vitest runs a `describe`-scoped `afterAll` as soon as
// that `describe`'s own tests complete, which deleted the shared installation
// (and disconnected its Prisma client) while the second `describe`'s tests
// still expected to use it -- surfacing as a foreign key violation on
// `relation_installation_id_fkey` / `installation_channel_installation_id_fkey`
// for every test in the second block, not a connectivity failure.
afterAll(async () => {
  if (shared == null) return;
  let prisma: PrismaClient;
  let installationId: string;
  try {
    ({ prisma, installationId } = await shared);
  } catch {
    // Never connected, so there is nothing to clean up. Swallowed on purpose:
    // re-reporting it here would bury the failure the tests themselves show.
    return;
  }

  // The explicit order matters: every foreign key onto `relation` here is
  // `Restrict`, so the children have to go first (design.md's unpairing
  // sequence, applied to leave no test rows behind).
  const relations = await prisma.relation.findMany({
    where: { installationId },
    select: { id: true },
  });
  const relationIds = relations.map((relation) => relation.id);
  await prisma.pairingOrder.updateMany({
    where: { installationId },
    data: { relationId: null },
  });
  await prisma.ownKey.deleteMany({
    where: { relationId: { in: relationIds } },
  });
  await prisma.peerKey.deleteMany({
    where: { relationId: { in: relationIds } },
  });
  // task 2.2's tables: also children of `relation` (Restrict), so they have
  // to go before `relation` is deleted, same as the two above.
  await prisma.channelPermission.deleteMany({
    where: { relationId: { in: relationIds } },
  });
  await prisma.pendingCollection.deleteMany({
    where: { relationId: { in: relationIds } },
  });
  await prisma.processedNotificationTarget.deleteMany({
    where: { relationId: { in: relationIds } },
  });
  // `request_nonce` -> `relation` is Cascade (design.md: left to expire
  // naturally), so it does not need an explicit delete here -- kept anyway
  // for a clean test database rather than relying on that cascade.
  await prisma.requestNonce.deleteMany({
    where: { relationId: { in: relationIds } },
  });
  await prisma.relation.deleteMany({ where: { installationId } });
  await prisma.pairingOrder.deleteMany({ where: { installationId } });
  // `installation_channel` is per-installation, not per-relation (design.md:
  // unpairing must not touch it), so it is cleaned up by installationId here.
  await prisma.installationChannel.deleteMany({ where: { installationId } });
  await prisma.installation.deleteMany({ where: { id: installationId } });
  await prisma.$disconnect();
});

describe('storage round trip through real PostgreSQL (Requirements 8.1, 10.5, 10.6)', () => {
  it('reads back the credentials that were saved (Requirement 10.6)', async () => {
    const { prisma } = await context();
    const installations = createInstallationRepository(prisma, testCipher);

    await expect(
      installations.resolveCredentials('slack', WORKSPACE_ID),
    ).resolves.toEqual(CREDENTIALS);
  });

  it('leaves the stored credentials column unreadable (Requirement 10.6)', async () => {
    const { prisma, installationId } = await context();
    const [stored] = await prisma.$queryRaw<
      Array<{ credentials: string }>
    >`SELECT credentials FROM installation WHERE id = ${installationId}::uuid`;

    expect(stored.credentials).not.toBe(JSON.stringify(CREDENTIALS));
    expect(stored.credentials).not.toContain(BOT_TOKEN);
    expect(stored.credentials).not.toContain('botToken');
  });

  it('keeps several GROWI pairings under one workspace apart (Requirement 8.1)', async () => {
    const { prisma, installationId } = await context();
    const relations = createRelationRepository(prisma);

    const first = await relations.create({
      installationId,
      growiUri: `https://first-${WORKSPACE_ID}.example.com`,
      growiLabel: 'First',
      searchWeight: 1,
      settingsVersion: 0,
    });
    const second = await relations.create({
      installationId,
      growiUri: `https://second-${WORKSPACE_ID}.example.com`,
      growiLabel: 'Second',
      searchWeight: 5,
      settingsVersion: 0,
    });

    expect(second.relationId).not.toBe(first.relationId);
    await expect(relations.findById(first.relationId)).resolves.toEqual(first);

    const listed = await relations.listByInstallation(installationId);
    expect(listed.map((relation) => relation.relationId).sort()).toEqual(
      [first.relationId, second.relationId].sort(),
    );

    // The same GROWI cannot be paired twice with the same workspace.
    await expect(
      relations.create({
        installationId,
        growiUri: `https://first-${WORKSPACE_ID}.example.com`,
        growiLabel: 'Duplicate',
        searchWeight: 1,
        settingsVersion: 0,
      }),
    ).rejects.toThrow();
  });

  it('reads back a peer public key, and refuses it once revoked (Requirement 10.5)', async () => {
    const { prisma, installationId } = await context();
    const relations = createRelationRepository(prisma);
    const peerKeys = createPeerKeyRepository(prisma);
    const relation = await relations.create({
      installationId,
      growiUri: `https://peer-${WORKSPACE_ID}.example.com`,
      growiLabel: 'Peer',
      searchWeight: 1,
      settingsVersion: 0,
    });
    const ref = { relationId: relation.relationId, keyId: 'growi-key-1' };

    await peerKeys.register(relation.relationId, {
      keyId: 'growi-key-1',
      publicKeyJwk: PUBLIC_JWK,
      validFrom: VALID_FROM.toISOString(),
    });

    const loaded = await peerKeys.findPublicKey(ref, new Date());
    expect(loaded?.export({ format: 'jwk' })).toEqual(PUBLIC_JWK);

    await peerKeys.revoke(ref, new Date());
    await expect(peerKeys.findPublicKey(ref, new Date())).resolves.toBeNull();
  });

  it('signs with a stored private key that never leaves storage in the clear (Requirement 10.6)', async () => {
    const { prisma, installationId } = await context();
    const relations = createRelationRepository(prisma);
    const ownKeys = createOwnKeyRepository(prisma, testCipher);
    const relation = await relations.create({
      installationId,
      growiUri: `https://own-${WORKSPACE_ID}.example.com`,
      growiLabel: 'Own',
      searchWeight: 1,
      settingsVersion: 0,
    });
    const ref = { relationId: relation.relationId, keyId: 'proxy-key-1' };

    await ownKeys.issue(relation.relationId, {
      keyId: 'proxy-key-1',
      privateKeyPem: PRIVATE_PEM,
      validFrom: VALID_FROM,
      supersededKeyId: null,
    });

    const signer = await ownKeys.loadSigner(ref);
    expect(signer).not.toBeNull();
    if (signer == null) return;
    expect(signer.privateKey.asymmetricKeyType).toBe('ed25519');

    // The key that comes back is the key that was stored: a signature it makes
    // verifies against the public half of the same pair. Comparing PEM strings
    // would not be possible here -- and that is the point of this repository.
    const message = Buffer.from('round trip');
    const signature = sign(null, message, signer.privateKey);
    expect(verify(null, message, publicKey, signature)).toBe(true);

    const [stored] = await prisma.$queryRaw<
      Array<{ private_key_pem: string }>
    >`SELECT private_key_pem FROM own_key WHERE relation_id = ${relation.relationId}::uuid`;
    expect(stored.private_key_pem).not.toContain('BEGIN PRIVATE KEY');
    expect(stored.private_key_pem).not.toContain(PRIVATE_PEM);
  });

  it('keeps a rotation’s two keys valid at once, without key material in the listing (Requirement 10.5)', async () => {
    const { prisma, installationId } = await context();
    const relations = createRelationRepository(prisma);
    const ownKeys = createOwnKeyRepository(prisma, testCipher);
    const relation = await relations.create({
      installationId,
      growiUri: `https://rotate-${WORKSPACE_ID}.example.com`,
      growiLabel: 'Rotate',
      searchWeight: 1,
      settingsVersion: 0,
    });

    await ownKeys.issue(relation.relationId, {
      keyId: 'proxy-key-1',
      privateKeyPem: PRIVATE_PEM,
      validFrom: VALID_FROM,
      supersededKeyId: null,
    });
    await ownKeys.issue(relation.relationId, {
      keyId: 'proxy-key-2',
      privateKeyPem: PRIVATE_PEM,
      validFrom: new Date(),
      supersededKeyId: 'proxy-key-1',
    });

    const keys = await ownKeys.listKeys(relation.relationId);
    expect(keys.map((key) => key.keyId).sort()).toEqual([
      'proxy-key-1',
      'proxy-key-2',
    ]);
    expect(keys.every((key) => key.revokedAt == null)).toBe(true);
    expect(JSON.stringify(keys)).not.toContain('PRIVATE KEY');

    // Both keys are still addressable for signing while the rotation is in
    // flight -- the old one is what the peer can still verify.
    await expect(
      ownKeys.loadSigner({
        relationId: relation.relationId,
        keyId: 'proxy-key-1',
      }),
    ).resolves.not.toBeNull();
  });

  it('reads back a registration code’s record without ever storing the code', async () => {
    const { prisma, installationId } = await context();
    const pairingOrders = createPairingOrderRepository(prisma);
    const codeHash = `hash-${randomUUID()}`;
    const expiresAt = new Date(Date.now() + 600_000);

    const issued = await pairingOrders.issue(
      installationId,
      codeHash,
      expiresAt,
    );

    const found = await pairingOrders.findByCodeHash(codeHash);
    expect(found).toEqual({
      id: issued.id,
      installationId,
      attempts: 0,
      expiresAt,
      consumedAt: null,
      relationId: null,
    });
    expect(await pairingOrders.recordAttempt(issued.id)).toBe(1);
  });

  it('reaps an expired code that was never used, and keeps an expired one that already paired', async () => {
    // Against the real table because the invariant is about a row surviving,
    // not about a `where` clause: `pairing/submit` answers a resubmission from
    // `consumed_at` before it looks at `expires_at`, so reaping a consumed
    // order would answer an already-paired GROWI with `code-expired`.
    const { prisma, installationId } = await context();
    const pairingOrders = createPairingOrderRepository(prisma);
    const relations = createRelationRepository(prisma);
    const relation = await relations.create({
      installationId,
      growiUri: `https://order-sweep-${WORKSPACE_ID}.example.com`,
      growiLabel: 'OrderSweep',
      searchWeight: 1,
      settingsVersion: 0,
    });
    const past = new Date(Date.now() - 1_000);

    const unused = await pairingOrders.issue(
      installationId,
      `hash-${randomUUID()}`,
      past,
    );
    const consumedHash = `hash-${randomUUID()}`;
    const consumed = await pairingOrders.issue(
      installationId,
      consumedHash,
      past,
    );
    await expect(
      pairingOrders.consumeIfUnconsumed(
        consumed.id,
        relation.relationId,
        new Date(),
      ),
    ).resolves.toBe(true);

    const removed = await pairingOrders.deleteExpired(new Date());
    expect(removed).toBeGreaterThanOrEqual(1);

    const survivor = await pairingOrders.findByCodeHash(consumedHash);
    expect(survivor?.id).toBe(consumed.id);
    expect(survivor?.relationId).toBe(relation.relationId);
    // The unused one is gone: nothing can be resubmitted against it.
    const rows = await prisma.pairingOrder.findMany({
      where: { id: unused.id },
    });
    expect(rows).toHaveLength(0);
  });
});

// Task 2.2's five repositories, against the same real PostgreSQL. Reuses
// `context()`'s shared installation (and creates one relation per test that
// needs one) rather than repeating `installations.save()`, for the same
// reason the block above does.
describe('task 2.2 storage round trip through real PostgreSQL (Requirements 2.5, 10.4, 10.7, 11.5)', () => {
  it('marks and reads a channel-inventory refresh, distinguishing it from a channel actually being saved (Requirement 2.5)', async () => {
    const { prisma, installationId } = await context();
    const installations = createInstallationRepository(prisma, testCipher);
    const installationChannels = createInstallationChannelRepository(prisma);
    const channelId = `C-${randomUUID()}`;

    // Before any refresh: no channel row, and channelsSyncedAt starts null
    // from installations.save() above (never overwritten by re-saving).
    await expect(
      installationChannels.find(installationId, channelId),
    ).resolves.toBeNull();
    await expect(installationChannels.existsAny(installationId)).resolves.toBe(
      false,
    );

    const refreshedAt = new Date();
    await installationChannels.upsert({
      installationId,
      platform: 'slack',
      channelId,
      channelName: 'general',
      isPrivate: false,
      refreshedAt,
    });
    await installations.markChannelsSynced(installationId, refreshedAt);

    await expect(
      installationChannels.find(installationId, channelId),
    ).resolves.toEqual({
      installationId,
      platform: 'slack',
      channelId,
      channelName: 'general',
      isPrivate: false,
      refreshedAt,
    });
    await expect(installationChannels.existsAny(installationId)).resolves.toBe(
      true,
    );
    await expect(installations.findById(installationId)).resolves.toEqual(
      expect.objectContaining({ channelsSyncedAt: refreshedAt }),
    );
  });

  it('reads back the permitted channels for one (relation, command), keeping "no row" apart from an empty list', async () => {
    const { prisma, installationId } = await context();
    const relations = createRelationRepository(prisma);
    const channelPermissions = createChannelPermissionRepository(prisma);
    const relation = await relations.create({
      installationId,
      growiUri: `https://perm-${WORKSPACE_ID}.example.com`,
      growiLabel: 'Permissions',
      searchWeight: 1,
      settingsVersion: 0,
    });

    // No row yet: 'no-settings', not an empty restriction.
    await expect(
      channelPermissions.find(relation.relationId, 'search'),
    ).resolves.toBeNull();

    await channelPermissions.upsert(relation.relationId, 'search', [
      'C0001',
      'C0002',
    ]);
    await expect(
      channelPermissions.find(relation.relationId, 'search'),
    ).resolves.toEqual(['C0001', 'C0002']);

    await expect(
      channelPermissions.deleteByRelation(relation.relationId),
    ).resolves.toBe(1);
    await expect(
      channelPermissions.find(relation.relationId, 'search'),
    ).resolves.toBeNull();
  });

  it('reads back a pending collection, finds it as in-flight, updates it, and removes it (Requirement 11.5)', async () => {
    const { prisma } = await context();
    const pendingCollections = createPendingCollectionRepository(prisma);
    const correlationId = `corr-${randomUUID()}`;
    const channelId = `C-${randomUUID()}`;
    const invocation: Invocation = {
      platform: 'slack',
      channel: {
        platform: 'slack',
        channelId,
        channelName: 'general',
        isPrivate: false,
      },
      actor: { platform: 'slack', accountId: 'U0001', displayName: 'Alice' },
      commandName: 'create-page',
      argsText: '',
      interaction: null,
    };

    const created = await pendingCollections.create({
      correlationId,
      relationId: null,
      platform: 'slack',
      channelId,
      actorAccountId: 'U0001',
      commandName: 'create-page',
      invocation,
      collected: {},
      offeredOptions: {},
      expiresAt: new Date(Date.now() + 600_000),
    });
    expect(created.invocation).toEqual(invocation);

    await expect(
      pendingCollections.findInFlight('slack', channelId, 'U0001'),
    ).resolves.toEqual(created);

    await pendingCollections.update(correlationId, {
      collected: { path: '/Sandbox/new-page' },
    });
    const updated = await pendingCollections.findByCorrelationId(correlationId);
    expect(updated?.collected).toEqual({ path: '/Sandbox/new-page' });

    await pendingCollections.remove(correlationId);
    await expect(
      pendingCollections.findByCorrelationId(correlationId),
    ).resolves.toBeNull();
  });

  it('sweeps expired pending collections without touching one that has not expired', async () => {
    const { prisma } = await context();
    const pendingCollections = createPendingCollectionRepository(prisma);
    const expiredId = `corr-${randomUUID()}`;
    const freshId = `corr-${randomUUID()}`;
    const invocationFor = (channelId: string): Invocation => ({
      platform: 'slack',
      channel: {
        platform: 'slack',
        channelId,
        channelName: 'general',
        isPrivate: false,
      },
      actor: { platform: 'slack', accountId: 'U0002', displayName: 'Bob' },
      commandName: 'search',
      argsText: '',
      interaction: null,
    });

    await pendingCollections.create({
      correlationId: expiredId,
      relationId: null,
      platform: 'slack',
      channelId: `C-${randomUUID()}`,
      actorAccountId: 'U0002',
      commandName: 'search',
      invocation: invocationFor(`C-${randomUUID()}`),
      collected: {},
      offeredOptions: {},
      expiresAt: new Date(Date.now() - 1_000),
    });
    await pendingCollections.create({
      correlationId: freshId,
      relationId: null,
      platform: 'slack',
      channelId: `C-${randomUUID()}`,
      actorAccountId: 'U0002',
      commandName: 'search',
      invocation: invocationFor(`C-${randomUUID()}`),
      collected: {},
      offeredOptions: {},
      expiresAt: new Date(Date.now() + 600_000),
    });

    const removed = await pendingCollections.deleteExpired(new Date());
    expect(removed).toBeGreaterThanOrEqual(1);
    await expect(
      pendingCollections.findByCorrelationId(expiredId),
    ).resolves.toBeNull();
    await expect(
      pendingCollections.findByCorrelationId(freshId),
    ).resolves.not.toBeNull();

    await prisma.pendingCollection.deleteMany({
      where: { correlationId: freshId },
    });
  });

  it('retries a notification by destination, leaving an already-posted destination untouched (Requirement 10.7)', async () => {
    const { prisma, installationId } = await context();
    const relations = createRelationRepository(prisma);
    const relation = await relations.create({
      installationId,
      growiUri: `https://notify-${WORKSPACE_ID}.example.com`,
      growiLabel: 'Notify',
      searchWeight: 1,
      settingsVersion: 0,
    });
    const processedNotifications =
      createProcessedNotificationRepository(prisma);
    const requestId = `req-${randomUUID()}`;
    const expiresAt = new Date(Date.now() + 600_000);

    await processedNotifications.upsertTarget({
      relationId: relation.relationId,
      requestId,
      platform: 'slack',
      channelId: 'C0001',
      status: 'posted',
      detail: null,
      processedAt: new Date(),
      expiresAt,
    });
    await processedNotifications.upsertTarget({
      relationId: relation.relationId,
      requestId,
      platform: 'slack',
      channelId: 'C0002',
      status: 'bot-not-in-channel',
      detail: 'bot is not a member of C0002',
      processedAt: new Date(),
      expiresAt,
    });

    const targets = await processedNotifications.findAllForRequest(
      relation.relationId,
      requestId,
    );
    expect(targets.map((target) => target.channelId).sort()).toEqual([
      'C0001',
      'C0002',
    ]);
    expect(targets.find((target) => target.channelId === 'C0001')?.status).toBe(
      'posted',
    );

    // Retrying only the failed destination must not disturb the posted one.
    await processedNotifications.upsertTarget({
      relationId: relation.relationId,
      requestId,
      platform: 'slack',
      channelId: 'C0002',
      status: 'posted',
      detail: null,
      processedAt: new Date(),
      expiresAt,
    });
    const retried = await processedNotifications.findAllForRequest(
      relation.relationId,
      requestId,
    );
    expect(retried.every((target) => target.status === 'posted')).toBe(true);
  });

  it('consumes a nonce exactly once, refusing the same (relation, key, nonce) triple a second time (Requirement 10.4)', async () => {
    const { prisma, installationId } = await context();
    const relations = createRelationRepository(prisma);
    const requestNonces = createRequestNonceRepository(prisma);
    const relation = await relations.create({
      installationId,
      growiUri: `https://nonce-${WORKSPACE_ID}.example.com`,
      growiLabel: 'Nonce',
      searchWeight: 1,
      settingsVersion: 0,
    });
    const ref = { relationId: relation.relationId, keyId: 'growi-key-1' };
    const nonce = randomUUID();
    const expiresAt = new Date(Date.now() + 300_000);

    await expect(
      requestNonces.consumeNonce(ref, nonce, expiresAt),
    ).resolves.toBe(true);
    // The same triple, submitted again (a replay), must be refused -- and
    // must not throw, so a caller can treat this as an ordinary verdict.
    await expect(
      requestNonces.consumeNonce(ref, nonce, expiresAt),
    ).resolves.toBe(false);
  });

  it('sweeps expired request nonces', async () => {
    const { prisma, installationId } = await context();
    const relations = createRelationRepository(prisma);
    const requestNonces = createRequestNonceRepository(prisma);
    const relation = await relations.create({
      installationId,
      growiUri: `https://nonce-sweep-${WORKSPACE_ID}.example.com`,
      growiLabel: 'NonceSweep',
      searchWeight: 1,
      settingsVersion: 0,
    });
    const ref = { relationId: relation.relationId, keyId: 'growi-key-1' };
    const expiredNonce = randomUUID();
    const freshNonce = randomUUID();

    await requestNonces.consumeNonce(
      ref,
      expiredNonce,
      new Date(Date.now() - 1_000),
    );
    await requestNonces.consumeNonce(
      ref,
      freshNonce,
      new Date(Date.now() + 300_000),
    );

    const removed = await requestNonces.deleteExpired(new Date());
    expect(removed).toBeGreaterThanOrEqual(1);
    // The expired nonce is gone, so it can be "seen" again (still refused
    // only while it was live -- this proves the sweep, not replay safety).
    await expect(
      requestNonces.consumeNonce(
        ref,
        expiredNonce,
        new Date(Date.now() + 300_000),
      ),
    ).resolves.toBe(true);
    await expect(
      requestNonces.consumeNonce(
        ref,
        freshNonce,
        new Date(Date.now() + 300_000),
      ),
    ).resolves.toBe(false);
  });
});
