import { mockDeep } from 'vitest-mock-extended';

import type { Prisma } from '../../generated/prisma/client.js';
import type { Invocation } from '../../types/index.js';
import type { PrismaClient } from '../prisma-client.js';
import {
  createPendingCollectionRepository,
  type NewPendingCollection,
} from './pending-collection-repository.js';

const INVOCATION: Invocation = {
  platform: 'slack',
  channel: {
    platform: 'slack',
    channelId: 'C0001',
    channelName: 'general',
    isPrivate: false,
  },
  actor: { platform: 'slack', accountId: 'U0001', displayName: 'Alice' },
  commandName: 'create-page',
  argsText: '',
  interaction: null,
};

/** What a caller passes to `create()` -- typed the way the repository's own interface declares it. */
const NEW_COLLECTION: NewPendingCollection = {
  correlationId: 'corr-1',
  relationId: null,
  platform: 'slack',
  channelId: 'C0001',
  actorAccountId: 'U0001',
  commandName: 'create-page',
  invocation: INVOCATION,
  collected: { path: '/Sandbox' },
  offeredOptions: {},
  expiresAt: new Date('2026-01-01T00:10:00.000Z'),
};

/**
 * What `mockResolvedValue` needs: a plain database row, where the JSON
 * columns are Prisma's `JsonValue` rather than the app-level `Invocation`
 * interface -- the same reason `peer-key-repository.spec.ts` casts its JWK
 * fixture before handing it to a Prisma mock.
 */
const dbRow = (overrides: Partial<typeof NEW_COLLECTION> = {}) => {
  const merged = { ...NEW_COLLECTION, ...overrides };
  return {
    ...merged,
    relationId: merged.relationId ?? null,
    invocation: merged.invocation as unknown as Prisma.JsonValue,
    collected: merged.collected as Prisma.JsonValue,
    offeredOptions: merged.offeredOptions as Prisma.JsonValue,
  };
};

describe('pendingCollectionRepository.create', () => {
  it('stores the invocation and initial collected/offeredOptions as JSON', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.pendingCollection.create.mockResolvedValue(dbRow());
    const repository = createPendingCollectionRepository(prisma);

    const created = await repository.create(NEW_COLLECTION);

    expect(created).toEqual(NEW_COLLECTION);
    expect(prisma.pendingCollection.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          correlationId: 'corr-1',
          relationId: null,
          invocation: INVOCATION,
        }),
      }),
    );
  });
});

describe('pendingCollectionRepository.findByCorrelationId', () => {
  it('finds a collection by its correlationId', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.pendingCollection.findUnique.mockResolvedValue(dbRow());
    const repository = createPendingCollectionRepository(prisma);

    await expect(repository.findByCorrelationId('corr-1')).resolves.toEqual(
      NEW_COLLECTION,
    );
  });

  it('answers null for an unknown correlationId', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.pendingCollection.findUnique.mockResolvedValue(null);
    const repository = createPendingCollectionRepository(prisma);

    await expect(
      repository.findByCorrelationId('corr-unknown'),
    ).resolves.toBeNull();
  });
});

describe('pendingCollectionRepository.findInFlight (Requirement 11.5)', () => {
  it('finds the collection in flight for (platform, channelId, actorAccountId)', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.pendingCollection.findFirst.mockResolvedValue(dbRow());
    const repository = createPendingCollectionRepository(prisma);

    await expect(
      repository.findInFlight('slack', 'C0001', 'U0001'),
    ).resolves.toEqual(NEW_COLLECTION);
    expect(prisma.pendingCollection.findFirst).toHaveBeenCalledWith({
      where: { platform: 'slack', channelId: 'C0001', actorAccountId: 'U0001' },
    });
  });
});

describe('pendingCollectionRepository.update', () => {
  it('writes only the fields given, e.g. collected alone', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.pendingCollection.update.mockResolvedValue(dbRow());
    const repository = createPendingCollectionRepository(prisma);

    await repository.update('corr-1', { collected: { path: '/Sandbox/x' } });

    expect(prisma.pendingCollection.update).toHaveBeenCalledWith({
      where: { correlationId: 'corr-1' },
      data: { collected: { path: '/Sandbox/x' } },
    });
  });

  it('writes relationId once the GROWI destination is chosen', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.pendingCollection.update.mockResolvedValue(dbRow());
    const repository = createPendingCollectionRepository(prisma);

    await repository.update('corr-1', { relationId: 'relation-1' });

    expect(prisma.pendingCollection.update).toHaveBeenCalledWith({
      where: { correlationId: 'corr-1' },
      data: { relationId: 'relation-1' },
    });
  });
});

describe('pendingCollectionRepository.remove', () => {
  it('deletes the collection by correlationId', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.pendingCollection.delete.mockResolvedValue(dbRow());
    const repository = createPendingCollectionRepository(prisma);

    await repository.remove('corr-1');

    expect(prisma.pendingCollection.delete).toHaveBeenCalledWith({
      where: { correlationId: 'corr-1' },
    });
  });
});

describe('pendingCollectionRepository.deleteExpired', () => {
  it('deletes every row past its expiresAt and answers the count removed', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.pendingCollection.deleteMany.mockResolvedValue({ count: 2 });
    const repository = createPendingCollectionRepository(prisma);
    const now = new Date('2026-02-01T00:00:00.000Z');

    await expect(repository.deleteExpired(now)).resolves.toBe(2);
    expect(prisma.pendingCollection.deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lte: now } },
    });
  });
});

describe('pendingCollectionRepository.deleteByRelation', () => {
  it('deletes the collections of the relation, addressed by relation_id alone', async () => {
    // Addressed by `relationId` only: a collection still choosing its GROWI
    // has a NULL `relation_id` and is intentionally out of reach here (it
    // blocks nothing and expires on its own).
    const prisma = mockDeep<PrismaClient>();
    prisma.pendingCollection.deleteMany.mockResolvedValue({ count: 1 });
    const repository = createPendingCollectionRepository(prisma);

    await expect(repository.deleteByRelation('relation-1')).resolves.toBe(1);
    expect(prisma.pendingCollection.deleteMany).toHaveBeenCalledWith({
      where: { relationId: 'relation-1' },
    });
  });
});
