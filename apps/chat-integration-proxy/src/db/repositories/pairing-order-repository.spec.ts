// The registration code an administrator is handed (design.md's `pairing_order`).
// Only the code's hash is ever stored, so a leaked database row does not hand
// an attacker a code they could submit (Requirement 10.6).
import { mockDeep } from 'vitest-mock-extended';

import type { PrismaClient } from '../prisma-client.js';
import { createPairingOrderRepository } from './pairing-order-repository.js';

const EXPIRES_AT = new Date('2026-06-01T00:10:00.000Z');

const row = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'pairing-order-1',
  installationId: 'installation-1',
  codeHash: 'sha256-of-the-code',
  attempts: 0,
  expiresAt: EXPIRES_AT,
  consumedAt: null,
  relationId: null,
  ...overrides,
});

describe('pairingOrderRepository (Requirement 10.6)', () => {
  it('stores only what it was given to store, and looks up by the same hash', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.pairingOrder.create.mockResolvedValue(row());
    const repository = createPairingOrderRepository(prisma);

    await repository.issue('installation-1', 'sha256-of-the-code', EXPIRES_AT);

    expect(prisma.pairingOrder.create.mock.calls[0][0].data).toEqual({
      installationId: 'installation-1',
      codeHash: 'sha256-of-the-code',
      expiresAt: EXPIRES_AT,
    });
  });

  it('finds an order by the hash of the submitted code', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.pairingOrder.findUnique.mockResolvedValue(row());
    const repository = createPairingOrderRepository(prisma);

    const found = await repository.findByCodeHash('sha256-of-the-code');

    expect(prisma.pairingOrder.findUnique.mock.calls[0][0].where).toEqual({
      codeHash: 'sha256-of-the-code',
    });
    expect(found).toEqual({
      id: 'pairing-order-1',
      installationId: 'installation-1',
      attempts: 0,
      expiresAt: EXPIRES_AT,
      consumedAt: null,
      relationId: null,
    });
  });

  it('answers null for a code that was never issued', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.pairingOrder.findUnique.mockResolvedValue(null);
    const repository = createPairingOrderRepository(prisma);

    await expect(
      repository.findByCodeHash('sha256-of-nothing'),
    ).resolves.toBeNull();
  });

  it('counts a failed attempt in the database, not in the caller', async () => {
    // Two administrators submitting at once must not each read 0 and write 1;
    // the increment has to happen where the row lives.
    const prisma = mockDeep<PrismaClient>();
    prisma.pairingOrder.update.mockResolvedValue(row({ attempts: 3 }));
    const repository = createPairingOrderRepository(prisma);

    await expect(repository.recordAttempt('pairing-order-1')).resolves.toBe(3);
    expect(prisma.pairingOrder.update.mock.calls[0][0].data).toEqual({
      attempts: { increment: 1 },
    });
  });

  it('remembers which relation a consumed code produced, and says it won', async () => {
    // Without this, submitting the same code a second time could not answer
    // with the same `PairingResult` and would create a second relation.
    const prisma = mockDeep<PrismaClient>();
    prisma.pairingOrder.updateMany.mockResolvedValue({ count: 1 });
    const repository = createPairingOrderRepository(prisma);
    const consumedAt = new Date('2026-06-01T00:05:00.000Z');

    await expect(
      repository.consumeIfUnconsumed(
        'pairing-order-1',
        'relation-1',
        consumedAt,
      ),
    ).resolves.toBe(true);

    expect(prisma.pairingOrder.updateMany.mock.calls[0][0]).toEqual({
      // Conditional on purpose: `pairing/submit` carries neither a signature
      // nor a nonce, so two copies of one submission arriving together is
      // ordinary. Only the writer that flips `consumed_at` may go on.
      where: { id: 'pairing-order-1', consumedAt: null },
      data: { relationId: 'relation-1', consumedAt },
    });
  });

  it('says it lost when the order was already consumed', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.pairingOrder.updateMany.mockResolvedValue({ count: 0 });
    const repository = createPairingOrderRepository(prisma);

    await expect(
      repository.consumeIfUnconsumed(
        'pairing-order-1',
        'relation-1',
        new Date(),
      ),
    ).resolves.toBe(false);
  });
});

describe('pairingOrderRepository.countLive', () => {
  it('counts only the orders that are still usable -- unconsumed, unexpired, and with attempts left', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.pairingOrder.count.mockResolvedValue(3);
    const repository = createPairingOrderRepository(prisma);
    const now = new Date('2026-06-01T00:00:00.000Z');

    await expect(repository.countLive('inst-1', now, 5)).resolves.toBe(3);
    expect(prisma.pairingOrder.count).toHaveBeenCalledWith({
      where: {
        installationId: 'inst-1',
        consumedAt: null,
        expiresAt: { gt: now },
        // A code that has spent its attempts answers nothing any more, so
        // counting it would hold a slot nobody can use.
        attempts: { lt: 5 },
      },
    });
  });
});

describe('pairingOrderRepository.deleteByInstallation', () => {
  it('deletes every order of the installation and answers the count removed', async () => {
    // Only the installation-wide removal needs this: unpairing leaves the
    // order as history with its `relation_id` nulled by the foreign key.
    const prisma = mockDeep<PrismaClient>();
    prisma.pairingOrder.deleteMany.mockResolvedValue({ count: 2 });
    const repository = createPairingOrderRepository(prisma);

    await expect(repository.deleteByInstallation('inst-1')).resolves.toBe(2);
    expect(prisma.pairingOrder.deleteMany).toHaveBeenCalledWith({
      where: { installationId: 'inst-1' },
    });
  });
});

describe('pairingOrderRepository.deleteExpired', () => {
  it('reaps only orders that were never consumed', async () => {
    // The discriminating condition. `pairing-service.submit` answers a
    // resubmission from `consumed_at` BEFORE it looks at `expires_at`, so a
    // consumed order still answers the second submission of its code with the
    // same `PairingResult` long after it expired. A plain `expiresAt <= now`
    // filter -- the shape the other three sweeps use -- would delete exactly
    // the rows that guarantee is built on.
    const prisma = mockDeep<PrismaClient>();
    prisma.pairingOrder.deleteMany.mockResolvedValue({ count: 3 });
    const repository = createPairingOrderRepository(prisma);
    const now = new Date('2026-06-01T00:20:00.000Z');

    await expect(repository.deleteExpired(now)).resolves.toBe(3);
    expect(prisma.pairingOrder.deleteMany).toHaveBeenCalledWith({
      where: { consumedAt: null, expiresAt: { lte: now } },
    });
  });
});
