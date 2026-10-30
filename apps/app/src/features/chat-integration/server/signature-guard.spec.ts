import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import {
  OP_ENDPOINTS,
  OP_NAMES,
  type OpName,
  type RequestEnvelope,
} from '@growi/chat';
import {
  DEFAULT_EXPIRES_IN_SEC,
  MAX_ACCEPTED_EXPIRES_IN_SEC,
  sign,
} from '@growi/chat/server';
import type { Express } from 'express';
import express from 'express';
import type { MongoMemoryServer } from 'mongodb-memory-server-core';
import request from 'supertest';

import {
  connectSelfContainedMongo,
  disconnectSelfContainedMongo,
} from '^/test/setup/mongo/self-contained-connection';

import { CHAT_INTEGRATION_PEER_PREFIX } from './consts';
import { storePeerKey } from './keys';
import { ChatIntegrationKey } from './keys/models/chat-integration-key';
import { ChatRequestNonce } from './models/chat-request-nonce';
import {
  INBOUND_PEER_OPS,
  type InboundPeerOp,
  type InboundRequestContext,
  type RefusalKind,
  signatureGuard,
  type VerifiedPeerRequest,
} from './signature-guard';

const RELATION_ID = 'relation-under-test';
const OTHER_RELATION_ID = 'another-relation';
const KEY_ID = 'peer-key-0001';
const JSON_CONTENT_TYPE = 'application/json';

const peerKeyPair = generateKeyPairSync('ed25519');
/** A key pair GROWI never registered -- signs bytes that must not check out. */
const rogueKeyPair = generateKeyPairSync('ed25519');

type RecordFailure = (
  failure: RefusalKind,
  ctx: InboundRequestContext,
) => Promise<void>;

type Harness = {
  readonly app: Express;
  readonly path: string;
  readonly recordFailure: ReturnType<typeof vi.fn<RecordFailure>>;
};

/**
 * An app shaped like the real one: `express.raw` under the peer prefix (what
 * `express-init.js` registers, task 2.1) and the app-wide urlencoded parsing
 * behind it, so a request whose `content-type` is not JSON reaches the guard
 * as a plain object exactly as it does in production.
 */
const buildHarness = (op: InboundPeerOp): Harness => {
  const app = express();
  app.use(
    CHAT_INTEGRATION_PEER_PREFIX,
    express.raw({ type: JSON_CONTENT_TYPE, limit: '10mb' }),
  );
  app.use(express.urlencoded({ extended: true }));

  const recordFailure = vi.fn<RecordFailure>(async () => {});
  const path = `${CHAT_INTEGRATION_PEER_PREFIX}/under-test`;

  app.post(path, signatureGuard(op, { recordFailure }), (req, res) => {
    const { chatPeer } = req as VerifiedPeerRequest<InboundPeerOp>;
    // Every op's checked body is an envelope, whichever op this harness was
    // built for -- asserted by the annotation, not by a cast.
    const envelope: RequestEnvelope = chatPeer.body;
    res.status(200).json({
      verifiedRelationId: chatPeer.key.relationId,
      verifiedKeyId: chatPeer.key.keyId,
      bodyRelationId: envelope.relationId,
      bodyOp: envelope.op,
    });
  });

  return { app, path, recordFailure };
};

type SignedRequest = {
  readonly bytes: Buffer;
  readonly headers: Readonly<Record<string, string>>;
};

const signRequest = (
  bodyText: string,
  options: {
    readonly relationId?: string;
    readonly keyId?: string;
    readonly expiresInSec?: number;
    /** A key the receiving side does not hold, to produce a signature that does not check out. */
    readonly signedWith?: KeyObject;
  } = {},
): SignedRequest => {
  const bytes = Buffer.from(bodyText, 'utf8');
  const result = sign({
    method: 'POST',
    headers: { 'content-type': JSON_CONTENT_TYPE },
    body: bytes,
    key: {
      relationId: options.relationId ?? RELATION_ID,
      keyId: options.keyId ?? KEY_ID,
    },
    privateKey: options.signedWith ?? peerKeyPair.privateKey,
    expiresInSec: options.expiresInSec ?? DEFAULT_EXPIRES_IN_SEC,
  });

  return {
    bytes,
    headers: { 'content-type': JSON_CONTENT_TYPE, ...result.headers },
  };
};

/**
 * The body goes out as text, not as a `Buffer`: superagent JSON-serializes a
 * `Buffer` (`{"type":"Buffer","data":[...]}`), which would mean the bytes
 * under test never reach the guard. A utf-8 string is sent through unchanged.
 */
const post = (harness: Harness, signed: SignedRequest, bytes?: Buffer) => {
  const agent = request(harness.app).post(harness.path);
  for (const [name, value] of Object.entries(signed.headers)) {
    agent.set(name, value);
  }
  return agent.send((bytes ?? signed.bytes).toString('utf8'));
};

const refusalsOf = (harness: Harness): ReadonlyArray<RefusalKind> =>
  harness.recordFailure.mock.calls.map(([failure]) => failure);

describe('signature-guard', () => {
  let mongod: MongoMemoryServer | undefined;

  beforeAll(async () => {
    ({ mongod } = await connectSelfContainedMongo(
      'growi_test_unit_signature_guard',
    ));
    // `schema.index()` only declares the unique index; without this the
    // replay test's second insert can succeed and the test would pass while
    // checking nothing.
    await ChatRequestNonce.init();
  });

  beforeEach(async () => {
    await ChatRequestNonce.deleteMany({});
    await ChatIntegrationKey.deleteMany({});
    await storePeerKey(
      { relationId: RELATION_ID, keyId: KEY_ID },
      peerKeyPair.publicKey.export({ format: 'jwk' }),
    );
  });

  afterAll(async () => {
    await disconnectSelfContainedMongo(mongod);
  });

  it('has the unique index the replay guard depends on', async () => {
    const indexes = await ChatRequestNonce.collection.indexes();
    const unique = indexes.find(
      (index) =>
        index.unique === true &&
        JSON.stringify(index.key) ===
          JSON.stringify({ relationId: 1, keyId: 1, nonce: 1 }),
    );
    expect(unique).toBeDefined();
  });

  it('declares a check function for exactly the ops the proxy sends to GROWI', () => {
    const inboundOps = Object.values(OP_ENDPOINTS)
      .filter((endpoint) => endpoint.direction === 'proxy-to-growi')
      .map((endpoint) => endpoint.op);

    expect([...INBOUND_PEER_OPS].sort()).toEqual([...inboundOps].sort());
  });

  it('refuses to be wired to an op the proxy does not send to GROWI', () => {
    // `signatureGuard`'s parameter type already rules this out at compile
    // time; the cast is what a JavaScript caller (or a later refactor that
    // widens the type) would do by accident, and the factory must fail then
    // rather than serve 500s on every request.
    expect(() =>
      signatureGuard(OP_NAMES.notification as InboundPeerOp),
    ).toThrow(OP_NAMES.notification);
  });

  describe('a validly-signed request', () => {
    it('passes the verified key and the parsed body to the endpoint', async () => {
      const harness = buildHarness(OP_NAMES.settingsPull);
      const signed = signRequest(
        JSON.stringify({ relationId: RELATION_ID, op: OP_NAMES.settingsPull }),
      );

      const response = await post(harness, signed);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        verifiedRelationId: RELATION_ID,
        verifiedKeyId: KEY_ID,
        bodyRelationId: RELATION_ID,
        bodyOp: OP_NAMES.settingsPull,
      });
      expect(harness.recordFailure).not.toHaveBeenCalled();
    });
  });

  describe('the bytes that arrived are what gets verified', () => {
    it('refuses the same logical body re-serialized with its keys in another order', async () => {
      const harness = buildHarness(OP_NAMES.settingsPull);

      // Same logical content, different byte sequence. Both halves of this
      // are asserted below: if the two texts happened to be identical, or to
      // mean different things, this test would prove nothing.
      const asSent = `{"relationId":"${RELATION_ID}","op":"${OP_NAMES.settingsPull}"}`;
      const reordered = JSON.stringify({
        op: OP_NAMES.settingsPull,
        relationId: RELATION_ID,
      });
      expect(reordered).not.toBe(asSent);
      expect(JSON.parse(reordered)).toEqual(JSON.parse(asSent));

      const signed = signRequest(asSent);

      const response = await post(harness, signed, Buffer.from(reordered));

      expect(response.status).toBe(401);
      // The signature covers the *value* of `content-digest`, so reordering
      // the bytes leaves the signature itself intact -- the refusal comes
      // from re-hashing the bytes that actually arrived, which is exactly
      // the property this task requires.
      expect(refusalsOf(harness)).toEqual(['digest-mismatch']);
    });

    it('accepts the very same bytes when they arrive unchanged', async () => {
      const harness = buildHarness(OP_NAMES.settingsPull);
      const asSent = `{"relationId":"${RELATION_ID}","op":"${OP_NAMES.settingsPull}"}`;

      const response = await post(harness, signRequest(asSent));

      expect(response.status).toBe(200);
    });

    it('accepts a legitimate peer whose bytes are not the canonical re-serialization', async () => {
      const harness = buildHarness(OP_NAMES.settingsPull);
      // Pretty-printed, same value as the reordering test's "asSent" -- a
      // guard that re-serialized the parsed body before verifying (instead
      // of hashing exactly what arrived) would refuse this legitimate peer,
      // since JSON.stringify's canonical form never has this whitespace.
      const asSent = JSON.stringify(
        { relationId: RELATION_ID, op: OP_NAMES.settingsPull },
        null,
        2,
      );

      const response = await post(harness, signRequest(asSent));

      expect(response.status).toBe(200);
      expect(refusalsOf(harness)).toEqual([]);
    });
  });

  describe('the envelope has to match the endpoint that was reached', () => {
    // `parseKeyRegistration` accepts both directions' op names, so this is
    // the one pairing where nothing but `acceptEnvelope` stands between a
    // validly-signed body and the wrong endpoint.
    const registrationBody = (op: OpName, relationId = RELATION_ID) =>
      JSON.stringify({
        relationId,
        op,
        key: {
          keyId: 'proxy-key-0001',
          publicKeyJwk: peerKeyPair.publicKey.export({ format: 'jwk' }),
          validFrom: new Date().toISOString(),
        },
      });

    it('refuses a body addressed to the other direction of the same contract', async () => {
      const harness = buildHarness(OP_NAMES.keyRegisterToGrowi);
      const signed = signRequest(registrationBody(OP_NAMES.keyRegisterToProxy));

      const response = await post(harness, signed);

      expect(response.status).toBe(401);
      expect(refusalsOf(harness)).toEqual(['envelope-mismatch']);
    });

    it('refuses a body claiming a relation other than the one that signed it', async () => {
      const harness = buildHarness(OP_NAMES.keyRegisterToGrowi);
      const signed = signRequest(
        registrationBody(OP_NAMES.keyRegisterToGrowi, OTHER_RELATION_ID),
      );

      const response = await post(harness, signed);

      expect(response.status).toBe(401);
      expect(refusalsOf(harness)).toEqual(['envelope-mismatch']);
    });

    it('accepts the same request at the endpoint it was addressed to', async () => {
      const harness = buildHarness(OP_NAMES.keyRegisterToGrowi);

      const response = await post(
        harness,
        signRequest(registrationBody(OP_NAMES.keyRegisterToGrowi)),
      );

      expect(response.status).toBe(200);
    });

    it('leaves the one-time value spent, so the refused bytes are not merely refused again for the same reason', async () => {
      const harness = buildHarness(OP_NAMES.keyRegisterToGrowi);
      const signed = signRequest(registrationBody(OP_NAMES.keyRegisterToProxy));

      await post(harness, signed);
      const second = await post(harness, signed);

      expect(second.status).toBe(401);
      // The signature held up, so `verify()` had already spent the nonce by
      // the time the envelope was compared. Resending the same bytes is
      // therefore stopped one step earlier -- which is the intended outcome:
      // validly-signed bytes must not be accepted a second time either.
      expect(refusalsOf(harness)).toEqual(['envelope-mismatch', 'replayed']);
    });
  });

  describe('the one-time value', () => {
    it('is refused the second time the same request arrives', async () => {
      const harness = buildHarness(OP_NAMES.settingsPull);
      const signed = signRequest(
        JSON.stringify({ relationId: RELATION_ID, op: OP_NAMES.settingsPull }),
      );

      const first = await post(harness, signed);
      const second = await post(harness, signed);

      expect(first.status).toBe(200);
      expect(second.status).toBe(401);
      expect(refusalsOf(harness)).toEqual(['replayed']);
      expect(await ChatRequestNonce.countDocuments({})).toBe(1);
    });

    it('is not consumed when verification fails', async () => {
      const harness = buildHarness(OP_NAMES.settingsPull);
      const signed = signRequest(
        JSON.stringify({ relationId: RELATION_ID, op: OP_NAMES.settingsPull }),
        { signedWith: rogueKeyPair.privateKey },
      );

      const response = await post(harness, signed);

      expect(response.status).toBe(401);
      expect(refusalsOf(harness)).toEqual(['signature-mismatch']);
      expect(await ChatRequestNonce.countDocuments({})).toBe(0);
    });

    it('is not reached at all by a request whose validity period has passed', async () => {
      const harness = buildHarness(OP_NAMES.settingsPull);
      // Signed ten minutes ago, so `created`/`expires` are both in the past
      // however long the sender asked for.
      const nowSpy = vi
        .spyOn(Date, 'now')
        .mockReturnValue(Date.now() - 600_000);
      const signed = signRequest(
        JSON.stringify({ relationId: RELATION_ID, op: OP_NAMES.settingsPull }),
      );
      nowSpy.mockRestore();

      const response = await post(harness, signed);

      expect(response.status).toBe(401);
      expect(refusalsOf(harness)).toEqual(['expired']);
      expect(await ChatRequestNonce.countDocuments({})).toBe(0);
    });

    it('expires at the ceiling this side sets, however long the sender asked for', async () => {
      const harness = buildHarness(OP_NAMES.settingsPull);
      const aDay = 24 * 60 * 60;
      const signed = signRequest(
        JSON.stringify({ relationId: RELATION_ID, op: OP_NAMES.settingsPull }),
        { expiresInSec: aDay },
      );

      const sentAt = Date.now();
      const response = await post(harness, signed);

      expect(response.status).toBe(200);
      const stored = await ChatRequestNonce.findOne({});
      expect(stored).not.toBeNull();
      expect(stored?.expiresAt.getTime()).toBeLessThanOrEqual(
        sentAt + (MAX_ACCEPTED_EXPIRES_IN_SEC + 1) * 1000,
      );
    });
  });

  describe('what a refusal records', () => {
    it('names the kind of failure and the endpoint, and neither the signature nor the body', async () => {
      const harness = buildHarness(OP_NAMES.settingsPull);
      const bodyText = JSON.stringify({
        relationId: RELATION_ID,
        op: OP_NAMES.settingsPull,
        secretInBody: 'must-not-be-recorded',
      });
      const signed = signRequest(bodyText, {
        signedWith: rogueKeyPair.privateKey,
      });

      await post(harness, signed);

      expect(harness.recordFailure).toHaveBeenCalledTimes(1);
      const [failure, ctx] = harness.recordFailure.mock.calls[0];
      expect(failure).toBe('signature-mismatch');
      expect(Object.keys(ctx).sort()).toEqual(['method', 'path', 'receivedAt']);
      expect(ctx.method).toBe('POST');
      expect(ctx.path).toBe(harness.path);
      const recorded = JSON.stringify(harness.recordFailure.mock.calls);
      expect(recorded).not.toContain('must-not-be-recorded');
      expect(recorded).not.toContain(signed.headers.signature);
    });

    it('refuses a request that never reached the raw-bytes parser', async () => {
      const harness = buildHarness(OP_NAMES.settingsPull);

      const response = await request(harness.app)
        .post(harness.path)
        .type('form')
        .send({ relationId: RELATION_ID });

      expect(response.status).toBe(401);
      expect(refusalsOf(harness)).toEqual(['unsupported-media-type']);
    });
  });

  describe('the body has to hold up as its contract', () => {
    it('sets a command naming something this version does not implement apart from a body that does not hold up', async () => {
      const harness = buildHarness(OP_NAMES.command);
      const signed = signRequest(
        JSON.stringify({
          relationId: RELATION_ID,
          op: OP_NAMES.command,
          requestId: 'request-1',
          actor: {
            platform: 'slack',
            accountId: 'U123',
            displayName: 'Someone',
          },
          channel: {
            platform: 'slack',
            channelId: 'C123',
            channelName: 'general',
            isPrivate: false,
          },
          kind: 'a-command-from-a-newer-proxy',
        }),
      );

      const response = await post(harness, signed);

      expect(response.status).toBe(401);
      expect(refusalsOf(harness)).toEqual(['unknown-kind']);
    });

    it('refuses a signed body that is not shaped like its op', async () => {
      const harness = buildHarness(OP_NAMES.command);
      const signed = signRequest(
        JSON.stringify({ relationId: RELATION_ID, op: OP_NAMES.command }),
      );

      const response = await post(harness, signed);

      expect(response.status).toBe(401);
      expect(refusalsOf(harness)).toEqual(['body-shape-invalid']);
    });
  });
});
