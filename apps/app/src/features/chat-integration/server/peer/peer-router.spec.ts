// Proves task 3.5's completion condition literally: the 5 signed entry
// points pass a validly-signed request through `signatureGuard` (task 3.2)
// to their handler, and are refused when the signature does not check out;
// the 6th (`pairing/challenge`) is reachable WITHOUT a signature, per its
// own already-tested rules (task 3.4). Also proves `settings-pull` returns
// real data, and that all 6 mount points are exactly what design.md's op
// table specifies (a path typo must not reach any handler).

import { generateKeyPairSync } from 'node:crypto';
import { OP_ENDPOINTS, OP_NAMES, RESPONSE_KINDS } from '@growi/chat';
import { DEFAULT_EXPIRES_IN_SEC, sign } from '@growi/chat/server';
import type { Express } from 'express';
import express from 'express';
import type { MongoMemoryServer } from 'mongodb-memory-server-core';
import mongoose from 'mongoose';
import request from 'supertest';
import { vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

import {
  connectSelfContainedMongo,
  disconnectSelfContainedMongo,
} from '^/test/setup/mongo/self-contained-connection';

import type Crowi from '~/server/crowi';
import userModelFactory from '~/server/models/user';
import { growiInfoService } from '~/server/service/growi-info';

import { ChatAccountLink } from '../account-link/models/chat-account-link';
import { ChatAccountLinkOrder } from '../account-link/models/chat-account-link-order';
import { CHAT_INTEGRATION_PEER_PREFIX } from '../consts';
import { buildHelpContent } from '../content';
import { createChatIntegrationRouter } from '../index';
import { resolvePeerKey, storePeerKey } from '../keys';
import type { ChatKeyEncryptionEnv } from '../keys/key-encryption';
import { encryptChatKeyForStorage } from '../keys/key-encryption';
import { ChatIntegrationKey } from '../keys/models/chat-integration-key';
import { ChatProcessedRequest } from '../models/chat-processed-request';
import { ChatRelation } from '../models/chat-relation';
import { ChatRequestNonce } from '../models/chat-request-nonce';
import { ChatChallengeAttempt } from '../pairing/models/chat-challenge-attempt';
import { ChatPendingPairing } from '../pairing/models/pending-pairing';
import { ChatChannelPermission } from '../settings/models/chat-channel-permission';

/**
 * `command`'s handler (task 5.1) needs a `Crowi` instance -- `help` (the
 * kind every fixture below uses) never touches any of its services, so an
 * auto-stubbed mock is enough to prove the wiring without faking search/ACL
 * behavior this file has no business asserting on.
 */
const buildMockCrowi = (): Crowi => mock<Crowi>();

const JSON_CONTENT_TYPE = 'application/json';
const MOUNT_PATH = '/_api/v3/chat-integration';
const RELATION_ID = 'relation-under-test';
const KEY_ID = 'peer-key-0001';

/** A clearly-fake 32-byte value; the tests only need AES-256 to accept it. */
const TEST_ENCRYPTION_KEY: ChatKeyEncryptionEnv = {
  CHAT_INTEGRATION_KEY_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
};

const peerKeyPair = generateKeyPairSync('ed25519');
/** A key pair GROWI never registered -- signs bytes that must not check out. */
const rogueKeyPair = generateKeyPairSync('ed25519');

/**
 * An app shaped like the real one: `express.raw` under the peer prefix
 * (`server/crowi/express-init.js`, task 2.1), the app-wide urlencoded parser
 * behind it, and the ACTUAL production router from `server/index.ts`/
 * `peer-router.ts` -- not a re-implementation.
 */
const buildApp = (): Express => {
  const app = express();
  app.use(
    CHAT_INTEGRATION_PEER_PREFIX,
    express.raw({ type: JSON_CONTENT_TYPE, limit: '10mb' }),
  );
  app.use(express.urlencoded({ extended: true }));
  app.use(MOUNT_PATH, createChatIntegrationRouter(buildMockCrowi()));
  return app;
};

const signedPost = (
  app: Express,
  path: string,
  bodyText: string,
  options: {
    readonly signedWith?: ReturnType<typeof generateKeyPairSync>['privateKey'];
  } = {},
) => {
  const bytes = Buffer.from(bodyText, 'utf8');
  const result = sign({
    method: 'POST',
    headers: { 'content-type': JSON_CONTENT_TYPE },
    body: bytes,
    key: { relationId: RELATION_ID, keyId: KEY_ID },
    privateKey: options.signedWith ?? peerKeyPair.privateKey,
    expiresInSec: DEFAULT_EXPIRES_IN_SEC,
  });

  const agent = request(app).post(path);
  agent.set('content-type', JSON_CONTENT_TYPE);
  for (const [name, value] of Object.entries(result.headers)) {
    agent.set(name, value);
  }
  return agent.send(bodyText);
};

/** Full request path (from the app root), derived from `OP_ENDPOINTS` --
 * not hand-written, so this test cannot silently drift from the mount
 * points `peer-router.ts` itself derives the same way. */
const pathFor = (op: keyof typeof OP_NAMES): string => {
  const template = OP_ENDPOINTS[OP_NAMES[op]].pathTemplate;
  return template.replace('{growiUri}', '');
};

const commandBody = JSON.stringify({
  relationId: RELATION_ID,
  op: OP_NAMES.command,
  requestId: 'req-0001',
  actor: { platform: 'slack', accountId: 'U0001', displayName: 'Alice' },
  channel: {
    platform: 'slack',
    channelId: 'C0001',
    channelName: 'general',
    isPrivate: false,
  },
  kind: 'help',
});

const accountLinkStartBody = JSON.stringify({
  relationId: RELATION_ID,
  op: OP_NAMES.accountLinkStart,
  actor: { platform: 'slack', accountId: 'U0001', displayName: 'Alice' },
});

const settingsPullBody = JSON.stringify({
  relationId: RELATION_ID,
  op: OP_NAMES.settingsPull,
});

const newKeyJwk = generateKeyPairSync('ed25519').publicKey.export({
  format: 'jwk',
});

const keyRegisterBody = JSON.stringify({
  relationId: RELATION_ID,
  op: OP_NAMES.keyRegisterToGrowi,
  key: {
    keyId: 'peer-key-0002',
    publicKeyJwk: newKeyJwk,
    validFrom: new Date().toISOString(),
  },
});

const keyRevokeBody = JSON.stringify({
  relationId: RELATION_ID,
  op: OP_NAMES.keyRevokeToGrowi,
  keyId: 'peer-key-0002',
});

/** Every signed op this task wires, paired with a validly-shaped body. */
const SIGNED_CASES: ReadonlyArray<{
  readonly op: keyof typeof OP_NAMES;
  readonly body: string;
}> = [
  { op: 'command', body: commandBody },
  { op: 'keyRegisterToGrowi', body: keyRegisterBody },
  { op: 'keyRevokeToGrowi', body: keyRevokeBody },
  { op: 'settingsPull', body: settingsPullBody },
  { op: 'accountLinkStart', body: accountLinkStartBody },
];

describe('peer-router (task 3.5 -- the 6 entry points, wired for real)', () => {
  let mongod: MongoMemoryServer | undefined;
  const previousEnv = { ...process.env };
  let app: Express;

  beforeAll(async () => {
    ({ mongod } = await connectSelfContainedMongo(
      'growi_test_unit_peer_router',
    ));
    await ChatRequestNonce.init();
    // The User model is normally registered at boot by crowi; the factory
    // accepts a null crowi and only touches crowi from functions this spec
    // never calls (see `resolve-actor.spec.ts`'s identical use).
    userModelFactory(null);
  });

  beforeEach(async () => {
    app = buildApp();
    Object.assign(process.env, TEST_ENCRYPTION_KEY);
    await ChatRequestNonce.deleteMany({});
    await ChatIntegrationKey.deleteMany({});
    await ChatRelation.deleteMany({});
    await ChatChannelPermission.deleteMany({});
    await ChatPendingPairing.deleteMany({});
    await ChatChallengeAttempt.deleteMany({});
    await ChatProcessedRequest.deleteMany({});
    await ChatAccountLink.deleteMany({});
    await ChatAccountLinkOrder.deleteMany({});

    // `accountLinkStart`'s real handler (task 6.1) calls
    // `buildAccountLinkUrl` -> `growiInfoService.getSiteUrl()`, which reads
    // `configManager` -- unloaded in this standalone test app (no full Crowi
    // boot). Stubbed the same way `buildMockCrowi()` stubs the rest of
    // `Crowi`'s services this file has no business asserting on.
    vi.spyOn(growiInfoService, 'getSiteUrl').mockReturnValue(
      'https://growi.example.test',
    );

    await storePeerKey(
      { relationId: RELATION_ID, keyId: KEY_ID },
      peerKeyPair.publicKey.export({ format: 'jwk' }),
    );
    await ChatRelation.create({
      relationId: RELATION_ID,
      proxyUri: 'https://proxy.example.test',
      platform: 'slack',
      workspaceId: 'workspace-0001',
      workspaceName: 'Test Workspace',
      label: null,
      state: 'active',
      settingsVersion: 7,
      createdAt: new Date(),
    });
  });

  afterEach(() => {
    process.env = { ...previousEnv };
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await disconnectSelfContainedMongo(mongod);
  });

  describe('the 5 signed entry points', () => {
    it.each(
      SIGNED_CASES,
    )('$op: a validly-signed request reaches its handler (passes signatureGuard)', async ({
      op,
      body,
    }) => {
      const response = await signedPost(app, pathFor(op), body);
      expect(response.status).toBe(200);
    });

    it.each(
      SIGNED_CASES,
    )('$op: a request signed with a key GROWI never registered is refused', async ({
      op,
      body,
    }) => {
      const response = await signedPost(app, pathFor(op), body, {
        signedWith: rogueKeyPair.privateKey,
      });
      expect(response.status).toBe(401);
    });

    it.each(SIGNED_CASES)('$op: an unsigned request is refused', async ({
      op,
      body,
    }) => {
      const response = await request(app)
        .post(pathFor(op))
        .set('content-type', JSON_CONTENT_TYPE)
        .send(body);
      expect(response.status).toBe(401);
    });
  });

  describe('settings-pull', () => {
    it('returns the real settingsVersion and channel permissions for the relation, not a stub', async () => {
      await ChatChannelPermission.create([
        {
          relationId: RELATION_ID,
          commandName: 'search',
          allowedChannels: ['C0001', 'C0002'],
        },
        {
          relationId: RELATION_ID,
          commandName: 'help',
          allowedChannels: [],
        },
      ]);

      const response = await signedPost(
        app,
        pathFor('settingsPull'),
        settingsPullBody,
      );

      expect(response.status).toBe(200);
      expect(response.body.version).toBe(7);
      expect(response.body.settings.relationId).toBe(RELATION_ID);
      expect(response.body.settings.channelPermissions).toEqual(
        expect.arrayContaining([
          {
            commandName: 'search',
            allowedChannels: ['C0001', 'C0002'],
          },
          { commandName: 'help', allowedChannels: [] },
        ]),
      );
    });

    it.each([
      'all',
      'none',
    ] as const)("answers allowedChannels '%s' when that is what is stored", async (channelScope) => {
      // The admin screen (task 9.2) can save "allowed in every channel" /
      // "allowed in no channel", and the proxy's own permission judgement
      // (`judge()` in @growi/chat) only distinguishes them from an
      // explicit list if they survive this response unchanged.
      await ChatChannelPermission.create({
        relationId: RELATION_ID,
        commandName: 'create-page',
        channelScope,
        allowedChannels: [],
      });

      const response = await signedPost(
        app,
        pathFor('settingsPull'),
        settingsPullBody,
      );

      expect(response.status).toBe(200);
      expect(response.body.settings.channelPermissions).toEqual([
        { commandName: 'create-page', allowedChannels: channelScope },
      ]);
    });

    it('reflects a version bump and updated permission rows on the next pull', async () => {
      await ChatRelation.updateOne(
        { relationId: RELATION_ID },
        { $set: { settingsVersion: 8 } },
      );
      await ChatChannelPermission.create({
        relationId: RELATION_ID,
        commandName: 'keep',
        allowedChannels: ['C0003'],
      });

      const response = await signedPost(
        app,
        pathFor('settingsPull'),
        settingsPullBody,
      );

      expect(response.status).toBe(200);
      expect(response.body.version).toBe(8);
      expect(response.body.settings.channelPermissions).toEqual([
        { commandName: 'keep', allowedChannels: ['C0003'] },
      ]);
    });
  });

  describe('command (task 5.1 -- real behavior, not a stub)', () => {
    it('answers a real help response, proving the wiring reaches command-endpoint.ts', async () => {
      const response = await signedPost(app, pathFor('command'), commandBody);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        kind: RESPONSE_KINDS.help,
        commands: buildHelpContent(),
      });
    });
  });

  describe('account-link-start (task 6.1 -- real behavior, not a stub)', () => {
    it('issues a one-time link, reusing task 5.1’s findOrCreatePendingAccountLinkOrder on a second call', async () => {
      const first = await signedPost(
        app,
        pathFor('accountLinkStart'),
        accountLinkStartBody,
      );
      expect(first.status).toBe(200);
      expect(first.body.status).toBe('link-issued');
      expect(typeof first.body.linkUrl).toBe('string');
      expect(await ChatAccountLinkOrder.countDocuments({})).toBe(1);

      // A second start for the same actor reuses the still-pending order --
      // it must NOT multiply one-time links (design.md's dedup rule, and
      // task 5.1's `findOrCreatePendingAccountLinkOrder`, reused unmodified).
      const second = await signedPost(
        app,
        pathFor('accountLinkStart'),
        accountLinkStartBody,
      );
      expect(second.status).toBe(200);
      expect(second.body.linkUrl).toBe(first.body.linkUrl);
      expect(await ChatAccountLinkOrder.countDocuments({})).toBe(1);
    });

    it('answers already-linked with the linked user’s username when the chat account is already linked', async () => {
      const linkedUser = await mongoose.model('User').create({
        name: 'Linked User',
        username: 'linked-user',
        email: 'linked-user@example.test',
      });

      await ChatAccountLink.create({
        relationId: RELATION_ID,
        userId: linkedUser._id,
        platform: 'slack',
        accountId: 'U0001',
        linkedAt: new Date(),
      });

      const response = await signedPost(
        app,
        pathFor('accountLinkStart'),
        accountLinkStartBody,
      );

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        status: 'already-linked',
        growiUserName: 'linked-user',
      });
      // No pending order should be created when already linked.
      expect(await ChatAccountLinkOrder.countDocuments({})).toBe(0);

      await mongoose.model('User').deleteOne({ _id: linkedUser._id });
    });
  });

  describe('key-register-to-growi / key-revoke-to-growi (task 7.2 -- real behavior, not a placeholder)', () => {
    /** Signs as an explicit `(keyId, privateKey)` pair, unlike `signedPost`
     * (which always signs as `KEY_ID`/`peerKeyPair`) -- these tests need to
     * sign as a SECOND peer key once the first one has been revoked. */
    const signedPostAs = (
      path: string,
      bodyText: string,
      keyId: string,
      privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'],
    ) => {
      const bytes = Buffer.from(bodyText, 'utf8');
      const result = sign({
        method: 'POST',
        headers: { 'content-type': JSON_CONTENT_TYPE },
        body: bytes,
        key: { relationId: RELATION_ID, keyId },
        privateKey,
        expiresInSec: DEFAULT_EXPIRES_IN_SEC,
      });
      const agent = request(app).post(path);
      agent.set('content-type', JSON_CONTENT_TYPE);
      for (const [name, value] of Object.entries(result.headers)) {
        agent.set(name, value);
      }
      return agent.send(bodyText);
    };

    const buildKeyRegisterBody = (key: {
      readonly keyId: string;
      readonly publicKeyJwk: unknown;
      readonly validFrom: string;
    }) =>
      JSON.stringify({
        relationId: RELATION_ID,
        op: OP_NAMES.keyRegisterToGrowi,
        key,
      });

    const buildKeyRevokeBody = (keyId: string) =>
      JSON.stringify({
        relationId: RELATION_ID,
        op: OP_NAMES.keyRevokeToGrowi,
        keyId,
      });

    it('registers a new peer key; the SAME registration a second time is a no-op success, not an error', async () => {
      const newPair = generateKeyPairSync('ed25519');
      const body = buildKeyRegisterBody({
        keyId: 'peer-key-added',
        publicKeyJwk: newPair.publicKey.export({ format: 'jwk' }),
        validFrom: new Date().toISOString(),
      });

      const first = await signedPost(app, pathFor('keyRegisterToGrowi'), body);
      expect(first.status).toBe(200);
      expect(first.body).toEqual({ status: 'ok' });
      expect(
        await resolvePeerKey({
          relationId: RELATION_ID,
          keyId: 'peer-key-added',
        }),
      ).not.toBeNull();

      const second = await signedPost(app, pathFor('keyRegisterToGrowi'), body);
      expect(second.status).toBe(200);
      expect(second.body).toEqual({ status: 'ok' });
      expect(
        await ChatIntegrationKey.countDocuments({
          relationId: RELATION_ID,
          side: 'peer',
          keyId: 'peer-key-added',
        }),
      ).toBe(1);
    });

    it('revoking the LAST valid peer key is refused with would-leave-no-valid-key, and the key stays valid', async () => {
      // beforeEach registers only KEY_ID as a peer key -- revoking it would
      // leave zero currently-valid peer keys for this relation.
      const body = buildKeyRevokeBody(KEY_ID);

      const response = await signedPost(app, pathFor('keyRevokeToGrowi'), body);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        status: 'rejected',
        reason: 'would-leave-no-valid-key',
      });
      expect(
        await resolvePeerKey({ relationId: RELATION_ID, keyId: KEY_ID }),
      ).not.toBeNull();
    });

    it('revoking one of two valid peer keys succeeds; revoking the same (now-revoked) key again is a no-op success', async () => {
      const secondPair = generateKeyPairSync('ed25519');
      await storePeerKey(
        { relationId: RELATION_ID, keyId: 'peer-key-second' },
        secondPair.publicKey.export({ format: 'jwk' }),
      );

      const revokeBody = buildKeyRevokeBody(KEY_ID);
      const first = await signedPostAs(
        pathFor('keyRevokeToGrowi'),
        revokeBody,
        KEY_ID,
        peerKeyPair.privateKey,
      );
      expect(first.status).toBe(200);
      expect(first.body).toEqual({ status: 'ok' });
      expect(
        await resolvePeerKey({ relationId: RELATION_ID, keyId: KEY_ID }),
      ).toBeNull();

      // KEY_ID is now revoked, so the retry must sign as the SURVIVING key.
      const second = await signedPostAs(
        pathFor('keyRevokeToGrowi'),
        revokeBody,
        'peer-key-second',
        secondPair.privateKey,
      );
      expect(second.status).toBe(200);
      expect(second.body).toEqual({ status: 'ok' });
    });

    it('rejects revoking an unknown keyId with unknown-key', async () => {
      const body = buildKeyRevokeBody('no-such-peer-key');

      const response = await signedPost(app, pathFor('keyRevokeToGrowi'), body);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        status: 'rejected',
        reason: 'unknown-key',
      });
    });
  });

  describe('pairing/challenge (the one unsigned entry point)', () => {
    const PAIRING_PATH = '/peer/pairing/challenge';

    const insertPendingPairing = async (): Promise<{
      readonly registrationCode: string;
    }> => {
      const registrationCode = `code-${new mongoose.Types.ObjectId().toHexString()}`;
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
        expiresAt: new Date(Date.now() + 10 * 60_000),
      });

      return { registrationCode };
    };

    it('answers a live pending pairing WITHOUT any signature -- signatureGuard is not in front of it', async () => {
      const { registrationCode } = await insertPendingPairing();
      const challenge = Buffer.alloc(32, 1).toString('base64url');

      const response = await request(app)
        .post(`${MOUNT_PATH}${PAIRING_PATH}`)
        .set('content-type', JSON_CONTENT_TYPE)
        // No RFC 9421 signature headers at all -- if this were behind
        // signatureGuard it would be refused for `unsupported-media-type`
        // or a missing signature; instead it is judged by pairingEndpoint's
        // own rules (a matching, unexpired pending registration code).
        .send(JSON.stringify({ registrationCode, challenge }));

      expect(response.status).toBe(200);
      expect(response.body.challenge).toBe(challenge);
      expect(typeof response.body.challengeSignature).toBe('string');
    });

    it('refuses (401, not signature-guard-shaped) when no pending pairing matches', async () => {
      const challenge = Buffer.alloc(32, 2).toString('base64url');

      const response = await request(app)
        .post(`${MOUNT_PATH}${PAIRING_PATH}`)
        .set('content-type', JSON_CONTENT_TYPE)
        .send(JSON.stringify({ registrationCode: 'no-such-code', challenge }));

      expect(response.status).toBe(401);
    });
  });

  describe('mount points are exactly design.md’s 6 paths', () => {
    it('does not match a merely similar path', async () => {
      const response = await signedPost(
        app,
        `${pathFor('settingsPull')}-typo`,
        settingsPullBody,
      );
      expect(response.status).toBe(404);
    });

    it('does not match the feature base path with no sub-path', async () => {
      const response = await request(app)
        .post(MOUNT_PATH)
        .set('content-type', JSON_CONTENT_TYPE)
        .send('{}');
      expect(response.status).toBe(404);
    });
  });
});
