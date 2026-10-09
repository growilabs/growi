// What these tests pin down is the outbound half of the protocol's security
// contract, not the mechanics of one HTTP call:
//
//  1. **Nothing leaves this process without passing the URI judgement.** Every
//     send goes through `GrowiUriResolver.connect()`; a refused URI never
//     becomes a request, and no signing key is even fetched for it.
//  2. **The signature a real peer would check actually verifies.** Rather than
//     asserting "three headers are present", the captured request is fed to
//     `@growi/chat`'s own `verify()` against a real Ed25519 key pair. That is
//     what proves `content-type` (a COVERED component) is signed AND sent, and
//     that the digest was taken over the exact bytes that went on the wire --
//     two mistakes no header-presence assertion can see.
//  3. **A retry keeps the request identity and takes a fresh nonce.** The same
//     request object sent twice produces byte-identical bodies (so
//     `requestId` and `content-digest` are unchanged) with different
//     signatures -- and the second one still verifies against a nonce store
//     that refuses a reused nonce.
//  4. **The response's shape is the only acceptance gate.** GROWI's answers
//     carry no signature, so an answer that does not pass its parse function
//     is a clean `ok: false`, never a value handed on to a caller.
//
// The final request path is checked in two halves, because one assertion
// cannot carry both:
//
//  - **What is SENT is a path, not a URL.** `sent.path` is asserted to contain
//    no `://`. This is the assertion that discriminates "`{growiUri}` is
//    stripped" from "`{growiUri}` is substituted".
//  - **The base is JOINED exactly once.** The captured request is handed to
//    `buildPinnedRequestOptions` -- the very function the resolver builds its
//    socket options with -- so the joining rule is the real one and not one
//    re-derived here. On its own this cannot see a substitution:
//    `buildPinnedRequestOptions` does `new URL(path, base)`, and `base` is
//    ignored outright when `path` is itself absolute, so a substituted URI
//    collapses back to the same final path.
import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import type {
  AccountLinkStartRequest,
  CommandRequest,
  KeyRegistrationRequest,
  KeyRevocationRequest,
  PublicKeyRegistration,
} from '@growi/chat';
import { OP_ENDPOINTS, OP_NAMES } from '@growi/chat';
import { type KeyRef, verify } from '@growi/chat/server';
import { mock } from 'vitest-mock-extended';

import { buildPinnedRequestOptions } from '../relation/growi-uri-resolver.js';
import type {
  GrowiHttpRequest,
  GrowiUriResolver,
  RelationKeyService,
} from '../relation/index.js';
import { createGrowiClient, type GrowiClientDeps } from './growi-client.js';

const RELATION_ID = 'relation-1';
const GROWI_URI = 'https://growi.example.com/';
const KEY_ID = 'proxy-key-1';

interface HttpAnswer {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: string;
}

const okResponse = (body: unknown): HttpAnswer => ({
  status: 200,
  headers: {},
  body: JSON.stringify(body),
});

interface Harness {
  readonly deps: GrowiClientDeps;
  readonly sent: GrowiHttpRequest[];
  readonly publicKey: KeyObject;
  readonly connectCalls: string[];
  readonly signerCalls: string[];
}

/**
 * `respond` is written synchronously and called from inside the promise the
 * connection hands back, so a test that throws from it produces a REJECTED
 * send -- the shape a destination that never answers really takes.
 */
const harnessWith = (respond: (attempt: number) => HttpAnswer): Harness => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const sent: GrowiHttpRequest[] = [];
  const connectCalls: string[] = [];
  const signerCalls: string[] = [];

  const uriResolver = mock<GrowiUriResolver>({
    connect: (growiUri: string) => {
      connectCalls.push(growiUri);
      return Promise.resolve({
        ok: true as const,
        send: (request: GrowiHttpRequest) => {
          sent.push(request);
          return Promise.resolve().then(() => respond(sent.length));
        },
      });
    },
  });

  const keyService = mock<Pick<RelationKeyService, 'signerFor'>>({
    signerFor: (relationId: string) => {
      signerCalls.push(relationId);
      return Promise.resolve({
        key: { relationId, keyId: KEY_ID },
        privateKey,
      });
    },
  });

  return {
    deps: { uriResolver, keyService },
    sent,
    publicKey,
    connectCalls,
    signerCalls,
  };
};

const commandRequest: CommandRequest = {
  relationId: RELATION_ID,
  op: OP_NAMES.command,
  requestId: 'request-1',
  actor: { platform: 'slack', accountId: 'U1', displayName: 'Alice' },
  channel: {
    platform: 'slack',
    channelId: 'C1',
    channelName: 'general',
    isPrivate: false,
  },
  kind: 'search',
  keyword: 'onboarding',
  limit: 10,
};

const searchResponse = {
  kind: 'search',
  items: [],
  appliedAs: 'anonymous',
};

/** Verifies a captured request exactly as the receiving side would. */
const verifyCaptured = (
  request: GrowiHttpRequest,
  publicKey: KeyObject,
  usedNonces: Set<string>,
) =>
  verify({
    method: request.method,
    headers: { ...request.headers },
    body: Buffer.from(request.body ?? '', 'utf8'),
    resolvePublicKey: (ref: KeyRef) =>
      Promise.resolve(
        ref.relationId === RELATION_ID && ref.keyId === KEY_ID
          ? publicKey
          : null,
      ),
    consumeNonce: (_ref: KeyRef, nonce: string) => {
      if (usedNonces.has(nonce)) {
        return Promise.resolve(false);
      }
      usedNonces.add(nonce);
      return Promise.resolve(true);
    },
  });

describe('GrowiClient', () => {
  describe('reaching GROWI', () => {
    it('sends a POST whose signature a real peer verifies', async () => {
      const harness = harnessWith(() => okResponse(searchResponse));
      const client = createGrowiClient(harness.deps);

      const result = await client.sendCommand(GROWI_URI, commandRequest);

      expect(result).toEqual({ ok: true, response: searchResponse });
      expect(harness.connectCalls).toEqual([GROWI_URI]);
      expect(harness.signerCalls).toEqual([RELATION_ID]);

      const sent = harness.sent[0];
      expect(sent.method).toBe('POST');
      // The bytes on the wire are the bytes the digest was taken over. A
      // re-serialized body would pass a header-presence check and fail here.
      expect(await verifyCaptured(sent, harness.publicKey, new Set())).toEqual({
        ok: true,
        key: { relationId: RELATION_ID, keyId: KEY_ID },
      });
    });

    it('keeps the GROWI base path applied exactly once', async () => {
      const harness = harnessWith(() => okResponse(searchResponse));
      const client = createGrowiClient(harness.deps);

      await client.sendCommand('https://example.com/growi/', commandRequest);

      // The discriminating assertion: `{growiUri}` must be STRIPPED from the
      // routing table's template, never substituted with the real URI. A
      // substituted value would be an absolute URL sitting where a path
      // belongs -- which the joined-path check below cannot see, because
      // `new URL(absolute, base)` drops the base and the result narrows back
      // to the same pathname.
      expect(harness.sent[0].path).not.toContain('://');
      expect(harness.sent[0].path.startsWith('/')).toBe(true);

      const options = buildPinnedRequestOptions({
        uri: new URL('https://example.com/growi/'),
        request: harness.sent[0],
        addresses: [{ address: '203.0.113.10', family: 4 }],
        caCerts: [],
        timeoutMs: 1000,
      });
      expect(options.path).toBe('/growi/_api/v3/chat-integration/peer/command');
    });

    it('never builds a request for a URI the resolver refuses', async () => {
      const harness = harnessWith(() => okResponse(searchResponse));
      const uriResolver = mock<GrowiUriResolver>({
        connect: () =>
          Promise.resolve({
            ok: false as const,
            reason: 'private-address' as const,
          }),
      });
      const client = createGrowiClient({ ...harness.deps, uriResolver });

      const result = await client.sendCommand(GROWI_URI, commandRequest);

      expect(result).toEqual({ ok: false, reason: 'uri-refused' });
      // The judgement's own reason stays inside: a caller that reported it
      // would describe the proxy's view of the network to whoever asked.
      expect(harness.sent).toEqual([]);
      expect(harness.signerCalls).toEqual([]);
    });

    it('reports a relation with no usable signing key instead of throwing', async () => {
      const harness = harnessWith(() => okResponse(searchResponse));
      const keyService = mock<Pick<RelationKeyService, 'signerFor'>>({
        signerFor: () =>
          Promise.reject(new Error('no active key for this relation')),
      });
      const client = createGrowiClient({ ...harness.deps, keyService });

      const result = await client.sendCommand(GROWI_URI, commandRequest);

      expect(result).toEqual({ ok: false, reason: 'no-signing-key' });
      expect(harness.sent).toEqual([]);
    });

    it('reports unusable key material instead of throwing', async () => {
      // `signerFor` reads ONE relation's stored `own_key` row and decrypts it
      // into a `KeyObject`; nothing on that path -- write or read -- checks
      // what kind of key it is. A single corrupted row must therefore fail
      // like every other per-relation condition: as a value, so a fan-out over
      // many GROWIs is not abandoned because one of them has a bad key row.
      const { privateKey: rsaKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
      });
      const harness = harnessWith(() => okResponse(searchResponse));
      const keyService = mock<Pick<RelationKeyService, 'signerFor'>>({
        signerFor: (relationId: string) =>
          Promise.resolve({
            key: { relationId, keyId: KEY_ID },
            privateKey: rsaKey,
          }),
      });
      const client = createGrowiClient({ ...harness.deps, keyService });

      const result = await client.sendCommand(GROWI_URI, commandRequest);

      expect(result).toEqual({ ok: false, reason: 'no-signing-key' });
      expect(harness.sent).toEqual([]);
    });

    it('refuses to be built with a validity period that is not a positive whole number of seconds', () => {
      // A GLOBAL wiring value, not a per-relation condition: it is captured
      // once and every call would fail for the same reason. Complaining at
      // construction keeps one mistyped configuration value from being
      // reported as "no usable signing key" for every destination at once.
      const harness = harnessWith(() => okResponse(searchResponse));

      expect(() =>
        createGrowiClient({ ...harness.deps, expiresInSec: 0 }),
      ).toThrow(RangeError);
      expect(() =>
        createGrowiClient({ ...harness.deps, expiresInSec: 1.5 }),
      ).toThrow(RangeError);
    });

    it('reports a destination that does not answer instead of throwing', async () => {
      const harness = harnessWith(() => {
        throw new Error('socket hang up');
      });
      const client = createGrowiClient(harness.deps);

      expect(await client.sendCommand(GROWI_URI, commandRequest)).toEqual({
        ok: false,
        reason: 'unreachable',
      });
    });
  });

  describe('checking the answer', () => {
    it("passes GROWI's own refusal through as an answer", async () => {
      // `parseCommandResponse`'s error variant keys on `code`, and one of its
      // codes is the very word this module treats as a parse failure
      // (`unknown-kind`). A structural check that confused the two would report
      // a refusal GROWI answered clearly with as "we could not reach GROWI".
      const answer = {
        kind: 'error',
        code: 'unknown-kind',
        message: 'no such command',
      };
      const harness = harnessWith(() => okResponse(answer));
      const client = createGrowiClient(harness.deps);

      expect(await client.sendCommand(GROWI_URI, commandRequest)).toEqual({
        ok: true,
        response: answer,
      });
    });

    it('refuses an answer whose shape does not match', async () => {
      const harness = harnessWith(() =>
        okResponse({ kind: 'not-a-response-kind' }),
      );
      const client = createGrowiClient(harness.deps);

      expect(await client.sendCommand(GROWI_URI, commandRequest)).toEqual({
        ok: false,
        reason: 'malformed-response',
      });
    });

    it('refuses an answer that is not JSON at all', async () => {
      const harness = harnessWith(() => ({
        status: 200,
        headers: {},
        body: '<html>gateway</html>',
      }));
      const client = createGrowiClient(harness.deps);

      expect(await client.sendCommand(GROWI_URI, commandRequest)).toEqual({
        ok: false,
        reason: 'malformed-response',
      });
    });

    it('never reads the body of a non-2xx answer', async () => {
      // A key operation GROWI turns down arrives as 200 with
      // `{status:'rejected'}`; a non-2xx answer is the transport failing, and
      // its body is whatever an intermediary chose to write.
      const harness = harnessWith(() => ({
        status: 502,
        headers: {},
        body: JSON.stringify(searchResponse),
      }));
      const client = createGrowiClient(harness.deps);

      expect(await client.sendCommand(GROWI_URI, commandRequest)).toEqual({
        ok: false,
        reason: 'http-error',
      });
    });
  });

  describe('sending the same request again', () => {
    it('keeps the body byte-identical and takes a fresh nonce', async () => {
      const harness = harnessWith((attempt) =>
        attempt === 1
          ? okResponse({ kind: 'wrong' })
          : okResponse(searchResponse),
      );
      const client = createGrowiClient(harness.deps);

      const first = await client.sendCommand(GROWI_URI, commandRequest);
      const second = await client.sendCommand(GROWI_URI, commandRequest);

      expect(first).toEqual({ ok: false, reason: 'malformed-response' });
      expect(second).toEqual({ ok: true, response: searchResponse });

      const [a, b] = harness.sent;
      // Same request identity: `requestId` and therefore the digest are the
      // caller's to keep, so duplicate-execution detection on GROWI's side
      // still sees one request.
      expect(b.body).toBe(a.body);
      expect(b.headers?.['content-digest']).toBe(a.headers?.['content-digest']);
      // Freshly signed: a resent SignResult would replay the same nonce.
      expect(b.headers?.['signature-input']).not.toBe(
        a.headers?.['signature-input'],
      );
      expect(b.headers?.signature).not.toBe(a.headers?.signature);

      // A store that refuses a reused nonce accepts both attempts.
      const usedNonces = new Set<string>();
      expect(await verifyCaptured(a, harness.publicKey, usedNonces)).toEqual({
        ok: true,
        key: { relationId: RELATION_ID, keyId: KEY_ID },
      });
      expect(await verifyCaptured(b, harness.publicKey, usedNonces)).toEqual({
        ok: true,
        key: { relationId: RELATION_ID, keyId: KEY_ID },
      });
    });
  });

  describe('the five operations', () => {
    const publicKeyRegistration: PublicKeyRegistration = {
      keyId: 'new-proxy-key',
      publicKeyJwk: { kty: 'OKP', crv: 'Ed25519', x: 'abc' },
      validFrom: '2026-01-01T00:00:00.000Z',
    };

    const accountLinkRequest: AccountLinkStartRequest = {
      relationId: RELATION_ID,
      op: OP_NAMES.accountLinkStart,
      actor: { platform: 'slack', accountId: 'U1', displayName: 'Alice' },
    };

    const keyRegistration: KeyRegistrationRequest = {
      relationId: RELATION_ID,
      op: OP_NAMES.keyRegisterToGrowi,
      key: publicKeyRegistration,
    };

    const keyRevocation: KeyRevocationRequest = {
      relationId: RELATION_ID,
      op: OP_NAMES.keyRevokeToGrowi,
      keyId: 'old-proxy-key',
    };

    const pathOf = (op: keyof typeof OP_ENDPOINTS) =>
      OP_ENDPOINTS[op].pathTemplate.replace('{growiUri}', '');

    it.each([
      {
        name: 'command',
        op: OP_NAMES.command,
        answer: searchResponse,
        call: (c: ReturnType<typeof createGrowiClient>) =>
          c.sendCommand(GROWI_URI, commandRequest),
      },
      {
        name: 'account link start',
        op: OP_NAMES.accountLinkStart,
        answer: { status: 'taken-by-another-user' },
        call: (c: ReturnType<typeof createGrowiClient>) =>
          c.startAccountLink(GROWI_URI, accountLinkRequest),
      },
      {
        name: 'settings pull',
        op: OP_NAMES.settingsPull,
        answer: {
          settings: { relationId: RELATION_ID, channelPermissions: [] },
          version: 3,
        },
        call: (c: ReturnType<typeof createGrowiClient>) =>
          c.pullSettings(GROWI_URI, RELATION_ID),
      },
      {
        name: 'key registration',
        op: OP_NAMES.keyRegisterToGrowi,
        answer: { status: 'ok' },
        call: (c: ReturnType<typeof createGrowiClient>) =>
          c.registerKey(GROWI_URI, keyRegistration),
      },
      {
        name: 'key revocation',
        op: OP_NAMES.keyRevokeToGrowi,
        answer: { status: 'ok' },
        call: (c: ReturnType<typeof createGrowiClient>) =>
          c.revokeKey(GROWI_URI, keyRevocation),
      },
    ])('sends $name to its own endpoint, signed, with the op in the body', async ({
      op,
      answer,
      call,
    }) => {
      const harness = harnessWith(() => okResponse(answer));
      const client = createGrowiClient(harness.deps);

      const result = await call(client);

      expect(result.ok).toBe(true);
      const sent = harness.sent[0];
      expect(sent.path).toBe(pathOf(op));
      // The op travels in the body because the signature covers the body's
      // digest and deliberately does not cover the path.
      expect(JSON.parse(sent.body ?? '')).toMatchObject({
        relationId: RELATION_ID,
        op,
      });
      expect(await verifyCaptured(sent, harness.publicKey, new Set())).toEqual({
        ok: true,
        key: { relationId: RELATION_ID, keyId: KEY_ID },
      });
    });

    it('stamps the op from this call, and signs with the key of the relation the caller supplied', async () => {
      const harness = harnessWith(() => okResponse({ status: 'ok' }));
      const client = createGrowiClient(harness.deps);

      // A caller holding the proxy-directed sibling op must not be able to
      // send it to GROWI: `acceptEnvelope` compares `op` exactly, so the
      // direction has to be decided by the method that was called.
      await client.registerKey(GROWI_URI, {
        ...keyRegistration,
        relationId: 'relation-supplied-by-caller',
        op: OP_NAMES.keyRegisterToProxy,
      });

      expect(JSON.parse(harness.sent[0].body ?? '')).toMatchObject({
        op: OP_NAMES.keyRegisterToGrowi,
      });

      // `relationId`, unlike `op`, is NOT re-stamped: the caller's value is the
      // one that reaches the body AND the one the signing key is looked up for.
      // That single read is what makes the signed relation and the body's
      // relation the same value -- choosing a `relationId` that belongs with
      // the `growiUri` is the caller's job, not something checked here.
      expect(JSON.parse(harness.sent[0].body ?? '')).toMatchObject({
        relationId: 'relation-supplied-by-caller',
      });
      expect(harness.signerCalls).toEqual(['relation-supplied-by-caller']);
    });
  });
});
