// Task 5.4's structural claim, against a real PostgreSQL: **the `relation` row
// and the proxy's own `own_key` row are one unit of work.** Task 5.2 could only
// show the structural half of this (the key service writes through the handle
// it is given); whether a failure part-way through really leaves NO key behind
// is a claim about a database transaction, and only a database can answer it.
//
// The rollback is triggered through the REAL `submit`, not a hand-built
// transaction: a test that opens its own `$transaction` would prove something
// about Prisma, not about the code under test. The seam is the peer-key write,
// made to fail by submitting a `validFrom` that is not a timestamp -- shape
// checking the wire body is the receiving route's job, so a value like that
// travels all the way to the storage call and is refused as it is written.
// That failure lands INSIDE the transaction and AFTER the relation row and the
// proxy's own key have already been written to the database through the
// transaction handle, which is exactly the window that must not leave a
// private key behind.
//
// The connection string is read from the environment the same way (and for the
// same reason) `db/repositories/storage-round-trip.integ.ts` reads it.
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

const growiKeys = generateKeyPairSync('ed25519');

/**
 * A plain reversible stand-in rather than `db/repositories/test-cipher.ts`,
 * which the storage layer keeps to itself (`architecture.spec.ts`'s barrel-only
 * guard). Honest here: what encryption at rest does to the column is
 * `own-key-repository.spec.ts`'s subject against a real AES-256-GCM cipher,
 * while what this file asks is whether the ROW survives a rollback.
 */
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
    // Never called: the challenge itself travels through the injected
    // `SendChallenge`, and this connection is only how the URI gets judged.
    send: async () => ({ status: 200, headers: {}, body: '' }),
  }),
};

/**
 * Connecting and creating the installation, done once and shared.
 * Deliberately NOT a `beforeAll`: a failing `beforeAll` SKIPS the test bodies,
 * so while `postgres` is unreachable not one assertion below would ever run and
 * a mistake in one of them would stay hidden. Called from inside each test
 * instead, so every test fails on its own with the real connection error --
 * the same shape `storage-round-trip.integ.ts` uses.
 */
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

const submissionWith = (validFrom: string): PairingSubmission => ({
  registrationCode: 'replaced-per-test',
  growiUri: GROWI_URI,
  growiLabel: 'Acme GROWI',
  publicKey: {
    keyId: randomUUID(),
    publicKeyJwk: growiKeys.publicKey.export({ format: 'jwk' }) as JsonWebKey,
    validFrom,
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

describe('pairing writes the relation and the proxy key in one transaction (Requirement 9.5)', () => {
  afterAll(async () => {
    if (shared == null) return;
    let prisma: PrismaClient;
    let installationId: string;
    try {
      ({ prisma, installationId } = await shared);
    } catch {
      // Never connected, so there is nothing to clean up. Swallowed on purpose:
      // re-reporting it here would bury the failure the tests themselves show.
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
    await prisma.installation.delete({ where: { id: installationId } });
    await prisma.$disconnect();
  });

  it('leaves no own_key row behind when the pairing transaction rolls back', async () => {
    const { prisma, installationId } = await context();
    const service = createPairingService({
      db: prisma,
      cipher: testCipher,
      uriResolver: alwaysConnects,
    });

    const { code } = await service.issueCode(installationId, ISSUER);

    // Refused where the peer key is written, which is after the relation row
    // and the proxy's own key were written inside the same transaction.
    const submission = {
      ...submissionWith('not-a-timestamp'),
      registrationCode: code,
    };

    // Narrowed to the INTENDED seam. A bare `rejects.toThrow()` would be
    // satisfied by ANY failure -- including one raised BEFORE the own key was
    // written, which would leave the assertion below true for a reason that
    // has nothing to do with a rollback.
    //
    // The shape below is not a guess: an invalid `Date` is refused by Prisma's
    // own argument checking, which needs no connection, so both patterns were
    // measured against this repository's client -- and a VALID `validFrom` was
    // measured not to match them. What a real PostgreSQL adds is the rollback
    // itself, not the wording of this error. Tighten it if a future Prisma
    // carries more; never widen it back to a bare `toThrow()`.
    const failure = await service.submit(submission, answerHonestly).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    if (!(failure instanceof Error)) return;
    expect(failure.message).toMatch(/peerKey\.upsert/);
    expect(failure.message).toMatch(/Invalid value for argument `validFrom`/);

    // Nothing survived the rollback: no relation, and -- the point of this
    // test -- no encrypted private key stranded without the relation that
    // would ever use or delete it.
    const relations = await prisma.relation.findMany({
      where: { installationId },
      select: { id: true },
    });
    expect(relations).toEqual([]);

    const strandedKeys = await prisma.$queryRaw<
      ReadonlyArray<{ readonly count: bigint }>
    >`SELECT count(*) FROM own_key ok
        LEFT JOIN relation r ON r.id = ok.relation_id
       WHERE r.id IS NULL`;
    expect(Number(strandedKeys[0].count)).toBe(0);

    // The order was not consumed either, so the administrator can simply
    // submit the same code again once the cause is fixed.
    const orders = await prisma.pairingOrder.findMany({
      where: { installationId },
      select: { consumedAt: true, relationId: true },
    });
    expect(orders).toEqual([{ consumedAt: null, relationId: null }]);
  });

  it('commits the relation row and the own_key row together on success', async () => {
    const { prisma, installationId } = await context();
    const service = createPairingService({
      db: prisma,
      cipher: testCipher,
      uriResolver: alwaysConnects,
    });

    const { code } = await service.issueCode(installationId, ISSUER);

    const result = await service.submit(
      {
        ...submissionWith(new Date().toISOString()),
        registrationCode: code,
      },
      answerHonestly,
    );

    expect(result.status).toBe('paired');
    if (result.status !== 'paired') return;

    const ownKeys = await prisma.ownKey.findMany({
      where: { relationId: result.relationId },
      select: { keyId: true },
    });
    expect(ownKeys).toEqual([{ keyId: result.publicKey.keyId }]);

    const peerKeys = await prisma.peerKey.findMany({
      where: { relationId: result.relationId },
      select: { keyId: true },
    });
    expect(peerKeys).toHaveLength(1);
  });
});
