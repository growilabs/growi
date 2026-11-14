// Removing an installation while a pending agent request still exists, against
// real PostgreSQL: `pending_agent_request` -> `installation` is a Restrict
// foreign key, so the request has to be gone first.
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';

import {
  testSdkChannel,
  testSdkChannelId,
} from '../capabilities/test-channels.js';
import {
  createChannelPermissionRepository,
  createInstallationChannelRepository,
  createInstallationRepository,
  createOwnKeyRepository,
  createPairingOrderRepository,
  createPeerKeyRepository,
  createPendingAgentRequestRepository,
  createPendingCollectionRepository,
  createPrismaClient,
  createProcessedNotificationRepository,
  createRelationRepository,
} from '../db/index.js';
import type { SecretCipher } from '../types/index.js';
import { createInstallationStore } from './installation-store.js';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://chat_integration_proxy:chat_integration_proxy_dev@postgres:5432/chat_integration_proxy';

const testCipher: SecretCipher = {
  encrypt: (plaintext) => `plain:${plaintext}`,
  decrypt: (ciphertext) => ciphertext.replace(/^plain:/, ''),
};

const prisma = createPrismaClient(DATABASE_URL);

afterAll(async () => {
  await prisma.$disconnect();
});

describe('removing an installation that has a pending agent request', () => {
  it('removes the request together with the installation', async () => {
    const installations = createInstallationRepository(prisma, testCipher);
    const installationId = await installations.save(
      'slack',
      `T-${randomUUID()}`,
      'Removable',
      { slack: { botToken: `xoxb-${randomUUID()}` } },
    );
    const relations = createRelationRepository(prisma);
    const relation = await relations.create({
      installationId,
      growiUri: `https://removable-${randomUUID()}.example.com`,
      growiLabel: 'removable',
      searchWeight: 1,
      settingsVersion: 0,
    });
    const pending = createPendingAgentRequestRepository(prisma);
    await pending.create({
      relationId: relation.relationId,
      requestId: 'req-1',
      installationId,
      origin: {
        channel: testSdkChannel('slack', {
          channelId: testSdkChannelId('slack', 'D0001'),
          isDirectMessage: true,
        }),
        actor: { platform: 'slack', accountId: 'U0001', displayName: 'Alice' },
        sourceMessageId: null,
        threadRootId: null,
        replyThreadRootId: null,
        place: 'direct',
        requestSummary: 'summarize the thread',
      },
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    const store = createInstallationStore({
      installations,
      relations,
      ownKeys: createOwnKeyRepository(prisma, testCipher),
      peerKeys: createPeerKeyRepository(prisma),
      channelPermissions: createChannelPermissionRepository(prisma),
      pendingCollections: createPendingCollectionRepository(prisma),
      pendingAgentRequests: pending,
      processedNotifications: createProcessedNotificationRepository(prisma),
      pairingOrders: createPairingOrderRepository(prisma),
      channels: createInstallationChannelRepository(prisma),
      refreshChannels: async () => {},
      onChannelRefreshFailed: () => {},
    });

    await store.remove(installationId);

    await expect(
      pending.find(relation.relationId, 'req-1'),
    ).resolves.toBeNull();
    await expect(
      prisma.installation.findUnique({ where: { id: installationId } }),
    ).resolves.toBeNull();
  });
});
