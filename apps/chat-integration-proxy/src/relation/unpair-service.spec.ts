// Task 5.5 (Requirement 9.7). `UnpairService` is thin on purpose -- the
// ordered deletion itself is `db/relation-cascade.ts`, tested there against
// repository mocks. What this file pins down is what only becomes visible once
// the real repositories are in the way:
//
//  1. **The rows that reach PostgreSQL, in order.** The cascade is asserted
//     again here one level lower (Prisma model calls rather than repository
//     calls), because that is where a repository wired to the wrong table
//     would show up. As in task 3.7, the order is read back as ONE sequence
//     rather than as a set of `toHaveBeenCalled()` checks, which pass for
//     every permutation including the ones `Restrict` refuses.
//  2. **No `own_key` row survives**, which is the requirement's whole point.
//  3. **The `relation` row itself goes**, without which the same GROWI can
//     never be paired again: `(installation_id, growi_uri)` is unique, so a
//     second submission would answer `already-paired` forever
//     (design.md 「`relation` の行を消さないと繋ぎ直せない」).
//  4. **`installation_channel` is left alone** -- it is per installation, not
//     per relation.
import { type DeepMockProxy, mockDeep } from 'vitest-mock-extended';

import type { PrismaClient } from '../db/index.js';
import type { SecretCipher } from '../types/index.js';
import { createUnpairService } from './unpair-service.js';

const PREFIX = 'plain:';
const fakeCipher: SecretCipher = {
  encrypt: (plaintext) => `${PREFIX}${plaintext}`,
  decrypt: (ciphertext) => ciphertext.slice(PREFIX.length),
};

const RELATION_ID = '33333333-3333-4333-8333-333333333333';

const relationRow = {
  id: RELATION_ID,
  installationId: '11111111-1111-4111-8111-111111111111',
  growiUri: 'https://growi.example.com',
  growiLabel: 'Acme GROWI',
  searchWeight: 1,
  settingsVersion: 0,
  createdAt: new Date('2026-06-01T00:00:00.000Z'),
};

const unpairablePrisma = (): DeepMockProxy<PrismaClient> => {
  const db = mockDeep<PrismaClient>();
  db.ownKey.deleteMany.mockResolvedValue({ count: 1 });
  db.peerKey.deleteMany.mockResolvedValue({ count: 1 });
  db.channelPermission.deleteMany.mockResolvedValue({ count: 2 });
  db.pendingCollection.deleteMany.mockResolvedValue({ count: 0 });
  db.processedNotificationTarget.deleteMany.mockResolvedValue({ count: 3 });
  db.relation.delete.mockResolvedValue(relationRow);
  return db;
};

/**
 * The tables the unpairing actually wrote to, in the order it wrote them.
 *
 * Built from Vitest's own global invocation counter rather than from a
 * recording `mockImplementation`, so the sequence is observed without
 * restating Prisma's argument and return types in a hand-written stub.
 */
const deletionSequence = (db: DeepMockProxy<PrismaClient>): string[] => {
  // Annotated rather than asserted: each Prisma model mock is its own type, so
  // the annotation is what type-checks the list instead of trusting a cast
  // (`.claude/rules/testing.md`).
  const tables: ReadonlyArray<
    readonly [
      string,
      { readonly mock: { readonly invocationCallOrder: number[] } },
    ]
  > = [
    ['own_key', db.ownKey.deleteMany],
    ['peer_key', db.peerKey.deleteMany],
    ['channel_permission', db.channelPermission.deleteMany],
    ['pending_collection', db.pendingCollection.deleteMany],
    [
      'processed_notification_target',
      db.processedNotificationTarget.deleteMany,
    ],
    ['request_nonce', db.requestNonce.deleteMany],
    ['installation_channel', db.installationChannel.deleteMany],
    ['relation', db.relation.delete],
  ];
  return tables
    .filter(([, fn]) => fn.mock.invocationCallOrder.length > 0)
    .sort(
      ([, a], [, b]) =>
        a.mock.invocationCallOrder[0] - b.mock.invocationCallOrder[0],
    )
    .map(([table]) => table);
};

describe('unpairService.unpair', () => {
  it('deletes the relation children and then the relation row, in the order the foreign keys require', async () => {
    const db = unpairablePrisma();

    await createUnpairService({ db, cipher: fakeCipher }).unpair(RELATION_ID);

    expect(deletionSequence(db)).toEqual([
      'own_key',
      'peer_key',
      'channel_permission',
      'pending_collection',
      'processed_notification_target',
      'relation',
    ]);
  });

  it('leaves no own_key row behind, and removes it before anything that can still fail', async () => {
    const db = unpairablePrisma();

    await createUnpairService({ db, cipher: fakeCipher }).unpair(RELATION_ID);

    expect(db.ownKey.deleteMany).toHaveBeenCalledWith({
      where: { relationId: RELATION_ID },
    });
    expect(deletionSequence(db)[0]).toBe('own_key');
  });

  it('deletes the relation row, so the same GROWI can be paired again', async () => {
    const db = unpairablePrisma();

    await createUnpairService({ db, cipher: fakeCipher }).unpair(RELATION_ID);

    expect(db.relation.delete).toHaveBeenCalledWith({
      where: { id: RELATION_ID },
    });
  });

  it('does not touch installation_channel, which belongs to the installation and not to this relation', async () => {
    // Clearing it would refuse every notification aimed at the workspace's
    // OTHER paired GROWIs until the next inventory refresh (default 10
    // minutes) -- design.md 「`installation_channel` は消さない」.
    const db = unpairablePrisma();

    await createUnpairService({ db, cipher: fakeCipher }).unpair(RELATION_ID);

    expect(deletionSequence(db)).not.toContain('installation_channel');
    expect(db.installationChannel.delete).not.toHaveBeenCalled();
  });

  it('does not delete request_nonce rows explicitly (its foreign key cascades)', async () => {
    const db = unpairablePrisma();

    await createUnpairService({ db, cipher: fakeCipher }).unpair(RELATION_ID);

    expect(deletionSequence(db)).not.toContain('request_nonce');
  });

  it('leaves the relation row in place when a child deletion fails, so the unpairing can be retried', async () => {
    const db = unpairablePrisma();
    db.peerKey.deleteMany.mockRejectedValue(
      new Error('peer_key delete failed'),
    );

    await expect(
      createUnpairService({ db, cipher: fakeCipher }).unpair(RELATION_ID),
    ).rejects.toThrow('peer_key delete failed');

    expect(deletionSequence(db)).toEqual(['own_key', 'peer_key']);
    expect(db.relation.delete).not.toHaveBeenCalled();
  });
});
