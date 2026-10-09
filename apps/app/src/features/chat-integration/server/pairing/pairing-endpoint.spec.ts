import {
  generateKeyPairSync,
  type KeyObject,
  verify as nodeVerify,
} from 'node:crypto';
import { pairingChallengePayload } from '@growi/chat/server';
import type { Express } from 'express';
import express from 'express';
import type { MongoMemoryServer } from 'mongodb-memory-server-core';
import mongoose from 'mongoose';
import request from 'supertest';

import {
  connectSelfContainedMongo,
  disconnectSelfContainedMongo,
} from '^/test/setup/mongo/self-contained-connection';

import type { ChatKeyEncryptionEnv } from '../keys/key-encryption';
import { encryptChatKeyForStorage } from '../keys/key-encryption';
import { ChatChallengeAttempt } from './models/chat-challenge-attempt';
import { ChatPendingPairing } from './models/pending-pairing';
import {
  CHALLENGE_RATE_LIMIT_MAX_ATTEMPTS,
  type ChallengeRateLimitContext,
  createPairingEndpoint,
  recordChallengeAttempt,
  resolveSourceKey,
} from './pairing-endpoint';

const JSON_CONTENT_TYPE = 'application/json';
const PATH = '/peer/pairing/challenge';

/** A clearly-fake 32-byte value; the tests only need AES-256 to accept it. */
const TEST_ENCRYPTION_KEY: ChatKeyEncryptionEnv = {
  CHAT_INTEGRATION_KEY_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
};

/** base64url, 43 chars -- inside `OwnershipChallenge`'s 32..128 range. */
const genChallenge = (seed: number): string =>
  Buffer.alloc(32, seed).toString('base64url');

type RecordRateLimit = (ctx: ChallengeRateLimitContext) => Promise<void>;

interface Harness {
  readonly app: Express;
  readonly recordRateLimitExceeded: ReturnType<typeof vi.fn<RecordRateLimit>>;
}

/**
 * An app shaped like the real one: `express.raw` for `application/json`
 * ahead of the app-wide urlencoded parser, mirroring what
 * `server/crowi/express-init.js` registers under `/peer/` (task 2.1) --
 * same convention `signature-guard.spec.ts` uses.
 */
const buildHarness = (options?: { readonly trustProxy?: boolean }): Harness => {
  const app = express();
  if (options?.trustProxy) {
    app.set('trust proxy', true);
  }
  app.use(express.raw({ type: JSON_CONTENT_TYPE, limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  const recordRateLimitExceeded = vi.fn<RecordRateLimit>(async () => {});
  app.post(PATH, createPairingEndpoint({ recordRateLimitExceeded }));

  return { app, recordRateLimitExceeded };
};

const postChallenge = (
  harness: Harness,
  body: unknown,
  options?: { readonly forwardedFor?: string; readonly asText?: string },
) => {
  const agent = request(harness.app)
    .post(PATH)
    .set('content-type', JSON_CONTENT_TYPE);
  if (options?.forwardedFor != null) {
    agent.set('X-Forwarded-For', options.forwardedFor);
  }
  return agent.send(options?.asText ?? JSON.stringify(body));
};

interface StoredPairing {
  readonly registrationCode: string;
  readonly keyPair: {
    readonly publicKey: KeyObject;
    readonly privateKey: KeyObject;
  };
}

const insertPendingPairing = async (
  overrides: Partial<{
    readonly registrationCode: string;
    readonly expiresAt: Date;
  }> = {},
): Promise<StoredPairing> => {
  const registrationCode =
    overrides.registrationCode ??
    `code-${new mongoose.Types.ObjectId().toHexString()}`;
  const keyPair = generateKeyPairSync('ed25519');
  const pem = keyPair.privateKey
    .export({ type: 'pkcs8', format: 'pem' })
    .toString();

  await ChatPendingPairing.create({
    registrationCode,
    proxyUri: 'https://proxy.example.test',
    growiUri: 'https://growi.example.test',
    createdBy: new mongoose.Types.ObjectId(),
    ownKeyId: 'pending-key-0001',
    ownKeyPair: encryptChatKeyForStorage(pem),
    expiresAt: overrides.expiresAt ?? new Date(Date.now() + 10 * 60_000),
  });

  return { registrationCode, keyPair };
};

describe('pairing-endpoint', () => {
  let mongod: MongoMemoryServer | undefined;
  const previousEnv = { ...process.env };

  beforeAll(async () => {
    ({ mongod } = await connectSelfContainedMongo(
      'growi_test_unit_pairing_endpoint',
    ));
  });

  beforeEach(async () => {
    await ChatPendingPairing.deleteMany({});
    await ChatChallengeAttempt.deleteMany({});
    Object.assign(process.env, TEST_ENCRYPTION_KEY);
  });

  afterEach(() => {
    process.env = { ...previousEnv };
  });

  afterAll(async () => {
    await disconnectSelfContainedMongo(mongod);
  });

  describe('resolveSourceKey', () => {
    it('reports distinguishable: true when trust proxy is configured', () => {
      const req = { ip: '203.0.113.5', app: { get: () => true } };
      expect(resolveSourceKey(req)).toEqual({
        sourceKey: '203.0.113.5',
        distinguishable: true,
      });
    });

    it("reports distinguishable: false at Express's trust-proxy default (unconfigured)", () => {
      const req = { ip: '203.0.113.5', app: { get: () => false } };
      expect(resolveSourceKey(req).distinguishable).toBe(false);
    });
  });

  describe('recordChallengeAttempt', () => {
    it('allows up to the limit and refuses the next attempt from the same source', async () => {
      const registrationCode = 'rate-limit-code';
      const sourceKey = '198.51.100.9';
      const now = new Date();

      let last: Awaited<ReturnType<typeof recordChallengeAttempt>> | undefined;
      for (let i = 0; i < CHALLENGE_RATE_LIMIT_MAX_ATTEMPTS; i += 1) {
        // biome-ignore lint/performance/noAwaitInLoops: attempts must be sequential to exercise the counter honestly
        last = await recordChallengeAttempt(registrationCode, sourceKey, now);
        expect(last.allowed).toBe(true);
      }
      expect(last?.count).toBe(CHALLENGE_RATE_LIMIT_MAX_ATTEMPTS);

      const overLimit = await recordChallengeAttempt(
        registrationCode,
        sourceKey,
        now,
      );
      expect(overLimit.allowed).toBe(false);
    });

    it('counts a different source independently', async () => {
      const registrationCode = 'rate-limit-code-2';
      const now = new Date();

      for (let i = 0; i < CHALLENGE_RATE_LIMIT_MAX_ATTEMPTS; i += 1) {
        // biome-ignore lint/performance/noAwaitInLoops: same reason as above
        await recordChallengeAttempt(registrationCode, 'source-a', now);
      }
      const sourceAOverLimit = await recordChallengeAttempt(
        registrationCode,
        'source-a',
        now,
      );
      expect(sourceAOverLimit.allowed).toBe(false);

      const sourceB = await recordChallengeAttempt(
        registrationCode,
        'source-b',
        now,
      );
      expect(sourceB.allowed).toBe(true);
    });
  });

  describe('createPairingEndpoint', () => {
    it('signs pairingChallengePayload(registrationCode, challenge) -- NOT the bare challenge', async () => {
      const { registrationCode, keyPair } = await insertPendingPairing();
      const challenge = genChallenge(1);
      const harness = buildHarness();
      const response = await postChallenge(harness, {
        registrationCode,
        challenge,
      });

      expect(response.status).toBe(200);
      const { challengeSignature } = response.body as {
        challenge: string;
        challengeSignature: string;
      };

      const signatureBytes = Buffer.from(challengeSignature, 'base64url');
      const expectedPayload = pairingChallengePayload(
        registrationCode,
        challenge,
      );

      // The core anti-oracle property: the signature verifies against the
      // PREFIXED payload...
      expect(
        nodeVerify(
          null,
          Buffer.from(expectedPayload, 'utf8'),
          keyPair.publicKey,
          signatureBytes,
        ),
      ).toBe(true);

      // ...and does NOT verify against the bare challenge alone.
      expect(
        nodeVerify(
          null,
          Buffer.from(challenge, 'utf8'),
          keyPair.publicKey,
          signatureBytes,
        ),
      ).toBe(false);
    });

    it('answers the SAME challenge twice with the same signature (no "answered once" memory)', async () => {
      const { registrationCode } = await insertPendingPairing();
      const challenge = genChallenge(2);
      const harness = buildHarness();

      const first = await postChallenge(harness, {
        registrationCode,
        challenge,
      });
      const second = await postChallenge(harness, {
        registrationCode,
        challenge,
      });

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(second.body.challengeSignature).toBe(
        first.body.challengeSignature,
      );
    });

    it('answers a DIFFERENT challenge for the same pending pairing (no per-challenge memory)', async () => {
      const { registrationCode, keyPair } = await insertPendingPairing();
      const harness = buildHarness();

      const challengeOne = genChallenge(3);
      const challengeTwo = genChallenge(4);

      const first = await postChallenge(harness, {
        registrationCode,
        challenge: challengeOne,
      });
      const second = await postChallenge(harness, {
        registrationCode,
        challenge: challengeTwo,
      });

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(second.body.challengeSignature).not.toBe(
        first.body.challengeSignature,
      );

      const secondSignatureBytes = Buffer.from(
        second.body.challengeSignature as string,
        'base64url',
      );
      expect(
        nodeVerify(
          null,
          Buffer.from(
            pairingChallengePayload(registrationCode, challengeTwo),
            'utf8',
          ),
          keyPair.publicKey,
          secondSignatureBytes,
        ),
      ).toBe(true);
    });

    it('refuses 401 when no pending pairing matches the registration code', async () => {
      const harness = buildHarness();
      const response = await postChallenge(harness, {
        registrationCode: 'no-such-code',
        challenge: genChallenge(5),
      });
      expect(response.status).toBe(401);
    });

    it('refuses 410 when the matching pending pairing has expired', async () => {
      const { registrationCode } = await insertPendingPairing({
        expiresAt: new Date(Date.now() - 60_000),
      });
      const harness = buildHarness();
      const response = await postChallenge(harness, {
        registrationCode,
        challenge: genChallenge(6),
      });
      expect(response.status).toBe(410);
    });

    it('refuses 400 for a malformed challenge (too short)', async () => {
      const { registrationCode } = await insertPendingPairing();
      const harness = buildHarness();
      const response = await postChallenge(harness, {
        registrationCode,
        challenge: 'too-short',
      });
      expect(response.status).toBe(400);
    });

    it('refuses 400 when the body does not arrive as a Buffer (wrong content-type)', async () => {
      const { registrationCode } = await insertPendingPairing();
      const harness = buildHarness();
      const response = await request(harness.app)
        .post(PATH)
        .set('content-type', 'text/plain')
        .send(JSON.stringify({ registrationCode, challenge: genChallenge(7) }));
      expect(response.status).toBe(400);
    });

    it('rate-limits per source: a flooding source is refused while a different source for the SAME pending pairing still succeeds', async () => {
      const { registrationCode } = await insertPendingPairing();
      const harness = buildHarness({ trustProxy: true });

      let last: request.Response | undefined;
      for (let i = 0; i < CHALLENGE_RATE_LIMIT_MAX_ATTEMPTS + 1; i += 1) {
        // biome-ignore lint/performance/noAwaitInLoops: attempts must be sequential to exercise the per-source counter honestly
        last = await postChallenge(
          harness,
          { registrationCode, challenge: genChallenge(8) },
          { forwardedFor: '203.0.113.10' },
        );
      }
      expect(last?.status).toBe(429);
      expect(harness.recordRateLimitExceeded).toHaveBeenCalledTimes(1);
      const [ctx] = harness.recordRateLimitExceeded.mock.calls[0];
      expect(ctx.distinguishable).toBe(true);

      // The real proxy, from a different source, still gets answered.
      const genuine = await postChallenge(
        harness,
        { registrationCode, challenge: genChallenge(9) },
        { forwardedFor: '203.0.113.20' },
      );
      expect(genuine.status).toBe(200);
    });

    it('surfaces "sources are not distinguishable" when trust proxy is unconfigured', async () => {
      const { registrationCode } = await insertPendingPairing();
      // No `trustProxy: true` -- Express's own default applies, same as an
      // operator who never set `security:trustProxyBool` / `Csv` / `Hops`.
      const harness = buildHarness();

      let last: request.Response | undefined;
      for (let i = 0; i < CHALLENGE_RATE_LIMIT_MAX_ATTEMPTS + 1; i += 1) {
        // Different X-Forwarded-For values are IGNORED without trust proxy,
        // so every attempt lands in the same bucket -- this IS the degraded
        // behavior being surfaced.
        // biome-ignore lint/performance/noAwaitInLoops: sequential by construction
        last = await postChallenge(
          harness,
          { registrationCode, challenge: genChallenge(10) },
          { forwardedFor: `203.0.113.${30 + i}` },
        );
      }
      expect(last?.status).toBe(429);
      expect(harness.recordRateLimitExceeded).toHaveBeenCalledTimes(1);
      const [ctx] = harness.recordRateLimitExceeded.mock.calls[0];
      expect(ctx.distinguishable).toBe(false);
    });
  });
});
