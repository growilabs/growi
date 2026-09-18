// What these tests can and cannot prove: they run against a mocked Prisma
// client, so they prove the *wiring* -- that credentials are encrypted before
// they reach the database and decrypted only on the way back out, and which
// columns an update is allowed to touch. That the same value survives a real
// round trip through a real encrypted column is a different claim, proved by
// `storage-round-trip.integ.ts` against a live PostgreSQL.
//
// The cipher here is the real AES-256-GCM one, not a stub: a stub could not
// tell "the repository encrypted it" apart from "the repository forgot to".
import { mockDeep } from 'vitest-mock-extended';

import type { InstallationCredentials } from '../../types/index.js';
import type { PrismaClient } from '../prisma-client.js';
import { createInstallationRepository } from './installation-repository.js';
import { testCipher } from './test-cipher.js';

const CREDENTIALS: InstallationCredentials = {
  slack: { botToken: 'xoxb-super-secret-token' },
};

const ROW = {
  id: 'installation-1',
  platform: 'slack',
  workspaceId: 'T0001',
  workspaceName: 'Acme',
  credentials: testCipher.encrypt(JSON.stringify(CREDENTIALS)),
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  channelsSyncedAt: new Date('2026-01-02T00:00:00.000Z'),
};

describe('installationRepository.save (Requirement 10.6)', () => {
  it('hands the database ciphertext, never the credentials themselves', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.installation.upsert.mockResolvedValue(ROW);
    const repository = createInstallationRepository(prisma, testCipher);

    await repository.save('slack', 'T0001', 'Acme', CREDENTIALS);

    const written = prisma.installation.upsert.mock.calls[0][0];
    const stored = written.create.credentials as string;
    expect(stored).not.toContain('xoxb-super-secret-token');
    expect(testCipher.decrypt(stored)).toBe(JSON.stringify(CREDENTIALS));
  });

  it('returns the installation id the row was stored under', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.installation.upsert.mockResolvedValue(ROW);
    const repository = createInstallationRepository(prisma, testCipher);

    await expect(
      repository.save('slack', 'T0001', 'Acme', CREDENTIALS),
    ).resolves.toBe('installation-1');
  });

  it('re-saving an installation leaves channelsSyncedAt alone', async () => {
    // Resetting it to NULL would make the whole workspace answer
    // `inventory-not-ready` until the next refresh -- design.md's "紐付けた直後
    // の 10 分間、通知がすべて断られる" failure, reached from the other side.
    const prisma = mockDeep<PrismaClient>();
    prisma.installation.upsert.mockResolvedValue(ROW);
    const repository = createInstallationRepository(prisma, testCipher);

    await repository.save('slack', 'T0001', 'Renamed Acme', CREDENTIALS);

    const written = prisma.installation.upsert.mock.calls[0][0];
    expect(Object.keys(written.update).sort()).toEqual([
      'credentials',
      'workspaceName',
    ]);
  });

  it('matches an existing installation by platform and workspace together', async () => {
    // `workspace_id` alone is not unique across services -- two installations
    // on different platforms may carry the same id.
    const prisma = mockDeep<PrismaClient>();
    prisma.installation.upsert.mockResolvedValue(ROW);
    const repository = createInstallationRepository(prisma, testCipher);

    await repository.save('slack', 'T0001', 'Acme', CREDENTIALS);

    expect(prisma.installation.upsert.mock.calls[0][0].where).toEqual({
      platform_workspaceId: { platform: 'slack', workspaceId: 'T0001' },
    });
  });
});

describe('installationRepository.resolveCredentials (Requirement 10.6)', () => {
  it('decrypts the stored column back into the credentials that were saved', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.installation.findUnique.mockResolvedValue(ROW);
    const repository = createInstallationRepository(prisma, testCipher);

    await expect(
      repository.resolveCredentials('slack', 'T0001'),
    ).resolves.toEqual(CREDENTIALS);
  });

  it('answers null for a workspace this proxy is not installed into', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.installation.findUnique.mockResolvedValue(null);
    const repository = createInstallationRepository(prisma, testCipher);

    await expect(
      repository.resolveCredentials('slack', 'T-unknown'),
    ).resolves.toBeNull();
  });

  it('refuses a row that was altered in the database instead of returning it', async () => {
    // AES-256-GCM authenticates the ciphertext; a tampered row must fail the
    // read rather than be used to act on someone's behalf.
    const prisma = mockDeep<PrismaClient>();
    prisma.installation.findUnique.mockResolvedValue({
      ...ROW,
      credentials: `${ROW.credentials.slice(0, -4)}AAAA`,
    });
    const repository = createInstallationRepository(prisma, testCipher);

    await expect(
      repository.resolveCredentials('slack', 'T0001'),
    ).rejects.toThrow();
  });
});

describe('installationRepository reads that carry no credentials', () => {
  it('findById returns the installation without its credentials column', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.installation.findUnique.mockResolvedValue(ROW);
    const repository = createInstallationRepository(prisma, testCipher);

    const found = await repository.findById('installation-1');

    expect(found).toEqual({
      installationId: 'installation-1',
      platform: 'slack',
      workspaceId: 'T0001',
      workspaceName: 'Acme',
      createdAt: ROW.createdAt,
      channelsSyncedAt: ROW.channelsSyncedAt,
    });
    expect(JSON.stringify(found)).not.toContain('xoxb-super-secret-token');
  });

  it('lists one platform’s installations for the connection that serves them', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.installation.findMany.mockResolvedValue([
      ROW,
      { ...ROW, id: 'installation-2', workspaceId: 'T0002' },
    ]);
    const repository = createInstallationRepository(prisma, testCipher);

    await expect(repository.listByPlatform('slack')).resolves.toEqual([
      { installationId: 'installation-1', workspaceId: 'T0001' },
      { installationId: 'installation-2', workspaceId: 'T0002' },
    ]);
  });
});

describe('installationRepository.markChannelsSynced', () => {
  it('writes the given timestamp to channelsSyncedAt alone', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.installation.update.mockResolvedValue(ROW);
    const repository = createInstallationRepository(prisma, testCipher);
    const syncedAt = new Date('2026-03-01T00:00:00.000Z');

    await repository.markChannelsSynced('installation-1', syncedAt);

    expect(prisma.installation.update).toHaveBeenCalledWith({
      where: { id: 'installation-1' },
      data: { channelsSyncedAt: syncedAt },
    });
  });
});
