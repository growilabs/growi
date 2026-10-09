// The proxy's half of the pairing procedure (design.md's `PairingService`,
// Requirements 8.5, 9.1-9.5).
//
// What these tests pin down is the handshake's security contract, not its
// mechanics:
//
//  1. **Nothing is sent to a declared URI before it has been judged** -- the
//     resolver runs first, and a rejected URI never becomes a request.
//  2. **Ownership is confirmed by a SIGNATURE over the purpose-prefixed
//     payload**, not by the challenge value coming back. Value equality alone
//     would let a third party who saw the registration code submit the real
//     GROWI's URI with their OWN key and pair as that GROWI.
//  3. **The same code submitted twice answers the same `PairingResult`** and
//     never mints a second relation -- `pairing/submit` carries neither a
//     signature nor a nonce, so it is the most resendable entry point there is.
//  4. **The relation row and the proxy's own key are one unit of work.**
//
// The mocked Prisma client is the same shape `relation-key-service.spec.ts`
// uses. `$transaction` is made to run its callback against the very same mock,
// so "the repositories inside the transaction wrote through the handle they
// were given" is observable; whether PostgreSQL actually rolls both writes back
// together is what `pairing-transaction.integ.ts` answers against a real
// database.
import {
  createPublicKey,
  generateKeyPairSync,
  sign as nodeSign,
  randomBytes,
} from 'node:crypto';
import type {
  ChallengeResponse,
  ChatAccountRef,
  OwnershipChallenge,
  PairingSubmission,
  PublicKeyRegistration,
} from '@growi/chat';
import { parseOwnershipChallenge } from '@growi/chat';
import { pairingChallengePayload } from '@growi/chat/server';
import { type DeepMockProxy, mockDeep } from 'vitest-mock-extended';

import type { PrismaClient } from '../db/index.js';
import type { SecretCipher } from '../types/index.js';
import type { GrowiUriResolver } from './growi-uri-resolver.js';
import {
  createPairingService,
  MAX_LIVE_PAIRING_ORDERS,
  MAX_SUBMISSION_ATTEMPTS,
  PairingOrderLimitError,
  REGISTRATION_CODE_TTL_MS,
  type SendChallenge,
} from './pairing-service.js';

const PREFIX = 'plain:';
const fakeCipher: SecretCipher = {
  encrypt: (plaintext) => `${PREFIX}${plaintext}`,
  decrypt: (ciphertext) => ciphertext.slice(PREFIX.length),
};

const NOW = new Date('2026-06-01T00:00:00.000Z');
const INSTALLATION_ID = '11111111-1111-4111-8111-111111111111';
const ORDER_ID = '22222222-2222-4222-8222-222222222222';
const RELATION_ID = '33333333-3333-4333-8333-333333333333';
const GROWI_URI = 'https://growi.example.com';
const CODE = 'registration-code-under-test';
const CHALLENGE = randomBytes(32).toString('base64url');

// The GROWI side of the exchange: a real Ed25519 keypair, so a signature this
// test builds is a signature the implementation has to actually verify.
const growiKeys = generateKeyPairSync('ed25519');
const GROWI_PUBLIC_JWK = growiKeys.publicKey.export({
  format: 'jwk',
}) as JsonWebKey;

// The same key as a stored row reads it: `public_key_jwk` is a `Json` column,
// which the contract's `JsonWebKey` (all-optional fields, no index signature)
// is not assignable to -- the same treatment `peer-key-repository.spec.ts`
// gives its fixture.
const GROWI_PUBLIC_JWK_ROW: Record<string, string> = growiKeys.publicKey.export(
  { format: 'jwk' },
) as Record<string, string>;

const growiRegistration: PublicKeyRegistration = {
  keyId: '44444444-4444-4444-8444-444444444444',
  publicKeyJwk: GROWI_PUBLIC_JWK,
  validFrom: '2026-01-01T00:00:00.000Z',
};

const submission: PairingSubmission = {
  registrationCode: CODE,
  growiUri: GROWI_URI,
  growiLabel: 'Acme GROWI',
  publicKey: growiRegistration,
};

const signWithGrowiKey = (payload: string): string =>
  nodeSign(null, Buffer.from(payload, 'utf8'), growiKeys.privateKey).toString(
    'base64url',
  );

/** What an honest GROWI answers at step 5. */
const honestAnswer = (challenge: OwnershipChallenge): ChallengeResponse => ({
  challenge: challenge.challenge,
  challengeSignature: signWithGrowiKey(
    pairingChallengePayload(challenge.registrationCode, challenge.challenge),
  ),
});

const orderRow = (overrides: Record<string, unknown> = {}) => ({
  id: ORDER_ID,
  installationId: INSTALLATION_ID,
  codeHash: 'unused-by-these-tests',
  attempts: 0,
  expiresAt: new Date(NOW.getTime() + 60_000),
  consumedAt: null,
  relationId: null,
  ...overrides,
});

const relationRow = (overrides: Record<string, unknown> = {}) => ({
  id: RELATION_ID,
  installationId: INSTALLATION_ID,
  growiUri: GROWI_URI,
  growiLabel: 'Acme GROWI',
  searchWeight: 1,
  settingsVersion: 0,
  createdAt: NOW,
  ...overrides,
});

const installationRow = (overrides: Record<string, unknown> = {}) => ({
  id: INSTALLATION_ID,
  platform: 'slack',
  workspaceId: 'T0123456789',
  workspaceName: 'Acme',
  credentials: fakeCipher.encrypt(JSON.stringify({})),
  createdAt: NOW,
  channelsSyncedAt: null,
  ...overrides,
});

const ownKeyRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'own-key-row-1',
  relationId: RELATION_ID,
  keyId: 'proxy-key-1',
  privateKeyPem: '',
  validFrom: NOW,
  revokedAt: null,
  supersededKeyId: null,
  deliveredToPeerAt: null,
  ...overrides,
});

const acceptingResolver = (): GrowiUriResolver => ({
  connect: async () => ({
    ok: true,
    send: async () => ({ status: 200, headers: {}, body: '' }),
  }),
});

const rejectingResolver = (): GrowiUriResolver => ({
  connect: async () => ({ ok: false, reason: 'private-address' }),
});

/**
 * Runs the callback against the very same mock, so every repository the service
 * builds over the transaction handle records its calls where the test can see
 * them. A callback that throws still rejects, which is how the rollback paths
 * below are exercised.
 */
const runTransactionsInline = (prisma: DeepMockProxy<PrismaClient>): void => {
  prisma.$transaction.mockImplementation(
    (arg: unknown) =>
      (arg as (tx: PrismaClient) => Promise<unknown>)(prisma) as never,
  );
};

/** A mock wired for the happy path; individual tests re-stub what they vary. */
const pairablePrisma = (): DeepMockProxy<PrismaClient> => {
  const prisma = mockDeep<PrismaClient>();
  runTransactionsInline(prisma);
  prisma.pairingOrder.findUnique.mockResolvedValue(orderRow());
  prisma.pairingOrder.update.mockResolvedValue(orderRow({ attempts: 1 }));
  prisma.pairingOrder.updateMany.mockResolvedValue({ count: 1 });
  prisma.pairingOrder.count.mockResolvedValue(0);
  prisma.relation.findUnique.mockResolvedValue(null);
  prisma.relation.create.mockResolvedValue(relationRow());
  prisma.installation.findUnique.mockResolvedValue(installationRow());
  prisma.peerKey.upsert.mockResolvedValue({
    id: 'peer-key-row-1',
    relationId: RELATION_ID,
    keyId: growiRegistration.keyId,
    publicKeyJwk: GROWI_PUBLIC_JWK_ROW,
    validFrom: new Date(growiRegistration.validFrom),
    revokedAt: null,
  });
  prisma.ownKey.create.mockResolvedValue(ownKeyRow());
  return prisma;
};

const serviceOver = (
  prisma: PrismaClient,
  overrides: {
    readonly resolver?: GrowiUriResolver;
    readonly generateRegistrationCode?: () => string;
  } = {},
) =>
  createPairingService({
    db: prisma,
    cipher: fakeCipher,
    uriResolver: overrides.resolver ?? acceptingResolver(),
    now: () => NOW,
    generateChallenge: () => CHALLENGE,
    ...(overrides.generateRegistrationCode != null
      ? { generateRegistrationCode: overrides.generateRegistrationCode }
      : {}),
  });

const ISSUER: ChatAccountRef = {
  platform: 'slack',
  accountId: 'U0123',
  displayName: 'Admin',
};

describe('pairingService.issueCode (Requirement 9.1)', () => {
  it('never stores the code itself -- only a hash of it reaches storage', async () => {
    const prisma = pairablePrisma();
    prisma.pairingOrder.create.mockResolvedValue(orderRow());

    const { code } = await serviceOver(prisma).issueCode(
      INSTALLATION_ID,
      ISSUER,
    );

    const written = JSON.stringify(
      prisma.pairingOrder.create.mock.calls[0][0].data,
    );
    expect(written).not.toContain(code);
    expect(written).toContain('"codeHash"');
  });

  it('issues a code with at least 128 bits of randomness and no ":" in it', async () => {
    // The `:` matters: `pairingChallengePayload` separates the code from the
    // challenge with one, and states plainly that the separator is unambiguous
    // only because a registration code can never contain it.
    const prisma = pairablePrisma();
    prisma.pairingOrder.create.mockResolvedValue(orderRow());

    const service = serviceOver(prisma);
    const issued = await Promise.all(
      Array.from({ length: 20 }, () =>
        service.issueCode(INSTALLATION_ID, ISSUER),
      ),
    );

    for (const { code } of issued) {
      expect(code).not.toContain(':');
      expect(code).toMatch(/^[A-Za-z0-9_-]{22,}$/);
    }
    expect(new Set(issued.map(({ code }) => code)).size).toBe(20);
  });

  it('expires the code after the declared lifetime (Requirement 9.1, 9.4)', async () => {
    const prisma = pairablePrisma();
    prisma.pairingOrder.create.mockResolvedValue(orderRow());

    const { expiresAt } = await serviceOver(prisma).issueCode(
      INSTALLATION_ID,
      ISSUER,
    );

    expect(expiresAt).toEqual(
      new Date(NOW.getTime() + REGISTRATION_CODE_TTL_MS),
    );
    expect(prisma.pairingOrder.create.mock.calls[0][0].data).toMatchObject({
      installationId: INSTALLATION_ID,
      expiresAt,
    });
  });

  it('refuses to issue past the per-installation cap on live codes', async () => {
    // protocol design.md: 「installation ごとに、発行数と間違えた試行の回数に
    // 上限を置く」. Without it, one operator could keep an unbounded number of
    // guessable windows open at once.
    const prisma = pairablePrisma();
    prisma.pairingOrder.count.mockResolvedValue(MAX_LIVE_PAIRING_ORDERS);

    await expect(
      serviceOver(prisma).issueCode(INSTALLATION_ID, ISSUER),
    ).rejects.toBeInstanceOf(PairingOrderLimitError);
    expect(prisma.pairingOrder.create).not.toHaveBeenCalled();
  });

  it('counts only codes that are still live against that cap', async () => {
    const prisma = pairablePrisma();
    prisma.pairingOrder.create.mockResolvedValue(orderRow());

    await serviceOver(prisma).issueCode(INSTALLATION_ID, ISSUER);

    expect(prisma.pairingOrder.count.mock.calls[0][0]?.where).toMatchObject({
      installationId: INSTALLATION_ID,
      consumedAt: null,
      expiresAt: { gt: NOW },
      // A code whose attempts are spent answers nothing any more. Counting it
      // would hold a slot nobody can use, so an operator who mistyped a URL
      // five times could not ask for a working code until the old ones
      // expired -- during exactly the first-time setup where that happens.
      attempts: { lt: MAX_SUBMISSION_ATTEMPTS },
    });
  });
});

describe('pairingService.submit — the ownership handshake (Requirement 9.2, 9.3, 9.5)', () => {
  it('pairs on a valid signature, writing both keys and answering with the proxy public key', async () => {
    const prisma = pairablePrisma();
    const send: SendChallenge = async (_uri, challenge) =>
      honestAnswer(challenge);

    const result = await serviceOver(prisma).submit(submission, send);

    expect(result.status).toBe('paired');
    if (result.status !== 'paired') return;
    expect(result.relationId).toBe(RELATION_ID);
    expect(result.workspace).toEqual({
      platform: 'slack',
      workspaceId: 'T0123456789',
      workspaceName: 'Acme',
    });

    // The proxy's OWN key comes back, and it is a public Ed25519 key with no
    // secret component -- the pairing must not put key material on the wire.
    expect(result.publicKey.publicKeyJwk).toMatchObject({
      kty: 'OKP',
      crv: 'Ed25519',
    });
    expect(result.publicKey.publicKeyJwk).not.toHaveProperty('d');
    expect(JSON.stringify(result)).not.toContain('PRIVATE KEY');

    // GROWI's key was registered as the PEER's key, and the proxy minted its
    // own -- one row in each table, never the same key on both sides.
    expect(prisma.peerKey.upsert.mock.calls[0][0].create).toMatchObject({
      relationId: RELATION_ID,
      keyId: growiRegistration.keyId,
    });
    expect(prisma.ownKey.create).toHaveBeenCalledTimes(1);
  });

  it('writes the relation row and the proxy key in one transaction', async () => {
    const prisma = pairablePrisma();

    await serviceOver(prisma).submit(submission, async (_uri, c) =>
      honestAnswer(c),
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('writes the proxy own key before any other write that can still fail', async () => {
    // The proxy's private key is the one row of a pairing that must never
    // outlive a failed attempt, so it is written FIRST among the writes that
    // can still fail -- everything after it is a chance for the transaction to
    // roll back with the key already in the transaction's scope.
    //
    // Asserted here rather than only in `pairing-transaction.integ.ts`, which
    // needs a real PostgreSQL: that test breaks the peer-key write to show the
    // rollback takes the own key with it, and if the two writes ever swapped
    // back it would stop reaching the own key at all and pass while proving
    // nothing. This is the assertion that notices the swap without a database.
    const prisma = pairablePrisma();

    await serviceOver(prisma).submit(submission, async (_uri, c) =>
      honestAnswer(c),
    );

    expect(prisma.ownKey.create).toHaveBeenCalledTimes(1);
    expect(prisma.peerKey.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.pairingOrder.updateMany).toHaveBeenCalledTimes(1);
    const ownKeyWrite = prisma.ownKey.create.mock.invocationCallOrder[0];
    expect(ownKeyWrite).toBeLessThan(
      prisma.peerKey.upsert.mock.invocationCallOrder[0],
    );
    expect(ownKeyWrite).toBeLessThan(
      prisma.pairingOrder.updateMany.mock.invocationCallOrder[0],
    );
  });

  it('counts the attempt before the submitted URI is resolved (Requirement 9.4)', async () => {
    // What the cap on attempts bounds is not only how many codes may be
    // guessed, but how much outbound traffic ONE code can cause: resolving a
    // submitted URI is work an outsider gets the proxy to do for them, so it
    // must cost one of the five attempts even when it fails. Counting after
    // the resolution -- or, more subtly, moving only the resolution above the
    // counting and leaving the refusal where it is -- would let a stolen code
    // probe an unlimited number of attacker-chosen hostnames for free.
    const prisma = pairablePrisma();
    const connect = vi.fn<GrowiUriResolver['connect']>(async () => ({
      ok: false,
      reason: 'private-address',
    }));
    const send = vi.fn<SendChallenge>();

    const result = await serviceOver(prisma, {
      resolver: { connect },
    }).submit(submission, send);

    expect(result.status).toBe('ownership-unverified');
    expect(send).not.toHaveBeenCalled();
    // The attempt was spent even though the URI never resolved...
    expect(prisma.pairingOrder.update.mock.calls[0][0].data).toEqual({
      attempts: { increment: 1 },
    });
    // ...and it was spent BEFORE the proxy reached out, which is what makes
    // the cap bound the traffic rather than only the guesses.
    expect(connect).toHaveBeenCalledTimes(1);
    expect(prisma.pairingOrder.update.mock.invocationCallOrder[0]).toBeLessThan(
      connect.mock.invocationCallOrder[0],
    );
  });

  it('judges the declared URI before anything is sent to it (Requirement 9.2)', async () => {
    const prisma = pairablePrisma();
    const send = vi.fn<SendChallenge>();

    const result = await serviceOver(prisma, {
      resolver: rejectingResolver(),
    }).submit(submission, send);

    expect(result.status).toBe('ownership-unverified');
    expect(send).not.toHaveBeenCalled();
    expect(prisma.relation.create).not.toHaveBeenCalled();
  });

  it('does not report WHY the declared URI was refused', async () => {
    // design.md: 「管理者に返すのは失敗の種類だけで、相手の応答の中身は返さない。
    // 返すと探索の結果が読めてしまう」. `private-address` / `dns-failure` describe
    // what the proxy can see from where it stands, which is exactly the map the
    // URI check exists to withhold.
    const result = await serviceOver(pairablePrisma(), {
      resolver: rejectingResolver(),
    }).submit(submission, async (_uri, c) => honestAnswer(c));

    expect(result.status).toBe('ownership-unverified');
    if (result.status !== 'ownership-unverified') return;
    expect(result.detail).not.toContain('private-address');
    expect(result.detail).not.toContain('dns');
  });

  it('sends the challenge to the DECLARED uri, carrying the registration code', async () => {
    const prisma = pairablePrisma();
    const send = vi.fn<SendChallenge>(async (_uri, c) => honestAnswer(c));

    await serviceOver(prisma).submit(submission, send);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBe(GROWI_URI);
    expect(send.mock.calls[0][1]).toEqual({
      registrationCode: CODE,
      challenge: CHALLENGE,
    });
  });

  it('generates a challenge the contract accepts, without a test pinning the value', async () => {
    // Every other test injects the challenge, so nothing else exercises the
    // generator this actually ships with. A challenge outside the contract's
    // 32-128 base64url window would make every real GROWI answer 400 and
    // pairing would never work once -- invisible until integration.
    const prisma = pairablePrisma();
    const send = vi.fn<SendChallenge>(async (_uri, c) => honestAnswer(c));

    await createPairingService({
      db: prisma,
      cipher: fakeCipher,
      uriResolver: acceptingResolver(),
      now: () => NOW,
    }).submit(submission, send);

    // Judged by the contract's own parser rather than a regex written here,
    // so this tracks the shape rule instead of restating it.
    expect(parseOwnershipChallenge(send.mock.calls[0][1])).toEqual(
      send.mock.calls[0][1],
    );
  });

  it('refuses a signature made over the bare challenge instead of the pairing payload', async () => {
    // The whole reason the payload carries a purpose prefix: a step-5 endpoint
    // that signs whatever it is handed would otherwise sign an RFC 9421
    // signature base and hand back a usable production signature.
    const prisma = pairablePrisma();

    const result = await serviceOver(prisma).submit(
      submission,
      async (_uri, challenge) => ({
        challenge: challenge.challenge,
        challengeSignature: signWithGrowiKey(challenge.challenge),
      }),
    );

    expect(result.status).toBe('ownership-unverified');
    expect(prisma.relation.create).not.toHaveBeenCalled();
  });

  it('refuses a valid signature made by a DIFFERENT key than the one submitted', async () => {
    // Requirement 9.2's real content: a third party who saw the code submits
    // the genuine GROWI's URI with their own key. The genuine GROWI answers
    // step 5 honestly with ITS key, so the challenge value matches; only
    // checking the signature against the SUBMITTED key stops the swap.
    const prisma = pairablePrisma();
    const otherKeys = generateKeyPairSync('ed25519');

    const result = await serviceOver(prisma).submit(
      submission,
      async (_uri, challenge) => ({
        challenge: challenge.challenge,
        challengeSignature: nodeSign(
          null,
          Buffer.from(
            pairingChallengePayload(
              challenge.registrationCode,
              challenge.challenge,
            ),
            'utf8',
          ),
          otherKeys.privateKey,
        ).toString('base64url'),
      }),
    );

    expect(result.status).toBe('ownership-unverified');
    expect(prisma.relation.create).not.toHaveBeenCalled();
  });

  it('refuses an answer that echoes a different challenge', async () => {
    const prisma = pairablePrisma();
    const otherChallenge = randomBytes(32).toString('base64url');

    const result = await serviceOver(prisma).submit(
      submission,
      async (_uri, challenge) => ({
        challenge: otherChallenge,
        challengeSignature: signWithGrowiKey(
          pairingChallengePayload(challenge.registrationCode, otherChallenge),
        ),
      }),
    );

    expect(result.status).toBe('ownership-unverified');
  });

  it('checks the SHAPE of the answer before verifying it', async () => {
    // Step 5's answer carries no signature of its own, so the shape check is
    // the only acceptance gate there is (design.md 「署名の付かない相手から届く
    // 唯一の応答」).
    const prisma = pairablePrisma();
    const malformed = { challenge: 42 } as unknown as ChallengeResponse;

    const result = await serviceOver(prisma).submit(
      submission,
      async () => malformed,
    );

    expect(result.status).toBe('ownership-unverified');
    expect(prisma.relation.create).not.toHaveBeenCalled();
  });

  it('treats a failed delivery as unverified rather than letting it escape', async () => {
    const prisma = pairablePrisma();

    const result = await serviceOver(prisma).submit(submission, () =>
      Promise.reject(new Error('connect ETIMEDOUT')),
    );

    expect(result.status).toBe('ownership-unverified');
    if (result.status !== 'ownership-unverified') return;
    // The peer's own words never reach the administrator.
    expect(result.detail).not.toContain('ETIMEDOUT');
  });

  it('refuses a submitted key that is not an Ed25519 public key, before sending anything', async () => {
    const prisma = pairablePrisma();
    const send = vi.fn<SendChallenge>();
    const withSecret: PairingSubmission = {
      ...submission,
      publicKey: {
        ...growiRegistration,
        publicKeyJwk: {
          ...GROWI_PUBLIC_JWK,
          d: 'c2VjcmV0',
        },
      },
    };

    const result = await serviceOver(prisma).submit(withSecret, send);

    expect(result.status).toBe('ownership-unverified');
    expect(send).not.toHaveBeenCalled();
  });

  it('refuses a keyId that could shift the wire separator, before sending anything', async () => {
    // `keyId` is chosen by the GROWI side, and later travels inside `keyid` as
    // `<relationId>:<keyId>`. One carrying the separator itself would move
    // where that value splits, so which relation a later signature resolves
    // against stops being decided by the proxy. Registration is the only
    // moment the proxy can judge that value, so the key material being a
    // perfectly good Ed25519 public key is not enough on its own.
    const prisma = pairablePrisma();
    const send = vi.fn<SendChallenge>();
    const withSeparatorInKeyId: PairingSubmission = {
      ...submission,
      publicKey: {
        ...growiRegistration,
        keyId: `${RELATION_ID}:smuggled`,
      },
    };

    const result = await serviceOver(prisma).submit(withSeparatorInKeyId, send);

    expect(result.status).toBe('ownership-unverified');
    expect(send).not.toHaveBeenCalled();
    expect(prisma.relation.create).not.toHaveBeenCalled();
  });
});

describe('pairingService.submit — the registration code itself (Requirement 9.4)', () => {
  it('answers code-expired for a code nobody issued', async () => {
    const prisma = pairablePrisma();
    prisma.pairingOrder.findUnique.mockResolvedValue(null);
    const send = vi.fn<SendChallenge>();

    const result = await serviceOver(prisma).submit(submission, send);

    expect(result).toEqual({ status: 'code-expired' });
    expect(send).not.toHaveBeenCalled();
  });

  it('answers code-expired once the code has passed its expiry', async () => {
    const prisma = pairablePrisma();
    prisma.pairingOrder.findUnique.mockResolvedValue(
      orderRow({ expiresAt: new Date(NOW.getTime() - 1) }),
    );
    const send = vi.fn<SendChallenge>();

    const result = await serviceOver(prisma).submit(submission, send);

    expect(result).toEqual({ status: 'code-expired' });
    expect(send).not.toHaveBeenCalled();
  });

  it('counts a wrong submission and stops answering past the attempt cap', async () => {
    const prisma = pairablePrisma();
    prisma.pairingOrder.update.mockResolvedValue(
      orderRow({ attempts: MAX_SUBMISSION_ATTEMPTS + 1 }),
    );
    const send = vi.fn<SendChallenge>();

    const result = await serviceOver(prisma).submit(submission, send);

    expect(result).toEqual({ status: 'code-expired' });
    expect(send).not.toHaveBeenCalled();
    // Counted by the database, never read-then-written here: two submissions
    // arriving together must not both spend the same attempt.
    expect(prisma.pairingOrder.update.mock.calls[0][0].data).toEqual({
      attempts: { increment: 1 },
    });
  });

  it('does not spend an attempt on a resubmission of a code that already paired', async () => {
    const prisma = pairablePrisma();
    prisma.pairingOrder.findUnique.mockResolvedValue(
      orderRow({ consumedAt: NOW, relationId: RELATION_ID }),
    );
    prisma.relation.findUnique.mockResolvedValue(relationRow());
    prisma.ownKey.findMany.mockResolvedValue([ownKeyRow()]);
    prisma.ownKey.findUnique.mockResolvedValue(
      ownKeyRow({
        privateKeyPem: fakeCipher.encrypt(
          generateKeyPairSync('ed25519')
            .privateKey.export({ type: 'pkcs8', format: 'pem' })
            .toString(),
        ),
      }),
    );

    await serviceOver(prisma).submit(submission, async (_uri, c) =>
      honestAnswer(c),
    );

    expect(prisma.pairingOrder.update).not.toHaveBeenCalled();
  });
});

describe('pairingService.submit — resending and double pairing (Requirement 8.5)', () => {
  it('answers the SAME result for a second submission of the same code, minting no second relation', async () => {
    const prisma = pairablePrisma();
    const proxyKeys = generateKeyPairSync('ed25519');
    const storedOwnKey = ownKeyRow({
      privateKeyPem: fakeCipher.encrypt(
        proxyKeys.privateKey
          .export({ type: 'pkcs8', format: 'pem' })
          .toString(),
      ),
    });
    prisma.pairingOrder.findUnique.mockResolvedValue(
      orderRow({ consumedAt: NOW, relationId: RELATION_ID }),
    );
    prisma.relation.findUnique.mockResolvedValue(relationRow());
    prisma.ownKey.findMany.mockResolvedValue([storedOwnKey]);
    prisma.ownKey.findUnique.mockResolvedValue(storedOwnKey);
    const send = vi.fn<SendChallenge>();

    const result = await serviceOver(prisma).submit(submission, send);

    expect(result.status).toBe('paired');
    if (result.status !== 'paired') return;
    expect(result.relationId).toBe(RELATION_ID);
    expect(result.publicKey.keyId).toBe('proxy-key-1');
    expect(result.publicKey.publicKeyJwk).toEqual(
      createPublicKey(proxyKeys.privateKey).export({ format: 'jwk' }),
    );

    // No second relation, and no second round trip to GROWI.
    expect(prisma.relation.create).not.toHaveBeenCalled();
    expect(prisma.ownKey.create).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('does not answer paired to a submission naming a DIFFERENT GROWI than the code paired', async () => {
    // One code pairs one GROWI. The same code pasted into a second GROWI is a
    // different pairing attempt: answering `paired` would leave that GROWI
    // holding a `relationId` this proxy has no relation for, so its later
    // signed requests would all fail verification with nothing explaining why
    // -- and it would hand out that `relationId` and the workspace name too.
    const prisma = pairablePrisma();
    prisma.pairingOrder.findUnique.mockResolvedValue(
      orderRow({ consumedAt: NOW, relationId: RELATION_ID }),
    );
    prisma.relation.findUnique.mockResolvedValue(
      relationRow({ growiUri: 'https://another-growi.example.com' }),
    );
    const send = vi.fn<SendChallenge>();

    const result = await serviceOver(prisma).submit(submission, send);

    expect(result).toEqual({ status: 'code-expired' });
    expect(send).not.toHaveBeenCalled();
  });

  it('refuses to pair the same GROWI to the same workspace twice, before sending anything', async () => {
    const prisma = pairablePrisma();
    prisma.relation.findUnique.mockResolvedValue(
      relationRow({ id: 'an-existing-relation' }),
    );
    const send = vi.fn<SendChallenge>();

    const result = await serviceOver(prisma).submit(submission, send);

    expect(result.status).toBe('already-paired');
    expect(send).not.toHaveBeenCalled();
    expect(prisma.relation.create).not.toHaveBeenCalled();
  });

  it('does not consume the order when another submission consumed it first', async () => {
    // Two copies of the same submission arriving together: only the writer that
    // flipped `consumed_at` goes on. The loser answers with the winner's
    // result instead of creating a relation of its own.
    const prisma = pairablePrisma();
    prisma.pairingOrder.updateMany.mockResolvedValue({ count: 0 });
    // Deliberately a DIFFERENT id from the one the winner's relation carries.
    // Without this, a loser that wrongly believed it had won would return the
    // relation it minted itself and the assertion below could not tell that
    // apart from the winner's result being rebuilt.
    prisma.relation.create.mockResolvedValue(
      relationRow({ id: 'relation-minted-by-the-loser' }),
    );
    const proxyKeys = generateKeyPairSync('ed25519');
    const storedOwnKey = ownKeyRow({
      privateKeyPem: fakeCipher.encrypt(
        proxyKeys.privateKey
          .export({ type: 'pkcs8', format: 'pem' })
          .toString(),
      ),
    });
    prisma.pairingOrder.findUnique
      .mockResolvedValueOnce(orderRow())
      .mockResolvedValue(
        orderRow({ consumedAt: NOW, relationId: RELATION_ID }),
      );
    prisma.relation.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValue(relationRow());
    prisma.ownKey.findMany.mockResolvedValue([storedOwnKey]);
    prisma.ownKey.findUnique.mockResolvedValue(storedOwnKey);

    const result = await serviceOver(prisma).submit(
      submission,
      async (_uri, c) => honestAnswer(c),
    );

    expect(result.status).toBe('paired');
    if (result.status !== 'paired') return;
    // The WINNER's relation, rebuilt -- not the one this copy minted before the
    // conditional consume rejected it.
    expect(result.relationId).not.toBe('relation-minted-by-the-loser');
    expect(result.relationId).toBe(RELATION_ID);
    expect(prisma.pairingOrder.updateMany.mock.calls[0][0].where).toMatchObject(
      {
        id: ORDER_ID,
        consumedAt: null,
      },
    );
  });
});

describe('pairingService.unpair (Requirement 9.7)', () => {
  // design.md declares `unpair` on `PairingService` (line 986) AND lists
  // `relation/unpair-service.ts` in its File Structure Plan. Both hold: the
  // deletion lives in `unpair-service.ts` and is tested there, and this is the
  // contract that it is reachable through `PairingService` -- what makes
  // pairing and its undoing one surface for `orchestration/` to call.
  it('undoes a pairing through the same ordered deletion UnpairService performs', async () => {
    const prisma = pairablePrisma();
    prisma.ownKey.deleteMany.mockResolvedValue({ count: 1 });
    prisma.peerKey.deleteMany.mockResolvedValue({ count: 1 });
    prisma.channelPermission.deleteMany.mockResolvedValue({ count: 0 });
    prisma.pendingCollection.deleteMany.mockResolvedValue({ count: 0 });
    prisma.processedNotificationTarget.deleteMany.mockResolvedValue({
      count: 0,
    });
    prisma.relation.delete.mockResolvedValue(relationRow());

    await serviceOver(prisma).unpair(RELATION_ID);

    expect(prisma.ownKey.deleteMany).toHaveBeenCalledWith({
      where: { relationId: RELATION_ID },
    });
    expect(prisma.relation.delete).toHaveBeenCalledWith({
      where: { id: RELATION_ID },
    });
  });
});
