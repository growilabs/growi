import { mockDeep } from 'vitest-mock-extended';

import type { PrismaClient } from '../prisma-client.js';
import { createChannelPermissionRepository } from './channel-permission-repository.js';

describe('channelPermissionRepository.find', () => {
  it('returns the permitted channels for (relationId, commandName)', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.channelPermission.findUnique.mockResolvedValue({
      id: 'perm-1',
      relationId: 'relation-1',
      commandName: 'search',
      channels: ['C0001', 'C0002'],
      allowAll: false,
    });
    const repository = createChannelPermissionRepository(prisma);

    await expect(repository.find('relation-1', 'search')).resolves.toEqual([
      'C0001',
      'C0002',
    ]);
  });

  it('distinguishes "no row" (no-settings) from an explicit empty restriction', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.channelPermission.findUnique.mockResolvedValue(null);
    const repository = createChannelPermissionRepository(prisma);

    await expect(repository.find('relation-1', 'search')).resolves.toBeNull();
  });
});

describe('channelPermissionRepository.upsert', () => {
  it('upserts by the (relationId, commandName) unique key', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.channelPermission.upsert.mockResolvedValue({
      id: 'perm-1',
      relationId: 'relation-1',
      commandName: 'search',
      channels: ['C0001'],
      allowAll: false,
    });
    const repository = createChannelPermissionRepository(prisma);

    await repository.upsert('relation-1', 'search', ['C0001']);

    expect(prisma.channelPermission.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          relationId_commandName: {
            relationId: 'relation-1',
            commandName: 'search',
          },
        },
      }),
    );
  });
});

describe('channelPermissionRepository.deleteByRelation (unpairing)', () => {
  it('deletes every row for the relation and answers the count removed', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.channelPermission.deleteMany.mockResolvedValue({ count: 3 });
    const repository = createChannelPermissionRepository(prisma);

    await expect(repository.deleteByRelation('relation-1')).resolves.toBe(3);
    expect(prisma.channelPermission.deleteMany).toHaveBeenCalledWith({
      where: { relationId: 'relation-1' },
    });
  });
});

describe("channelPermissionRepository and RelationSettings' 'all'", () => {
  // `RelationSettings.allowedChannels` has a third value beside a list and
  // `'none'`: `'all'`. `channels` alone cannot carry it -- an empty list
  // already reads as "no channel permitted", the exact opposite -- and
  // dropping the row instead reads as `'no-settings'`, which `judge()` turns
  // into a denial for write commands. So it travels in its own column.
  it("reads back 'all' rather than a list of channel ids", async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.channelPermission.findUnique.mockResolvedValue({
      id: 'perm-1',
      relationId: 'relation-1',
      commandName: 'create-page',
      channels: [],
      allowAll: true,
    });
    const repository = createChannelPermissionRepository(prisma);

    await expect(repository.find('relation-1', 'create-page')).resolves.toBe(
      'all',
    );
  });

  it("stores 'all' as the flag, never as a list", async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.channelPermission.upsert.mockResolvedValue({
      id: 'perm-1',
      relationId: 'relation-1',
      commandName: 'create-page',
      channels: [],
      allowAll: true,
    });
    const repository = createChannelPermissionRepository(prisma);

    await repository.upsert('relation-1', 'create-page', 'all');

    expect(prisma.channelPermission.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ allowAll: true, channels: [] }),
        update: expect.objectContaining({ allowAll: true, channels: [] }),
      }),
    );
  });

  it('stores an explicit list with the flag cleared', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.channelPermission.upsert.mockResolvedValue({
      id: 'perm-1',
      relationId: 'relation-1',
      commandName: 'search',
      channels: ['C1'],
      allowAll: false,
    });
    const repository = createChannelPermissionRepository(prisma);

    await repository.upsert('relation-1', 'search', ['C1']);

    expect(prisma.channelPermission.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ allowAll: false, channels: ['C1'] }),
        update: expect.objectContaining({ allowAll: false, channels: ['C1'] }),
      }),
    );
  });
});
