// The one endpoint on this proxy that carries no signature (design.md's
// 「GROWI から届く口」 table, the 「（署名なし）」 row; Requirements 9.1, 9.2,
// 9.5).
//
// Constructed the way `notification-routes.spec.ts` and `key-routes.spec.ts`
// are: a real Hono app and the REAL `createPairingService` (task 5.4), with
// only PostgreSQL and the network doubled. A doubled `PairingService` would
// mean the test wrote the "answer the second submission with the first one's
// result" behaviour itself, and would show nothing.
//
// What is asserted here is the HTTP edge, not task 5.4's logic:
//
//  - a body of the wrong shape, and a body that is not JSON at all, are
//    refused cleanly -- **with no signature check anywhere in the picture,
//    because there is none to reach**;
//  - the challenge really does leave for the declared GROWI, on the path
//    GROWI serves it on;
//  - the same submission sent twice answers identically and mints no second
//    relation;
//  - a refused URI answers `ownership-unverified` and the reason the
//    judgement gave (`private-address`, `dns-failure`, ...) never reaches the
//    wire.

import {
  createPublicKey,
  generateKeyPairSync,
  sign as nodeSign,
} from 'node:crypto';
import type { OwnershipChallenge, PairingSubmission } from '@growi/chat';
import { parseOwnershipChallenge } from '@growi/chat';
import { pairingChallengePayload } from '@growi/chat/server';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { type DeepMockProxy, mockDeep } from 'vitest-mock-extended';

import type { PrismaClient } from '../db/index.js';
import type { GrowiHttpResponse, GrowiUriResolver } from '../relation/index.js';
import { createPairingService } from '../relation/index.js';
import type { SecretCipher } from '../types/index.js';
import {
  PAIRING_SUBMIT_PATH,
  registerPairingRoutes,
} from './pairing-routes.js';
import { INBOUND_OP_BY_PATH } from './signature-guard.js';

const NOW = new Date('2026-06-01T00:00:00.000Z');
const INSTALLATION_ID = '11111111-1111-4111-8111-111111111111';
const ORDER_ID = '22222222-2222-4222-8222-222222222222';
const RELATION_ID = '33333333-3333-4333-8333-333333333333';
const GROWI_URI = 'https://growi.example.com';
const CODE = 'registration-code-under-test';
const CONTENT_TYPE = 'application/json';

const PREFIX = 'plain:';
const fakeCipher: SecretCipher = {
  encrypt: (plaintext) => `${PREFIX}${plaintext}`,
  decrypt: (ciphertext) => ciphertext.slice(PREFIX.length),
};

// A real Ed25519 keypair for the GROWI side: the ownership proof this
// endpoint accepts is a signature the implementation actually verifies.
const growiKeys = generateKeyPairSync('ed25519');
const GROWI_PUBLIC_JWK = growiKeys.publicKey.export({
  format: 'jwk',
}) as JsonWebKey;

const submission: PairingSubmission = {
  registrationCode: CODE,
  growiUri: GROWI_URI,
  growiLabel: 'Acme GROWI',
  publicKey: {
    keyId: '44444444-4444-4444-8444-444444444444',
    publicKeyJwk: GROWI_PUBLIC_JWK,
    validFrom: '2026-01-01T00:00:00.000Z',
  },
};

/** What an honest GROWI answers at pairing step 5. */
const honestAnswer = (challenge: OwnershipChallenge) => ({
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

// ---------------------------------------------------------------------------
// Storage double
// ---------------------------------------------------------------------------

interface OrderRow {
  id: string;
  installationId: string;
  codeHash: string;
  attempts: number;
  expiresAt: Date;
  consumedAt: Date | null;
  relationId: string | null;
}

interface RelationRow {
  id: string;
  installationId: string;
  growiUri: string;
  growiLabel: string;
  searchWeight: number;
  settingsVersion: number;
  createdAt: Date;
}

interface OwnKeyRow {
  id: string;
  relationId: string;
  keyId: string;
  privateKeyPem: string;
  validFrom: Date;
  revokedAt: Date | null;
  supersededKeyId: string | null;
  deliveredToPeerAt: Date | null;
}

/**
 * `pairing_order`, `relation`, `own_key` and `peer_key` held in memory, so
 * that "a second submission mints no second relation" is a property of the
 * code under test rather than of a canned answer. Only the calls this
 * endpoint's path actually makes are implemented; anything else left
 * auto-stubbed by `mockDeep` would be a call this flow is not supposed to
 * make.
 */
const createStorage = (): {
  readonly prisma: DeepMockProxy<PrismaClient>;
  readonly relations: () => ReadonlyArray<RelationRow>;
} => {
  const prisma = mockDeep<PrismaClient>();

  const orders: OrderRow[] = [
    {
      id: ORDER_ID,
      installationId: INSTALLATION_ID,
      // `PairingService` hashes the code before looking it up, so the double
      // answers any lookup with this one order rather than re-deriving the
      // hash here (which would be a copy of the implementation).
      codeHash: 'whatever-the-service-hashed-it-to',
      attempts: 0,
      expiresAt: new Date(NOW.getTime() + 60_000),
      consumedAt: null,
      relationId: null,
    },
  ];
  let relations: RelationRow[] = [];
  let ownKeys: OwnKeyRow[] = [];
  const peerKeys: Array<Record<string, unknown>> = [];

  prisma.$transaction.mockImplementation(
    (arg: unknown) =>
      (arg as (tx: PrismaClient) => Promise<unknown>)(prisma) as never,
  );

  prisma.pairingOrder.findUnique.mockImplementation((() =>
    Promise.resolve(orders[0])) as never);

  prisma.pairingOrder.update.mockImplementation(((args: {
    where: { id: string };
  }) => {
    const order = orders.find((row) => row.id === args.where.id);
    if (order == null) {
      return Promise.reject(new Error('no such pairing_order row'));
    }
    order.attempts += 1;
    return Promise.resolve({ ...order });
  }) as never);

  prisma.pairingOrder.updateMany.mockImplementation(((args: {
    where: { id: string; consumedAt: null };
    data: { relationId: string; consumedAt: Date };
  }) => {
    const order = orders.find(
      (row) => row.id === args.where.id && row.consumedAt == null,
    );
    if (order == null) {
      return Promise.resolve({ count: 0 });
    }
    order.consumedAt = args.data.consumedAt;
    order.relationId = args.data.relationId;
    return Promise.resolve({ count: 1 });
  }) as never);

  prisma.relation.findUnique.mockImplementation(((args: {
    where: {
      id?: string;
      installationId_growiUri?: { installationId: string; growiUri: string };
    };
  }) => {
    const { id, installationId_growiUri: byUri } = args.where;
    const found =
      id != null
        ? relations.find((row) => row.id === id)
        : relations.find(
            (row) =>
              row.installationId === byUri?.installationId &&
              row.growiUri === byUri?.growiUri,
          );
    return Promise.resolve(found ?? null);
  }) as never);

  prisma.relation.create.mockImplementation(((args: {
    data: Omit<RelationRow, 'id' | 'createdAt'>;
  }) => {
    const created: RelationRow = {
      id: RELATION_ID,
      createdAt: NOW,
      ...args.data,
    };
    relations = [...relations, created];
    return Promise.resolve(created);
  }) as never);

  prisma.installation.findUnique.mockImplementation((() =>
    Promise.resolve({
      id: INSTALLATION_ID,
      platform: 'slack',
      workspaceId: 'T0123456789',
      workspaceName: 'Acme',
      credentials: fakeCipher.encrypt(JSON.stringify({})),
      createdAt: NOW,
      channelsSyncedAt: null,
    })) as never);

  prisma.ownKey.create.mockImplementation(((args: {
    data: Omit<OwnKeyRow, 'id' | 'revokedAt' | 'deliveredToPeerAt'>;
  }) => {
    const created: OwnKeyRow = {
      id: `own-key-${ownKeys.length + 1}`,
      revokedAt: null,
      deliveredToPeerAt: null,
      ...args.data,
    };
    ownKeys = [...ownKeys, created];
    return Promise.resolve(created);
  }) as never);

  prisma.ownKey.findMany.mockImplementation(((args: {
    where: { relationId: string };
  }) =>
    Promise.resolve(
      ownKeys.filter((row) => row.relationId === args.where.relationId),
    )) as never);

  prisma.ownKey.findUnique.mockImplementation(((args: {
    where: { relationId_keyId: { relationId: string; keyId: string } };
  }) => {
    const { relationId, keyId } = args.where.relationId_keyId;
    return Promise.resolve(
      ownKeys.find(
        (row) => row.relationId === relationId && row.keyId === keyId,
      ) ?? null,
    );
  }) as never);

  prisma.peerKey.upsert.mockImplementation(((args: {
    create: Record<string, unknown>;
  }) => {
    peerKeys.push(args.create);
    return Promise.resolve(args.create);
  }) as never);

  return { prisma, relations: () => relations };
};

// ---------------------------------------------------------------------------
// Network double
// ---------------------------------------------------------------------------

/**
 * A GROWI that answers the ownership challenge honestly, recording every
 * exchange so the request that left can be inspected.
 */
const honestGrowi = (): {
  readonly resolver: GrowiUriResolver;
  readonly sent: ReadonlyArray<{ path: string; body: string | undefined }>;
} => {
  const sent: Array<{ path: string; body: string | undefined }> = [];
  return {
    sent,
    resolver: {
      connect: () =>
        Promise.resolve({
          ok: true,
          send: (request): Promise<GrowiHttpResponse> => {
            sent.push({ path: request.path, body: request.body });
            const challenge = parseOwnershipChallenge(
              JSON.parse(request.body ?? 'null'),
            );
            if ('error' in challenge) {
              return Promise.resolve({ status: 400, headers: {}, body: '' });
            }
            return Promise.resolve({
              status: 200,
              headers: { 'content-type': CONTENT_TYPE },
              body: JSON.stringify(honestAnswer(challenge)),
            });
          },
        }),
    },
  };
};

const appOver = (options: {
  readonly prisma: PrismaClient;
  readonly resolver: GrowiUriResolver;
}): Hono => {
  const app = new Hono();
  registerPairingRoutes(app, {
    pairingService: createPairingService({
      db: options.prisma,
      cipher: fakeCipher,
      uriResolver: options.resolver,
      now: () => NOW,
    }),
    uriResolver: options.resolver,
  });
  return app;
};

const submit = (app: Hono, body: string): Promise<Response> =>
  Promise.resolve(
    app.request(PAIRING_SUBMIT_PATH, {
      method: 'POST',
      headers: { 'content-type': CONTENT_TYPE },
      body,
    }),
  );

// ---------------------------------------------------------------------------

describe('POST /chat-integration/pairing/submit (Requirements 9.1, 9.2, 9.5)', () => {
  it('pairs a submission whose GROWI proves it holds the submitted key', async () => {
    const { prisma, relations } = createStorage();
    const { resolver, sent } = honestGrowi();

    const response = await submit(
      appOver({ prisma, resolver }),
      JSON.stringify(submission),
    );

    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({
      status: 'paired',
      relationId: RELATION_ID,
      workspace: {
        platform: 'slack',
        workspaceId: 'T0123456789',
        workspaceName: 'Acme',
      },
    });
    expect(relations()).toHaveLength(1);

    // The proxy's own public key travels back so GROWI can verify what this
    // proxy signs from now on.
    const returnedKey = createPublicKey({
      key: result.publicKey.publicKeyJwk,
      format: 'jwk',
    });
    expect(returnedKey.asymmetricKeyType).toBe('ed25519');
    expect(sent).toHaveLength(1);
  });

  it('delivers the challenge to the path GROWI serves it on, as a path and not a URL', async () => {
    const { prisma } = createStorage();
    const { resolver, sent } = honestGrowi();

    await submit(appOver({ prisma, resolver }), JSON.stringify(submission));

    expect(sent[0].path).toBe(
      '/_api/v3/chat-integration/peer/pairing/challenge',
    );
    // A whole URL here would double the GROWI's base path and would let the
    // exchange be aimed at another host; the final path looks identical either
    // way, so the absence of a scheme is the only assertion that tells them
    // apart (task 6.1's note).
    expect(sent[0].path).not.toContain('://');
    expect(JSON.parse(sent[0].body ?? '')).toMatchObject({
      registrationCode: CODE,
    });
  });

  it('answers the same submission sent twice identically, and mints no second relation', async () => {
    // `pairing/submit` carries neither a signature nor a one-time value, so it
    // is the most resendable entry point in the protocol. That property is
    // `PairingService`'s (task 5.4) and is proven where it lives; what this
    // asserts is that the HTTP edge does not break it.
    const { prisma, relations } = createStorage();
    const { resolver } = honestGrowi();
    const app = appOver({ prisma, resolver });

    const first = await (await submit(app, JSON.stringify(submission))).json();
    const second = await (await submit(app, JSON.stringify(submission))).json();

    expect(second).toStrictEqual(first);
    expect(relations()).toHaveLength(1);
  });

  it('refuses a body of the wrong shape -- the only gate this endpoint has', async () => {
    const { prisma, relations } = createStorage();
    const { resolver, sent } = honestGrowi();

    const response = await submit(
      appOver({ prisma, resolver }),
      // Every field present but `publicKey` missing: enough to look like a
      // submission and not enough to be one.
      JSON.stringify({
        registrationCode: CODE,
        growiUri: GROWI_URI,
        growiLabel: 'Acme GROWI',
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toBe('');
    // Nothing was reached: no relation, and no traffic to the declared URI.
    expect(relations()).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it('refuses a body that is not JSON at all, rather than failing as a fault', async () => {
    // With no signature in front of it, a body this endpoint cannot read is
    // the FIRST thing it meets. An exception escaping to Hono's default
    // handler would answer 500 and make an unreadable body look like a broken
    // proxy.
    const { prisma } = createStorage();
    const { resolver } = honestGrowi();

    const response = await submit(
      appOver({ prisma, resolver }),
      'not json at all',
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toBe('');
  });

  it('refuses a body that is not an object, such as a bare JSON string', async () => {
    const { prisma } = createStorage();
    const { resolver } = honestGrowi();

    const response = await submit(
      appOver({ prisma, resolver }),
      JSON.stringify('a string is valid JSON'),
    );

    expect(response.status).toBe(400);
  });

  it('never tells the submitter WHY the declared URI was refused', async () => {
    // The judgement's reason describes the network as this proxy sees it, and
    // returning it would help exactly the probing the judgement exists to
    // stop. The submitter learns only that ownership was not confirmed.
    const { prisma, relations } = createStorage();
    const resolver: GrowiUriResolver = {
      connect: async () => ({ ok: false, reason: 'private-address' }),
    };

    const response = await submit(
      appOver({ prisma, resolver }),
      JSON.stringify(submission),
    );

    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.status).toBe('ownership-unverified');
    expect(JSON.stringify(result)).not.toContain('private-address');
    expect(relations()).toHaveLength(0);
  });

  it("answers a refusal with 200 and the protocol's own shape", async () => {
    // `PairingResult` declares `code-expired` as a status, so the answer has a
    // field the GROWI side reads. A 4xx here would replace a shape the
    // protocol owns with a status code it does not -- and 401 in particular
    // would point an operator at a key, when no key exists at this point in
    // the handshake at all.
    const { prisma } = createStorage();
    const { resolver } = honestGrowi();
    prisma.pairingOrder.findUnique.mockImplementation((() =>
      Promise.resolve(null)) as never);

    const response = await submit(
      appOver({ prisma, resolver }),
      JSON.stringify(submission),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toStrictEqual({ status: 'code-expired' });
  });

  it('refuses an ownership answer this GROWI did not sign', async () => {
    // The signature, not the returned value, is what proves the submitted key
    // belongs to the GROWI at the declared URI. A peer that merely echoes the
    // challenge back knows the registration code and nothing more.
    const { prisma, relations } = createStorage();
    const resolver: GrowiUriResolver = {
      connect: () =>
        Promise.resolve({
          ok: true,
          send: (request) => {
            const challenge = JSON.parse(request.body ?? 'null');
            return Promise.resolve({
              status: 200,
              headers: {},
              body: JSON.stringify({
                challenge: challenge.challenge,
                challengeSignature: Buffer.alloc(64).toString('base64url'),
              }),
            });
          },
        }),
    };

    const response = await submit(
      appOver({ prisma, resolver }),
      JSON.stringify(submission),
    );

    expect((await response.json()).status).toBe('ownership-unverified');
    expect(relations()).toHaveLength(0);
  });
});

describe('the pairing endpoint is deliberately outside the signed set', () => {
  it('is served on the path design.md names for it', () => {
    expect(PAIRING_SUBMIT_PATH).toBe('/chat-integration/pairing/submit');
  });

  it('is absent from the table the signature guard consults', () => {
    // The guard refuses any path `INBOUND_OP_BY_PATH` does not name, so this
    // absence is what makes mounting it here impossible rather than merely
    // unwise -- and it is what lets task 8.5's guard-coverage check read that
    // table and leave this endpoint out by construction, with no exception
    // list to maintain. Every case above sends no signature header at all and
    // is still served; a guard in front of them would answer 401 instead.
    expect([...INBOUND_OP_BY_PATH.keys()]).not.toContain(PAIRING_SUBMIT_PATH);
  });
});
