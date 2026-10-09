// Mocked-Prisma tests: these prove the wiring -- which composite key each
// function reads/writes by, and that the two reads a "never synced" vs
// "synced, empty" judgement needs stay independent of each other. A real
// round trip through PostgreSQL is `storage-round-trip.integ.ts`'s job.
import { mockDeep } from 'vitest-mock-extended';

import type { PrismaClient } from '../prisma-client.js';
import { createInstallationChannelRepository } from './installation-channel-repository.js';

const CHANNEL = {
  installationId: 'installation-1',
  platform: 'slack',
  channelId: 'C0001',
  channelName: 'general',
  isPrivate: false,
  refreshedAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('installationChannelRepository.upsert', () => {
  it('upserts by the composite (installationId, channelId) key', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.installationChannel.upsert.mockResolvedValue(CHANNEL);
    const repository = createInstallationChannelRepository(prisma);

    await repository.upsert(CHANNEL);

    expect(prisma.installationChannel.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          installationId_channelId: {
            installationId: 'installation-1',
            channelId: 'C0001',
          },
        },
      }),
    );
  });
});

describe('installationChannelRepository.find (Requirement 2.5)', () => {
  it('finds a saved channel by the composite key', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.installationChannel.findUnique.mockResolvedValue(CHANNEL);
    const repository = createInstallationChannelRepository(prisma);

    await expect(repository.find('installation-1', 'C0001')).resolves.toEqual(
      CHANNEL,
    );
  });

  it('answers null for a channel not in the saved inventory', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.installationChannel.findUnique.mockResolvedValue(null);
    const repository = createInstallationChannelRepository(prisma);

    await expect(
      repository.find('installation-1', 'C-unknown'),
    ).resolves.toBeNull();
  });
});

describe('installationChannelRepository.existsAny', () => {
  it('answers true when at least one channel is recorded for the installation', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.installationChannel.findFirst.mockResolvedValue(CHANNEL);
    const repository = createInstallationChannelRepository(prisma);

    await expect(repository.existsAny('installation-1')).resolves.toBe(true);
  });

  it('answers false when no channel is recorded -- callers must combine this with installation.channelsSyncedAt to tell "never synced" apart from "synced, empty"', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.installationChannel.findFirst.mockResolvedValue(null);
    const repository = createInstallationChannelRepository(prisma);

    await expect(repository.existsAny('installation-1')).resolves.toBe(false);
  });
});

describe('installationChannelRepository.deleteByInstallation', () => {
  it('deletes the whole saved inventory of the installation', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.installationChannel.deleteMany.mockResolvedValue({ count: 5 });
    const repository = createInstallationChannelRepository(prisma);

    await expect(repository.deleteByInstallation('inst-1')).resolves.toBe(5);
    expect(prisma.installationChannel.deleteMany).toHaveBeenCalledWith({
      where: { installationId: 'inst-1' },
    });
  });
});

describe('installationChannelRepository.listByInstallation (Requirements 2.2, 11.1)', () => {
  it("reads by installation id, so no other installation's rows are ever fetched", () => {
    // The scoping of the `channels` endpoint rests on this `where`: fetching
    // everything and filtering afterwards would carry every tenant's inventory
    // through the process before answering.
    const prisma = mockDeep<PrismaClient>();
    prisma.installationChannel.findMany.mockResolvedValue([CHANNEL]);
    const repository = createInstallationChannelRepository(prisma);

    void repository.listByInstallation('installation-1');

    expect(prisma.installationChannel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { installationId: 'installation-1' },
      }),
    );
  });

  it('answers the saved rows', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.installationChannel.findMany.mockResolvedValue([CHANNEL]);
    const repository = createInstallationChannelRepository(prisma);

    await expect(
      repository.listByInstallation('installation-1'),
    ).resolves.toEqual([CHANNEL]);
  });

  it('answers an empty list for an installation with nothing saved', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.installationChannel.findMany.mockResolvedValue([]);
    const repository = createInstallationChannelRepository(prisma);

    await expect(
      repository.listByInstallation('installation-2'),
    ).resolves.toEqual([]);
  });
});
