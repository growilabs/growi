// Proves task 7.3's contract (Requirements 9.1, 9.4, 9.5, 9.7): the outbound
// half of the pairing procedure (steps 1-4 and 6), and -- the part design.md
// warns is catastrophic to omit ("この作業を落とすと、繋ぎ直しただけで全利用者の
// 紐付けが消える") -- carrying every user's account link over to the new
// `relationId` when an administrator unpairs and pairs the same workspace
// again.
//
// The one boundary that is faked here is the network call itself
// (`submitPairing`, task 7.1, exercised on its own in `proxy-client.spec.ts`).
// Everything else runs for real against MongoDB, including pairing step 5:
// the fake `submit` answers the ownership challenge by driving the REAL
// `createPairingEndpoint` handler over supertest, then verifies the returned
// signature against the public key that was submitted in step 3. That is what
// makes "申し込みから成立まで往復し" an actual round trip rather than a stubbed
// one -- it fails if the pending row is not written before the call, if the
// stored key pair does not match the submitted public key, or if the key is
// moved out of `chat_pending_pairings` too early.

import {
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
  verify as nodeVerify,
} from 'node:crypto';
import type { PairingResult, PairingSubmission } from '@growi/chat';
import { pairingChallengePayload } from '@growi/chat/server';
import express from 'express';
import type { MongoMemoryServer } from 'mongodb-memory-server-core';
import { Types } from 'mongoose';
import request from 'supertest';

import {
  connectSelfContainedMongo,
  disconnectSelfContainedMongo,
} from '^/test/setup/mongo/self-contained-connection';

import { ChatAccountLink } from '../account-link/models/chat-account-link';
import { signWithOwnKey } from '../keys';
import type { ChatKeyEncryptionEnv } from '../keys/key-encryption';
import { ChatIntegrationKey } from '../keys/models/chat-integration-key';
import { ChatNotificationDestination } from '../models/chat-notification-destination';
import { ChatRelation } from '../models/chat-relation';
import { ChatChannelPermission } from '../settings/models/chat-channel-permission';
import { ChatChallengeAttempt } from './models/chat-challenge-attempt';
import { ChatPendingPairing } from './models/pending-pairing';
import { createPairingEndpoint } from './pairing-endpoint';
import {
  type PairingOutcome,
  submitPairingRequest,
  unpairRelation,
} from './pairing-service';

/** A clearly-fake 32-byte value; the tests only need AES-256 to accept it. */
const TEST_ENCRYPTION_KEY: ChatKeyEncryptionEnv = {
  CHAT_INTEGRATION_KEY_ENCRYPTION_KEY: Buffer.alloc(32, 5).toString('base64'),
};

const PROXY_URI = 'https://proxy.example.test';
const GROWI_URI = 'https://growi.example.test';
const GROWI_LABEL = 'Acme GROWI';
const PLATFORM = 'slack' as const;
const WORKSPACE_ID = 'T-ACME';
const CHALLENGE_PATH = '/peer/pairing/challenge';

/** base64url, 43 chars -- inside `OwnershipChallenge`'s 32..128 range. */
const genChallenge = (seed: number): string =>
  Buffer.alloc(32, seed).toString('base64url');

/**
 * A throwaway Ed25519 public key, standing in for the proxy's own key that
 * `PairingResult` carries back in step 6.
 */
const peerKeyPair = () => generateKeyPairSync('ed25519');

const asJwk = (key: KeyObject) => {
  const jwk = key.export({ format: 'jwk' });
  return { kty: jwk.kty, crv: jwk.crv, x: jwk.x };
};

/**
 * Drives the REAL pairing step-5 endpoint for `registrationCode` and returns
 * whether the answer verifies against `submittedPublicKey` -- i.e. whether
 * the key pair GROWI stored as pending is genuinely the one it just declared
 * to the proxy.
 */
const answerOwnershipChallenge = async (
  registrationCode: string,
  submittedPublicKey: JsonWebKey,
): Promise<boolean> => {
  const app = express();
  app.use(express.raw({ type: 'application/json', limit: '1mb' }));
  app.post(CHALLENGE_PATH, createPairingEndpoint());

  const challenge = genChallenge(3);
  const response = await request(app)
    .post(CHALLENGE_PATH)
    .set('content-type', 'application/json')
    .send(JSON.stringify({ registrationCode, challenge }));

  if (response.status !== 200) {
    return false;
  }
  return nodeVerify(
    null,
    Buffer.from(pairingChallengePayload(registrationCode, challenge), 'utf8'),
    createPublicKey({
      // Rebuilt field by field rather than passed through: the contract's
      // `JsonWebKey` (DOM-derived) has no index signature, which
      // `node:crypto`'s own `JsonWebKey` requires.
      key: {
        kty: submittedPublicKey.kty,
        crv: submittedPublicKey.crv,
        x: submittedPublicKey.x,
      },
      format: 'jwk',
    }),
    Buffer.from(response.body.challengeSignature, 'base64url'),
  );
};

interface FakeSubmit {
  readonly submit: (
    proxyUri: string,
    submission: PairingSubmission,
  ) => Promise<
    { ok: true; response: PairingResult } | { ok: false; reason: 'unreachable' }
  >;
  /** Recorded from inside the call, i.e. while the pending row must exist. */
  readonly seen: {
    submission?: PairingSubmission;
    proxyUri?: string;
    pendingRowExisted?: boolean;
    pendingKeyIdMatched?: boolean;
    challengeVerified?: boolean;
  };
}

/**
 * A stand-in for the proxy: while GROWI awaits step 3/6, it does what a real
 * proxy does in between -- calls back with an ownership challenge (step 4).
 */
const fakeSubmit = (
  result: PairingResult | 'unreachable',
  options: { readonly answerChallenge?: boolean } = {},
): FakeSubmit => {
  const seen: FakeSubmit['seen'] = {};
  return {
    seen,
    submit: async (proxyUri, submission) => {
      seen.proxyUri = proxyUri;
      seen.submission = submission;

      const pending = await ChatPendingPairing.findOne({
        registrationCode: submission.registrationCode,
      }).lean();
      seen.pendingRowExisted = pending != null;
      seen.pendingKeyIdMatched =
        pending?.ownKeyId === submission.publicKey.keyId;

      if (options.answerChallenge) {
        seen.challengeVerified = await answerOwnershipChallenge(
          submission.registrationCode,
          submission.publicKey.publicKeyJwk,
        );
      }

      return result === 'unreachable'
        ? { ok: false, reason: 'unreachable' }
        : { ok: true, response: result };
    },
  };
};

const pairedResult = (
  relationId: string,
  peerPublicKey: KeyObject,
): PairingResult => ({
  status: 'paired',
  relationId,
  workspace: {
    platform: PLATFORM,
    workspaceId: WORKSPACE_ID,
    workspaceName: 'Acme Workspace',
  },
  publicKey: {
    keyId: `proxy-key-${relationId}`,
    publicKeyJwk: asJwk(peerPublicKey),
    validFrom: new Date(Date.now() - 1000).toISOString(),
  },
});

let codeSeq = 0;
const nextRegistrationCode = (): string => {
  codeSeq += 1;
  return `registration-code-${codeSeq}`;
};

const submitWith = (
  result: PairingResult | 'unreachable',
  options: {
    readonly answerChallenge?: boolean;
    readonly registrationCode?: string;
  } = {},
): Promise<{ outcome: PairingOutcome; fake: FakeSubmit }> => {
  const fake = fakeSubmit(result, { answerChallenge: options.answerChallenge });
  return submitPairingRequest(
    {
      registrationCode: options.registrationCode ?? nextRegistrationCode(),
      proxyUri: PROXY_URI,
      growiUri: GROWI_URI,
      growiLabel: GROWI_LABEL,
      createdBy: new Types.ObjectId(),
    },
    { submit: fake.submit },
  ).then((outcome) => ({ outcome, fake }));
};

/** An already-unpaired relation for the workspace under test. */
const seedUnpairedRelation = (relationId: string, unpairedAt: Date) =>
  ChatRelation.create({
    relationId,
    proxyUri: PROXY_URI,
    platform: PLATFORM,
    workspaceId: WORKSPACE_ID,
    workspaceName: 'Acme Workspace',
    state: 'unpaired',
    unpairedAt,
    settingsVersion: 0,
  });

const seedLink = (
  relationId: string,
  accountId: string,
  linkedAt: Date,
  userId = new Types.ObjectId(),
) =>
  ChatAccountLink.create({
    relationId,
    userId,
    platform: PLATFORM,
    accountId,
    linkedAt,
  });

describe('pairing-service', () => {
  let mongod: MongoMemoryServer | undefined;
  const previousEnv = { ...process.env };

  beforeAll(async () => {
    ({ mongod } = await connectSelfContainedMongo(
      'growi_test_unit_pairing_service',
    ));
    // The composite unique index on chat_account_links is the reason the
    // collision branch exists at all, so the tests must run with it in place.
    await ChatAccountLink.syncIndexes();
    await ChatPendingPairing.syncIndexes();
    await ChatRelation.syncIndexes();
  });

  beforeEach(async () => {
    await Promise.all([
      ChatRelation.deleteMany({}),
      ChatAccountLink.deleteMany({}),
      ChatIntegrationKey.deleteMany({}),
      ChatPendingPairing.deleteMany({}),
      ChatChallengeAttempt.deleteMany({}),
      ChatChannelPermission.deleteMany({}),
      ChatNotificationDestination.deleteMany({}),
    ]);
    Object.assign(process.env, TEST_ENCRYPTION_KEY);
  });

  afterEach(() => {
    process.env = { ...previousEnv };
  });

  afterAll(async () => {
    await disconnectSelfContainedMongo(mongod);
  });

  describe('submitPairingRequest', () => {
    it('completes the round trip: the pending key answers the ownership challenge, then becomes the relation own key', async () => {
      const peer = peerKeyPair();
      const { outcome, fake } = await submitWith(
        pairedResult('relation-new', peer.publicKey),
        { answerChallenge: true },
      );

      expect(outcome.status).toBe('paired');

      // Step 3: the pending row -- with the SAME key that was declared --
      // must already exist while the proxy is calling back.
      expect(fake.seen.pendingRowExisted).toBe(true);
      expect(fake.seen.pendingKeyIdMatched).toBe(true);
      // Step 4/5: the signature the endpoint produced verifies against the
      // public key submitted in step 3.
      expect(fake.seen.challengeVerified).toBe(true);
      expect(fake.seen.proxyUri).toBe(PROXY_URI);
      expect(fake.seen.submission?.growiUri).toBe(GROWI_URI);
      expect(fake.seen.submission?.growiLabel).toBe(GROWI_LABEL);
      // Requirement 10.6: only the public half ever goes on the wire.
      expect(fake.seen.submission?.publicKey.publicKeyJwk).not.toHaveProperty(
        'd',
      );

      // Step 6: the relation is recorded with the workspace the proxy named.
      const relation = await ChatRelation.findOne({
        relationId: 'relation-new',
      }).lean();
      expect(relation).toMatchObject({
        relationId: 'relation-new',
        proxyUri: PROXY_URI,
        platform: PLATFORM,
        workspaceId: WORKSPACE_ID,
        workspaceName: 'Acme Workspace',
        state: 'active',
        settingsVersion: 0,
      });

      // The own key moved out of the pending row into the relation's keys,
      // and is usable for signing real requests (task 7.1's only key source).
      const ownKeys = await ChatIntegrationKey.find({
        relationId: 'relation-new',
        side: 'own',
      }).lean();
      expect(ownKeys).toHaveLength(1);
      expect(ownKeys[0]?.keyId).toBe(fake.seen.submission?.publicKey.keyId);
      const signed = await signWithOwnKey({
        relationId: 'relation-new',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: Buffer.from('{}', 'utf8'),
        expiresInSec: 60,
      });
      expect(signed.headers).toBeDefined();

      // The proxy's public key is stored as the peer side.
      const peerKeys = await ChatIntegrationKey.find({
        relationId: 'relation-new',
        side: 'peer',
      }).lean();
      expect(peerKeys).toHaveLength(1);
      expect(peerKeys[0]?.keyId).toBe('proxy-key-relation-new');

      // And the pending row is gone (design.md "保留の行は消す").
      expect(await ChatPendingPairing.countDocuments({})).toBe(0);
    });

    it('does not establish anything when the proxy answers `already-paired`, and says so distinguishably', async () => {
      const { outcome } = await submitWith({
        status: 'already-paired',
        detail: 'this GROWI is already paired with that workspace',
      });

      expect(outcome).toEqual({
        status: 'already-paired',
        detail: 'this GROWI is already paired with that workspace',
      });
      expect(await ChatRelation.countDocuments({})).toBe(0);
      expect(await ChatIntegrationKey.countDocuments({})).toBe(0);
      expect(await ChatPendingPairing.countDocuments({})).toBe(0);
    });

    it('refuses to establish a relation whose `relationId` this GROWI already knows, and tells the admin apart from a network failure', async () => {
      const peer = peerKeyPair();
      await ChatRelation.create({
        relationId: 'relation-existing',
        proxyUri: 'https://other-proxy.example.test',
        platform: PLATFORM,
        workspaceId: 'T-OTHER',
        workspaceName: 'Other Workspace',
        state: 'active',
        settingsVersion: 3,
      });

      const { outcome } = await submitWith(
        pairedResult('relation-existing', peer.publicKey),
      );

      expect(outcome).toEqual({
        status: 'relation-already-known',
        relationId: 'relation-existing',
      });
      // The pre-existing relation is untouched -- not repointed at the new
      // proxy, not re-keyed.
      const relation = await ChatRelation.findOne({
        relationId: 'relation-existing',
      }).lean();
      expect(relation?.proxyUri).toBe('https://other-proxy.example.test');
      expect(relation?.workspaceId).toBe('T-OTHER');
      expect(await ChatRelation.countDocuments({})).toBe(1);
      expect(await ChatIntegrationKey.countDocuments({})).toBe(0);
    });

    it('reports a transport failure as its own outcome and leaves no relation behind', async () => {
      const { outcome } = await submitWith('unreachable');

      expect(outcome).toEqual({ status: 'call-failed', reason: 'unreachable' });
      expect(await ChatRelation.countDocuments({})).toBe(0);
      expect(await ChatIntegrationKey.countDocuments({})).toBe(0);
    });

    it('refuses to start when the key-encryption environment variable is unset, without writing a pending row', async () => {
      process.env = { ...previousEnv };
      delete process.env.CHAT_INTEGRATION_KEY_ENCRYPTION_KEY;

      const { outcome, fake } = await submitWith(
        pairedResult('relation-never', peerKeyPair().publicKey),
      );

      expect(outcome).toEqual({ status: 'key-encryption-unconfigured' });
      expect(fake.seen.submission).toBeUndefined();
      expect(await ChatPendingPairing.countDocuments({})).toBe(0);
      expect(await ChatRelation.countDocuments({})).toBe(0);
    });

    it('retries with the same registration code without tripping its unique index', async () => {
      const code = nextRegistrationCode();
      const first = await submitWith('unreachable', {
        registrationCode: code,
      });
      expect(first.outcome.status).toBe('call-failed');

      const second = await submitWith(
        pairedResult('relation-retried', peerKeyPair().publicKey),
        { registrationCode: code, answerChallenge: true },
      );

      expect(second.outcome.status).toBe('paired');
      expect(second.fake.seen.challengeVerified).toBe(true);
      expect(await ChatPendingPairing.countDocuments({})).toBe(0);
    });
  });

  describe('unpairRelation (Requirement 9.7)', () => {
    it('keeps the relation row and the account links, and deletes only the keys, channel permissions and destinations', async () => {
      await ChatRelation.create({
        relationId: 'relation-a',
        proxyUri: PROXY_URI,
        platform: PLATFORM,
        workspaceId: WORKSPACE_ID,
        workspaceName: 'Acme Workspace',
        state: 'active',
        settingsVersion: 7,
      });
      await ChatIntegrationKey.create({
        relationId: 'relation-a',
        side: 'peer',
        keyId: 'peer-1',
        key: JSON.stringify(asJwk(peerKeyPair().publicKey)),
        validFrom: new Date(),
        revokedAt: null,
      });
      await ChatChannelPermission.create({
        relationId: 'relation-a',
        commandName: 'search',
        allowedChannels: ['C1'],
      });
      await ChatNotificationDestination.create({
        relationId: 'relation-a',
        platform: PLATFORM,
        channelId: 'C1',
        channelName: 'general',
        pathPattern: '/*',
        triggerEvents: ['pageCreate'],
      });
      await seedLink('relation-a', 'U1', new Date());

      const before = new Date();
      expect(await unpairRelation('relation-a')).toBe('unpaired');

      const relation = await ChatRelation.findOne({
        relationId: 'relation-a',
      }).lean();
      expect(relation?.state).toBe('unpaired');
      expect(relation?.workspaceId).toBe(WORKSPACE_ID);
      expect(relation?.unpairedAt?.getTime()).toBeGreaterThanOrEqual(
        before.getTime(),
      );

      expect(await ChatIntegrationKey.countDocuments({})).toBe(0);
      expect(await ChatChannelPermission.countDocuments({})).toBe(0);
      expect(await ChatNotificationDestination.countDocuments({})).toBe(0);
      // The links are what the next pairing inherits -- they must survive.
      expect(await ChatAccountLink.countDocuments({})).toBe(1);
    });

    it('reports an unknown relation rather than pretending it unpaired one', async () => {
      expect(await unpairRelation('relation-nope')).toBe('not-found');
    });
  });

  describe('account-link inheritance on re-pairing', () => {
    it('moves every account link of the unpaired relation to the new relationId (the task completion condition)', async () => {
      const first = await submitWith(
        pairedResult('relation-old', peerKeyPair().publicKey),
      );
      expect(first.outcome.status).toBe('paired');
      await seedLink('relation-old', 'U1', new Date('2026-01-01'));
      await seedLink('relation-old', 'U2', new Date('2026-01-02'));
      await seedLink('relation-old', 'U3', new Date('2026-01-03'));
      await unpairRelation('relation-old');

      const { outcome } = await submitWith(
        pairedResult('relation-new', peerKeyPair().publicKey),
      );

      expect(outcome).toMatchObject({
        status: 'paired',
        relationId: 'relation-new',
        inheritance: {
          inheritedFrom: 'relation-old',
          movedCount: 3,
          discardedCount: 0,
        },
      });
      const moved = await ChatAccountLink.find({
        relationId: 'relation-new',
      }).lean();
      expect(moved.map((l) => l.accountId).sort()).toEqual(['U1', 'U2', 'U3']);
      expect(
        await ChatAccountLink.countDocuments({ relationId: 'relation-old' }),
      ).toBe(0);
      // Deleting the emptied-out relation row is the 90-day cleanup's job
      // (task 8.2), NOT this one's.
      expect(
        await ChatRelation.countDocuments({ relationId: 'relation-old' }),
      ).toBe(1);
    });

    it('inherits from the most recently unpaired relation when several match the same workspace', async () => {
      // Seeded directly rather than through two pair/unpair cycles: a real
      // second pairing would already have inherited the first generation's
      // links, so there would be nothing left to prove about the ordering.
      await seedUnpairedRelation('relation-older', new Date('2026-01-10'));
      await seedLink('relation-older', 'OLD', new Date('2026-01-01'));
      await seedUnpairedRelation('relation-newer', new Date('2026-02-10'));
      await seedLink('relation-newer', 'NEW', new Date('2026-02-01'));

      const { outcome } = await submitWith(
        pairedResult('relation-fresh', peerKeyPair().publicKey),
      );

      expect(outcome).toMatchObject({
        status: 'paired',
        inheritance: { inheritedFrom: 'relation-newer', movedCount: 1 },
      });
      const links = await ChatAccountLink.find({
        relationId: 'relation-fresh',
      }).lean();
      expect(links.map((l) => l.accountId)).toEqual(['NEW']);
      // The older relation's link is left where it was, not merged in.
      expect(
        await ChatAccountLink.countDocuments({ relationId: 'relation-older' }),
      ).toBe(1);
    });

    it('keeps the newer of two colliding links for the same (platform, accountId) and drops the older one', async () => {
      await submitWith(pairedResult('relation-old', peerKeyPair().publicKey));
      await unpairRelation('relation-old');

      // The old relation's link is the NEWER of the two.
      await seedLink('relation-old', 'DUP', new Date('2026-03-01'));
      // Someone already re-linked manually under the relationId the proxy is
      // about to hand back.
      const alreadyRelinked = await seedLink(
        'relation-new',
        'DUP',
        new Date('2026-01-01'),
      );

      const { outcome } = await submitWith(
        pairedResult('relation-new', peerKeyPair().publicKey),
      );

      expect(outcome).toMatchObject({
        status: 'paired',
        inheritance: { movedCount: 1, discardedCount: 1 },
      });
      const survivors = await ChatAccountLink.find({
        platform: PLATFORM,
        accountId: 'DUP',
      }).lean();
      expect(survivors).toHaveLength(1);
      expect(survivors[0]?.relationId).toBe('relation-new');
      expect(survivors[0]?.linkedAt).toEqual(new Date('2026-03-01'));
      expect(survivors[0]?._id.toString()).not.toBe(
        alreadyRelinked._id.toString(),
      );
    });

    it('keeps the already-relinked row when it is the newer of the two', async () => {
      await submitWith(pairedResult('relation-old', peerKeyPair().publicKey));
      await unpairRelation('relation-old');

      await seedLink('relation-old', 'DUP', new Date('2026-01-01'));
      const alreadyRelinked = await seedLink(
        'relation-new',
        'DUP',
        new Date('2026-03-01'),
      );

      const { outcome } = await submitWith(
        pairedResult('relation-new', peerKeyPair().publicKey),
      );

      expect(outcome).toMatchObject({
        status: 'paired',
        inheritance: { movedCount: 0, discardedCount: 1 },
      });
      const survivors = await ChatAccountLink.find({
        platform: PLATFORM,
        accountId: 'DUP',
      }).lean();
      expect(survivors).toHaveLength(1);
      expect(survivors[0]?._id.toString()).toBe(alreadyRelinked._id.toString());
    });

    it('inherits nothing when no unpaired relation matches the same platform and workspace', async () => {
      // An unpaired relation for a DIFFERENT workspace, with links of its own.
      await ChatRelation.create({
        relationId: 'relation-elsewhere',
        proxyUri: PROXY_URI,
        platform: PLATFORM,
        workspaceId: 'T-SOMEWHERE-ELSE',
        workspaceName: 'Other Workspace',
        state: 'unpaired',
        unpairedAt: new Date(),
        settingsVersion: 0,
      });
      await seedLink('relation-elsewhere', 'X1', new Date());

      const { outcome } = await submitWith(
        pairedResult('relation-first', peerKeyPair().publicKey),
      );

      expect(outcome).toMatchObject({
        status: 'paired',
        inheritance: {
          inheritedFrom: null,
          movedCount: 0,
          discardedCount: 0,
        },
      });
      expect(
        await ChatAccountLink.countDocuments({
          relationId: 'relation-elsewhere',
        }),
      ).toBe(1);
      expect(
        await ChatAccountLink.countDocuments({ relationId: 'relation-first' }),
      ).toBe(0);
    });

    it('does not inherit from a still-active relation of the same workspace', async () => {
      await submitWith(
        pairedResult('relation-active', peerKeyPair().publicKey),
      );
      await seedLink('relation-active', 'LIVE', new Date());

      const { outcome } = await submitWith(
        pairedResult('relation-second', peerKeyPair().publicKey),
      );

      expect(outcome).toMatchObject({
        status: 'paired',
        inheritance: { inheritedFrom: null, movedCount: 0 },
      });
      expect(
        await ChatAccountLink.countDocuments({ relationId: 'relation-active' }),
      ).toBe(1);
    });
  });
});
