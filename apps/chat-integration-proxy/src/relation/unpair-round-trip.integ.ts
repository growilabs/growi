// Task 5.5's acceptance condition against a real PostgreSQL: 「秘密鍵が残らない
// ことと、**解除後に同じ GROWI を繋ぎ直せる**ことが試験で示される」(Requirement
// 9.7).
//
// The second half is why this file exists. Re-pairability is not a property of
// the code that deletes -- it is a property of the `(installation_id,
// growi_uri)` unique constraint being freed, which only a database can answer.
// A mocked version would stub `relation.findUnique -> null` and then assert
// that `submit` pairs, which tests the stub. So the sequence below is the real
// one: pair, unpair, pair the SAME `growi_uri` again.
//
// The first half (no private key survives) is asserted here too, but against
// what is actually left in `own_key` rather than against which calls were
// made, which is all `unpair-service.spec.ts` can see.
//
// `installation_channel` is seeded before the unpairing and checked after, for
// the one behavior a table-level assertion is the only honest way to show:
// unpairing one GROWI must not blind the workspace's other GROWIs until the
// next inventory refresh (design.md 「`installation_channel` は消さない」).
//
// Connection string, cipher stand-in, and the "no beforeAll" arrangement are
// all the same as `pairing-transaction.integ.ts`, for the reasons stated there.
import { generateKeyPairSync, sign as nodeSign, randomUUID } from 'node:crypto';
import type { ChatAccountRef, PairingSubmission } from '@growi/chat';
import { pairingChallengePayload } from '@growi/chat/server';
import { afterAll, describe, expect, it } from 'vitest';

import {
  createInstallationRepository,
  createPrismaClient,
  type PrismaClient,
} from '../db/index.js';
import type { SecretCipher } from '../types/index.js';
import type { GrowiUriResolver } from './growi-uri-resolver.js';
import { createPairingService } from './pairing-service.js';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://chat_integration_proxy:chat_integration_proxy_dev@postgres:5432/chat_integration_proxy';

const WORKSPACE_ID = `T-${randomUUID()}`;
const GROWI_URI = `https://growi-${randomUUID()}.example.com`;
const CHANNEL_ID = `C-${randomUUID()}`;

const growiKeys = generateKeyPairSync('ed25519');

const PREFIX = 'plain:';
const testCipher: SecretCipher = {
  encrypt: (plaintext) => `${PREFIX}${plaintext}`,
  decrypt: (ciphertext) => ciphertext.slice(PREFIX.length),
};

const ISSUER: ChatAccountRef = {
  platform: 'slack',
  accountId: 'U0123',
  displayName: 'Admin',
};

const alwaysConnects: GrowiUriResolver = {
  connect: async () => ({
    ok: true,
    send: async () => ({ status: 200, headers: {}, body: '' }),
  }),
};

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
      { slack: { botToken: `xoxb-${randomUUID()}` } },
    );
    return { prisma, installationId };
  })();
  return shared;
};

const submissionFor = (registrationCode: string): PairingSubmission => ({
  registrationCode,
  growiUri: GROWI_URI,
  growiLabel: 'Acme GROWI',
  publicKey: {
    keyId: randomUUID(),
    publicKeyJwk: growiKeys.publicKey.export({ format: 'jwk' }) as JsonWebKey,
    validFrom: new Date().toISOString(),
  },
});

const answerHonestly = async (
  _uri: string,
  challenge: { readonly registrationCode: string; readonly challenge: string },
) => ({
  challenge: challenge.challenge,
  challengeSignature: nodeSign(
    null,
    Buffer.from(
      pairingChallengePayload(challenge.registrationCode, challenge.challenge),
      'utf8',
    ),
    growiKeys.privateKey,
  ).toString('base64url'),
});

describe('unpairing frees the GROWI to be paired again and leaves no key behind (Requirement 9.7)', () => {
  afterAll(async () => {
    if (shared == null) return;
    let prisma: PrismaClient;
    let installationId: string;
    try {
      ({ prisma, installationId } = await shared);
    } catch {
      return;
    }
    const relations = await prisma.relation.findMany({
      where: { installationId },
      select: { id: true },
    });
    const relationIds = relations.map((relation) => relation.id);
    await prisma.pairingOrder.deleteMany({ where: { installationId } });
    await prisma.ownKey.deleteMany({
      where: { relationId: { in: relationIds } },
    });
    await prisma.peerKey.deleteMany({
      where: { relationId: { in: relationIds } },
    });
    await prisma.relation.deleteMany({ where: { installationId } });
    await prisma.installationChannel.deleteMany({ where: { installationId } });
    await prisma.installation.delete({ where: { id: installationId } });
    await prisma.$disconnect();
  });

  it('deletes the private key and the relation row, and lets the same GROWI pair again under a new relation id', async () => {
    const { prisma, installationId } = await context();
    const service = createPairingService({
      db: prisma,
      cipher: testCipher,
      uriResolver: alwaysConnects,
    });

    // The inventory this workspace's OTHER GROWIs depend on. Seeded before the
    // unpairing so its survival is observed rather than assumed.
    await prisma.installationChannel.create({
      data: {
        installationId,
        platform: 'slack',
        channelId: CHANNEL_ID,
        channelName: 'general',
        isPrivate: false,
        refreshedAt: new Date(),
      },
    });

    const first = await service.submit(
      submissionFor((await service.issueCode(installationId, ISSUER)).code),
      answerHonestly,
    );
    expect(first.status).toBe('paired');
    if (first.status !== 'paired') return;

    // The pairing really did store a private key -- otherwise "no key survives"
    // below would hold for the uninteresting reason that none was written.
    const keysBefore = await prisma.ownKey.count({
      where: { relationId: first.relationId },
    });
    expect(keysBefore).toBe(1);

    await service.unpair(first.relationId);

    expect(
      await prisma.ownKey.count({ where: { relationId: first.relationId } }),
    ).toBe(0);
    expect(
      await prisma.peerKey.count({ where: { relationId: first.relationId } }),
    ).toBe(0);
    expect(
      await prisma.relation.findUnique({ where: { id: first.relationId } }),
    ).toBeNull();

    // Nothing stranded: no `own_key` row whose relation is gone.
    const strandedKeys = await prisma.$queryRaw<
      ReadonlyArray<{ readonly count: bigint }>
    >`SELECT count(*) FROM own_key ok
        LEFT JOIN relation r ON r.id = ok.relation_id
       WHERE r.id IS NULL`;
    expect(Number(strandedKeys[0].count)).toBe(0);

    // The installation's channel inventory is untouched.
    expect(
      await prisma.installationChannel.count({ where: { installationId } }),
    ).toBe(1);

    // The point of deleting the relation row: `(installation_id, growi_uri)`
    // is unique, so a relation left in place would make this answer
    // `already-paired` forever (Requirement 8.5).
    const second = await service.submit(
      submissionFor((await service.issueCode(installationId, ISSUER)).code),
      answerHonestly,
    );
    expect(second.status).toBe('paired');
    if (second.status !== 'paired') return;
    // A NEW relation, which is what `chat-integration-app` expects a
    // reconnection to produce.
    expect(second.relationId).not.toBe(first.relationId);
  });
});
