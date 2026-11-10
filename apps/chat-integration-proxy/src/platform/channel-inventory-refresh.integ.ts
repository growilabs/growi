// What a refresh leaves in the saved inventory, read back from real
// PostgreSQL: the inventory is what a notification destination is checked
// against and what GROWI is offered as destinations, so a channel that no
// longer exists must not stay in it -- and a refresh that failed must not
// take anything away.
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';

import { testSdkChannelId } from '../capabilities/test-channels.js';
import {
  createInstallationChannelRepository,
  createInstallationRepository,
  createPrismaClient,
  type PrismaClient,
} from '../db/index.js';
import type { ChannelListing, SecretCipher } from '../types/index.js';
import { refreshChannelInventory } from './channels.js';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://chat_integration_proxy:chat_integration_proxy_dev@postgres:5432/chat_integration_proxy';

const PREFIX = 'plain:';
const testCipher: SecretCipher = {
  encrypt: (plaintext) => `${PREFIX}${plaintext}`,
  decrypt: (ciphertext) => ciphertext.slice(PREFIX.length),
};

const opened: Array<{ prisma: PrismaClient; installationId: string }> = [];

const installationFor = async () => {
  const prisma = createPrismaClient(DATABASE_URL);
  const installationId = await createInstallationRepository(
    prisma,
    testCipher,
  ).save('slack', `T-${randomUUID()}`, 'Refresh', {
    slack: { botToken: `xoxb-${randomUUID()}` },
  });
  opened.push({ prisma, installationId });
  return { prisma, installationId };
};

afterAll(async () => {
  for (const { prisma, installationId } of opened) {
    // biome-ignore lint/performance/noAwaitInLoops: one installation at a time keeps the foreign-key order obvious
    await prisma.installationChannel.deleteMany({ where: { installationId } });
    await prisma.installation.deleteMany({ where: { id: installationId } });
    await prisma.$disconnect();
  }
});

const listingOf = (...ids: string[]): ChannelListing => ({
  channels: ids.map((id) => ({
    platform: 'slack' as const,
    channelId: testSdkChannelId('slack', id),
    channelName: id,
    isPrivate: false,
  })),
});

describe('refreshChannelInventory against real PostgreSQL', () => {
  it('drops a channel the service no longer lists', async () => {
    const { prisma, installationId } = await installationFor();
    const deps = (listing: () => Promise<ChannelListing>) => ({
      listChannels: listing,
      channels: createInstallationChannelRepository(prisma),
      installations: createInstallationRepository(prisma, testCipher),
      now: () => new Date(),
    });

    await refreshChannelInventory(
      deps(async () => listingOf('C-kept', 'C-deleted')),
      installationId,
    );
    await refreshChannelInventory(
      deps(async () => listingOf('C-kept')),
      installationId,
    );

    const read =
      await createInstallationChannelRepository(prisma).listByInstallation(
        installationId,
      );
    expect(read.map((row) => row.channelId)).toEqual([
      testSdkChannelId('slack', 'C-kept'),
    ]);
  });

  it('takes nothing away when the listing fails', async () => {
    const { prisma, installationId } = await installationFor();
    const channels = createInstallationChannelRepository(prisma);
    const installations = createInstallationRepository(prisma, testCipher);
    const now = () => new Date();

    await refreshChannelInventory(
      {
        listChannels: async () => listingOf('C-1'),
        channels,
        installations,
        now,
      },
      installationId,
    );
    await expect(
      refreshChannelInventory(
        {
          listChannels: () => Promise.reject(new Error('Slack is down')),
          channels,
          installations,
          now,
        },
        installationId,
      ),
    ).rejects.toThrow('Slack is down');

    const read = await channels.listByInstallation(installationId);
    expect(read.map((row) => row.channelId)).toEqual([
      testSdkChannelId('slack', 'C-1'),
    ]);
  });
});
