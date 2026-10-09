import { mockDeep } from 'vitest-mock-extended';

import type { PrismaClient } from '../prisma-client.js';
import { createProcessedNotificationRepository } from './processed-notification-repository.js';

const TARGET_A = {
  relationId: 'relation-1',
  requestId: 'req-1',
  platform: 'slack',
  channelId: 'C0001',
  status: 'posted',
  detail: null,
  processedAt: new Date('2026-01-01T00:00:00.000Z'),
  expiresAt: new Date('2026-01-02T00:00:00.000Z'),
};

const TARGET_B = {
  ...TARGET_A,
  channelId: 'C0002',
  status: 'bot-not-in-channel',
  detail: 'bot is not a member of C0002',
};

describe('processedNotificationRepository.findAllForRequest (Requirement 10.7)', () => {
  it('returns every destination recorded for (relationId, requestId), so a retry can see which already succeeded', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.processedNotificationTarget.findMany.mockResolvedValue([
      TARGET_A,
      TARGET_B,
    ]);
    const repository = createProcessedNotificationRepository(prisma);

    await expect(
      repository.findAllForRequest('relation-1', 'req-1'),
    ).resolves.toEqual([TARGET_A, TARGET_B]);
    expect(prisma.processedNotificationTarget.findMany).toHaveBeenCalledWith({
      where: { relationId: 'relation-1', requestId: 'req-1' },
    });
  });
});

describe('processedNotificationRepository.upsertTarget (Requirement 10.7)', () => {
  it('writes exactly one destination row, by its full composite key', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.processedNotificationTarget.upsert.mockResolvedValue(TARGET_A);
    const repository = createProcessedNotificationRepository(prisma);

    await repository.upsertTarget(TARGET_A);

    expect(prisma.processedNotificationTarget.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          relationId_requestId_platform_channelId: {
            relationId: 'relation-1',
            requestId: 'req-1',
            platform: 'slack',
            channelId: 'C0001',
          },
        },
      }),
    );
  });

  it("retrying one destination does not touch another destination's row (called once per destination)", async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.processedNotificationTarget.upsert.mockResolvedValue(TARGET_B);
    const repository = createProcessedNotificationRepository(prisma);

    await repository.upsertTarget(TARGET_B);

    expect(prisma.processedNotificationTarget.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.processedNotificationTarget.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          relationId_requestId_platform_channelId: {
            relationId: 'relation-1',
            requestId: 'req-1',
            platform: 'slack',
            channelId: 'C0002',
          },
        },
      }),
    );
  });
});

describe('processedNotificationRepository.deleteExpired', () => {
  it('deletes every row past its expiresAt and answers the count removed', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.processedNotificationTarget.deleteMany.mockResolvedValue({
      count: 5,
    });
    const repository = createProcessedNotificationRepository(prisma);
    const now = new Date('2026-02-01T00:00:00.000Z');

    await expect(repository.deleteExpired(now)).resolves.toBe(5);
    expect(prisma.processedNotificationTarget.deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lte: now } },
    });
  });
});

describe('processedNotificationRepository.deleteByRelation', () => {
  it('deletes every recorded destination of the relation, across requests', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.processedNotificationTarget.deleteMany.mockResolvedValue({
      count: 4,
    });
    const repository = createProcessedNotificationRepository(prisma);

    await expect(repository.deleteByRelation('relation-1')).resolves.toBe(4);
    // No `requestId` in the filter: every request's rows go, not one request's.
    expect(prisma.processedNotificationTarget.deleteMany).toHaveBeenCalledWith({
      where: { relationId: 'relation-1' },
    });
  });
});
